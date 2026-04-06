/**
 * useVertexDVM — VertexLab Data Vending Machine (DVM) Client
 *
 * Exact API surface per the official VertexLab documentation:
 *
 *   Kind 5312 → 6312  Verify Reputation  (single target, returns followers sorted by rank)
 *   Kind 5313 → 6313  Recommend Follows  (no targets — returns top pubkeys to follow)
 *   Kind 5314 → 6314  Rank Profiles      (1–1000 targets — ranks a provided pubkey list)
 *   Kind 5315 → 6315  Search Profiles    (search term required, >3 chars)
 *   Kind 7000          Error response
 *
 * IMPORTANT — Kind 5316 does NOT exist in the VertexLab spec.
 * Discovery feeds are implemented using Kind 5313 with different sort params.
 *
 * Communication pattern:
 *  1. Sign & publish request event to wss://relay.vertexlab.io
 *  2. Subscribe for response: kinds [responseKind, 7000], #e = [requestId]
 *  3. Parse JSON content array from response
 *  4. HTTP POST fallback to https://relay.vertexlab.io/api/v1/dvms on WS failure
 *
 * All parameters use the format: ["param", "<name>", "<value>"]
 */

import { useCurrentUser } from '@/hooks/useCurrentUser';

// ─── Constants ────────────────────────────────────────────────────────────

const VERTEX_RELAY   = 'wss://relay.vertexlab.io';
const VERTEX_API     = 'https://relay.vertexlab.io/api/v1/dvms';
const VERTEX_TIMEOUT = 25_000; // 25s — relay can be slow on first response

// ─── Types ────────────────────────────────────────────────────────────────

export interface VertexRankEntry {
  pubkey: string;
  rank: number;
  follows?: number;
  followers?: number;
}

export interface VertexError {
  status: string;
  message: string;
}

export interface SignedEvent {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

interface MinimalSigner {
  signEvent(e: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }): Promise<SignedEvent>;
}

// ─── Cache helpers (24h TTL) ──────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; ts: number };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
    return parsed.data;
  } catch { return null; }
}

function writeCache<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch { /* quota */ }
}

export function clearVertexCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('vertex:'))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ─── Core WebSocket + HTTP fallback engine ────────────────────────────────

/**
 * Send a DVM request to VertexLab and await the matching response.
 *
 * Strategy:
 *  1. Open WebSocket to wss://relay.vertexlab.io
 *  2. Publish the signed EVENT
 *  3. Send REQ to subscribe for the response (responseKind OR kind:7000) #e=requestId
 *  4. Await EVENT message with matching kind
 *  5. On timeout or WS error → HTTP POST fallback
 */
async function dvmRequest(
  signer: MinimalSigner,
  reqEvent: { kind: number; content: string; tags: string[][]; created_at: number },
  responseKind: number
): Promise<{ content: string; error?: VertexError }> {
  const signed = await signer.signEvent(reqEvent);

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (result: { content: string; error?: VertexError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      try { ws?.close(); } catch { /* ignore */ }
      resolve(result);
    };

    // HTTP fallback function
    const httpFallback = (reason: string) => {
      fetch(VERTEX_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
        signal: AbortSignal.timeout(20000),
      })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ content?: string; tags?: string[][] }>;
        })
        .then(data => {
          // Check if it's a kind:7000 error response
          if (data.tags) {
            const statusTag = (data.tags as string[][]).find(t => t[0] === 'status');
            if (statusTag) {
              resolve({ content: '', error: { status: statusTag[1] ?? 'error', message: statusTag[2] ?? 'DVM error' } });
              return;
            }
          }
          resolve({ content: data?.content ?? '' });
        })
        .catch(err => reject(new Error(`VertexLab ${reason} + HTTP fallback failed: ${(err as Error).message}`)));
    };

    // Hard timeout → HTTP fallback
    const hardTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws?.close(); } catch { /* ignore */ }
        httpFallback('timeout');
      }
    }, VERTEX_TIMEOUT);

    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(VERTEX_RELAY);
    } catch {
      clearTimeout(hardTimer);
      httpFallback('WS creation failed');
      return;
    }

    ws.onopen = () => {
      if (!ws) return;
      // Step 1: publish the signed request event
      ws.send(JSON.stringify(['EVENT', signed]));

      // Step 2: subscribe for the response
      const subId = `vtx-${signed.id.slice(0, 12)}`;
      ws.send(JSON.stringify([
        'REQ', subId,
        { kinds: [responseKind, 7000], '#e': [signed.id], limit: 1 }
      ]));
    };

    ws.onmessage = (msg) => {
      try {
        const frame = JSON.parse(msg.data as string) as [string, ...unknown[]];

        if (frame[0] === 'EVENT') {
          const ev = frame[2] as { kind: number; content: string; tags: string[][] };

          if (ev.kind === 7000) {
            // DVM error — extract status tag message per spec
            const statusTag = ev.tags.find(t => t[0] === 'status');
            const status  = statusTag?.[1] ?? 'error';
            const message = statusTag?.[2] ?? ev.content ?? 'Unknown DVM error';
            settle({ content: '', error: { status, message } });
            return;
          }

          if (ev.kind === responseKind) {
            settle({ content: ev.content });
            return;
          }
        }

        // EOSE: the relay finished sending stored events.
        // If we haven't received a response yet, give it 8 more seconds
        // (the DVM processes asynchronously, response arrives after EOSE).
        if (frame[0] === 'EOSE') {
          setTimeout(() => {
            if (!settled) {
              // Still nothing — use HTTP fallback instead of erroring out
              settled = true;
              clearTimeout(hardTimer);
              try { ws?.close(); } catch { /* ignore */ }
              httpFallback('EOSE with no response');
            }
          }, 8000);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(hardTimer);
        httpFallback('WS error');
      }
    };

    ws.onclose = () => {
      // Only handle unexpected close (if WS closes without us settling)
      if (!settled) {
        settled = true;
        clearTimeout(hardTimer);
        httpFallback('WS closed unexpectedly');
      }
    };
  });
}

// ─── Kind 5313: Recommend Follows ────────────────────────────────────────
//
// Returns a list of recommended pubkeys to follow (highest ranked pubkeys
// that the source doesn't already follow). No `target` params required.
// This is the correct endpoint for "Top N discovery" and "personalized feeds".

export interface RecommendFollowsParams {
  sort?: 'globalPagerank' | 'personalizedPagerank' | 'followerCount';
  /** source pubkey (hex) for personalized ranking; defaults to signer pubkey */
  source?: string;
  limit?: number;
}

export async function fetchVertexRecommendFollows(
  signer: MinimalSigner,
  params: RecommendFollowsParams = {}
): Promise<VertexRankEntry[]> {
  const { sort = 'globalPagerank', limit = 50, source } = params;
  const cacheKey = `vertex:recommend:${sort}:${limit}:${source ?? 'self'}`;

  const cached = readCache<VertexRankEntry[]>(cacheKey);
  if (cached) return cached;

  const tags: string[][] = [
    ['param', 'sort', sort],
    ['param', 'limit', String(limit)],
  ];
  if (source) tags.push(['param', 'source', source]);

  const { content, error } = await dvmRequest(
    signer,
    { kind: 5313, content: '', tags, created_at: Math.floor(Date.now() / 1000) },
    6313
  );

  if (error) throw new Error(error.message);

  const results = parseRankArray(content);
  writeCache(cacheKey, results);
  return results;
}

// ─── Kind 5314: Rank Profiles ─────────────────────────────────────────────
//
// Ranks a provided list of pubkeys. Requires 1–1000 target pubkeys.
// Use this to rank the user's own follow list by PageRank.

export interface RankProfilesParams {
  targets: string[]; // REQUIRED: 1–1000 hex pubkeys
  sort?: 'globalPagerank' | 'personalizedPagerank' | 'followerCount';
  source?: string;
  limit?: number;
}

export async function fetchVertexRankProfiles(
  signer: MinimalSigner,
  params: RankProfilesParams
): Promise<VertexRankEntry[]> {
  const { targets, sort = 'globalPagerank', limit, source } = params;

  if (!targets.length) throw new Error('Kind 5314 requires at least one target pubkey');
  if (targets.length > 1000) throw new Error('Kind 5314 supports at most 1000 target pubkeys');

  const tags: string[][] = [
    ['param', 'sort', sort],
  ];
  if (limit) tags.push(['param', 'limit', String(limit)]);
  if (source) tags.push(['param', 'source', source]);

  // Each target is a separate ["param", "target", "<pubkey>"] tag
  for (const pk of targets) {
    tags.push(['param', 'target', pk]);
  }

  const { content, error } = await dvmRequest(
    signer,
    { kind: 5314, content: '', tags, created_at: Math.floor(Date.now() / 1000) },
    6314
  );

  if (error) throw new Error(error.message);
  return parseRankArray(content);
}

// ─── Kind 5315: Search Profiles ──────────────────────────────────────────

export interface SearchProfilesParams {
  query: string; // must be >3 chars
  sort?: 'globalPagerank' | 'personalizedPagerank' | 'followerCount';
  source?: string;
  limit?: number;
}

export async function fetchVertexSearch(
  signer: MinimalSigner,
  params: SearchProfilesParams
): Promise<VertexRankEntry[]> {
  const { query, sort = 'globalPagerank', limit = 50, source } = params;

  const tags: string[][] = [
    ['param', 'search', query],
    ['param', 'sort', sort],
    ['param', 'limit', String(limit)],
  ];
  if (source) tags.push(['param', 'source', source]);

  const { content, error } = await dvmRequest(
    signer,
    { kind: 5315, content: '', tags, created_at: Math.floor(Date.now() / 1000) },
    6315
  );

  if (error) throw new Error(error.message);
  return parseRankArray(content);
}

// ─── Discovery Feed Presets ───────────────────────────────────────────────
//
// These are logical groupings built on real Vertex endpoints.
// All use Kind 5313 (Recommend Follows) — NOT the non-existent 5316.

export interface DiscoveryFeedPreset {
  id: 'top-global' | 'my-network' | 'ranked-follows';
  label: string;
  description: string;
  icon: string;
  sort: 'globalPagerank' | 'personalizedPagerank';
  requiresFollows: boolean; // ranked-follows needs the user's follow list as targets
}

export const DISCOVERY_PRESETS: DiscoveryFeedPreset[] = [
  {
    id: 'top-global',
    label: 'Top Global',
    description: 'Highest ranked profiles on the entire Nostr network by global PageRank',
    icon: '🌐',
    sort: 'globalPagerank',
    requiresFollows: false,
  },
  {
    id: 'my-network',
    label: 'My Network',
    description: 'Personalized recommendations based on your social graph (WoT PageRank)',
    icon: '📡',
    sort: 'personalizedPagerank',
    requiresFollows: false,
  },
  {
    id: 'ranked-follows',
    label: 'Rank My Follows',
    description: 'Your existing follows ranked by global PageRank — find your most influential contacts',
    icon: '⭐',
    sort: 'globalPagerank',
    requiresFollows: true,
  },
];

// ─── Shared parser ────────────────────────────────────────────────────────

function parseRankArray(content: string): VertexRankEntry[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as Array<{
      pubkey: string;
      rank: number;
      follows?: number;
      followers?: number;
    }>;
    return parsed
      .filter(item => item && typeof item.pubkey === 'string')
      .map(item => ({
        pubkey: item.pubkey,
        rank: item.rank ?? 0,
        follows: item.follows,
        followers: item.followers,
      }));
  } catch {
    throw new Error('Failed to parse VertexLab response content as JSON');
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useVertexSigner() {
  const { user } = useCurrentUser();
  return user?.signer ?? null;
}
