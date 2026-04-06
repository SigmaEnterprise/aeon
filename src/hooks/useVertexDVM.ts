/**
 * useVertexDVM — VertexLab Data Vending Machine (DVM) Client
 *
 * Implements the full cryptographic request/response handshake for:
 *   Kind 5314 → 6314  Rank (Top N global leaders or targeted pubkeys)
 *   Kind 5315 → 6315  Search (full-text profile search)
 *   Kind 5316 → 6316  Discovery Feed (WoT-based content curation)
 *   Kind 7000         Error response from DVM
 *
 * Communication pattern per VertexLab spec:
 *  1. Sign & publish a request event to wss://relay.vertexlab.io
 *  2. Subscribe to responses where #e tag matches the request event ID
 *  3. Parse the JSON content payload from the result event
 *  4. Fallback: POST to https://relay.vertexlab.io/api/v1/dvms if WS congested
 *
 * Caching: Top-50 results are cached in localStorage for 24 hours to avoid
 * redundant requests and respect rate limits.
 */

import { useCurrentUser } from '@/hooks/useCurrentUser';

// ─── VertexLab endpoint ───────────────────────────────────────────────────

const VERTEX_RELAY = 'wss://relay.vertexlab.io';
const VERTEX_API   = 'https://relay.vertexlab.io/api/v1/dvms';
const VERTEX_TIMEOUT_MS = 20_000;

// ─── Response types ───────────────────────────────────────────────────────

export interface VertexRankEntry {
  pubkey: string;
  rank: number;
}

export interface VertexSearchEntry {
  pubkey: string;
  rank: number;
  reputationRank?: number;
}

export interface VertexDiscoveryEntry {
  id: string;       // event id
  pubkey: string;
  rank?: number;
}

export interface VertexError {
  status: string;
  message: string;
}

// ─── Cache helpers ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; ts: number };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore quota errors */ }
}

// ─── Signer type ──────────────────────────────────────────────────────────

interface MinimalSigner {
  signEvent(e: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }): Promise<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  }>;
}

// ─── Core DVM request/response engine ────────────────────────────────────

/**
 * Sends a DVM request event to relay.vertexlab.io via WebSocket and waits
 * for a matching response (kind = reqKind + 1000) or error (kind 7000).
 *
 * Falls back to HTTP POST if WebSocket fails to connect within 3 seconds.
 */
async function dvmRequest(
  signer: MinimalSigner,
  requestEvent: Omit<{ id: string; pubkey: string; sig: string; kind: number; content: string; tags: string[][]; created_at: number }, 'id' | 'pubkey' | 'sig'>,
  responseKind: number
): Promise<{ content: string; error?: VertexError }> {
  // Sign the request
  const signed = await signer.signEvent(requestEvent);

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (result: { content: string; error?: VertexError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        // Timeout — try HTTP fallback
        fetch(VERTEX_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signed),
          signal: AbortSignal.timeout(15000),
        })
          .then(r => r.json())
          .then((data: unknown) => {
            const d = data as { content?: string };
            resolve({ content: d?.content ?? '' });
          })
          .catch(err => reject(new Error(`VertexLab timeout + HTTP fallback failed: ${(err as Error).message}`)));
      }
    }, VERTEX_TIMEOUT_MS);

    let ws: WebSocket;
    try {
      ws = new WebSocket(VERTEX_RELAY);
    } catch {
      clearTimeout(timer);
      reject(new Error('Failed to create WebSocket connection to VertexLab'));
      return;
    }

    ws.onopen = () => {
      // Publish the request event
      ws.send(JSON.stringify(['EVENT', signed]));

      // Subscribe to responses matching our request ID
      const subId = `vertex-${signed.id.slice(0, 8)}`;
      ws.send(JSON.stringify([
        'REQ', subId,
        {
          kinds: [responseKind, 7000],
          '#e': [signed.id],
          limit: 1,
        }
      ]));
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as [string, ...unknown[]];
        const type = data[0];

        if (type === 'EVENT') {
          const event = data[2] as {
            kind: number;
            content: string;
            tags: string[][];
          };

          if (event.kind === 7000) {
            // Error response from DVM
            const statusTag = event.tags.find(t => t[0] === 'status');
            const status = statusTag?.[1] ?? 'error';
            const message = statusTag?.[2] ?? event.content ?? 'Unknown DVM error';
            settle({ content: '', error: { status, message } });
            return;
          }

          if (event.kind === responseKind) {
            settle({ content: event.content });
            return;
          }
        }

        if (type === 'EOSE') {
          // End of stored events — result may arrive after EOSE, keep waiting
          // But if we get EOSE with no result, start a shorter deadline
          setTimeout(() => {
            if (!settled) {
              settle({ content: '', error: { status: 'timeout', message: 'No response received from VertexLab' } });
            }
          }, 5000);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      if (!settled) {
        // WS error — try HTTP fallback immediately
        settled = true;
        clearTimeout(timer);
        fetch(VERTEX_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signed),
          signal: AbortSignal.timeout(15000),
        })
          .then(r => r.json())
          .then((d: unknown) => {
            const resp = d as { content?: string };
            resolve({ content: resp?.content ?? '' });
          })
          .catch(err => reject(new Error(`VertexLab WS error + HTTP fallback failed: ${(err as Error).message}`)));
      }
    };

    ws.onclose = () => {
      // If closed before settling, let the timer handle fallback
    };
  });
}

// ─── Kind 5314: Rank request ──────────────────────────────────────────────

export interface RankRequestParams {
  sort?: 'globalPagerank' | 'personalizedPagerank';
  limit?: number;
  targets?: string[]; // hex pubkeys; if empty = global leaders
  seed?: string[];    // pubkeys to seed personalized ranking
}

export async function fetchVertexRank(
  signer: MinimalSigner,
  params: RankRequestParams = {}
): Promise<VertexRankEntry[]> {
  const { sort = 'globalPagerank', limit = 50, targets = [], seed = [] } = params;
  const cacheKey = `vertex:rank:${sort}:${limit}:${targets.join(',')}`;

  // Return cached result if fresh (24h TTL)
  const cached = readCache<VertexRankEntry[]>(cacheKey);
  if (cached) return cached;

  const tags: string[][] = [
    ['param', 'sort', sort],
    ['param', 'limit', String(limit)],
    ['output', 'application/json'],
  ];
  for (const pk of targets) tags.push(['p', pk]);
  for (const pk of seed)    tags.push(['param', 'seed', pk]);

  const { content, error } = await dvmRequest(
    signer,
    { kind: 5314, content: '', tags, created_at: Math.floor(Date.now() / 1000) },
    6314
  );

  if (error) throw new Error(error.message);

  let results: VertexRankEntry[] = [];
  try {
    const parsed = JSON.parse(content) as Array<{ pubkey: string; rank: number } | [string, number]>;
    results = parsed.map(item => {
      if (Array.isArray(item)) return { pubkey: item[0], rank: item[1] };
      return { pubkey: item.pubkey, rank: item.rank };
    });
  } catch {
    throw new Error('Failed to parse VertexLab rank response');
  }

  writeCache(cacheKey, results);
  return results;
}

// ─── Kind 5315: Search request ────────────────────────────────────────────

export interface SearchRequestParams {
  query: string;
  limit?: number;
  sort?: 'globalPagerank' | 'searchRank';
}

export async function fetchVertexSearch(
  signer: MinimalSigner,
  params: SearchRequestParams
): Promise<VertexSearchEntry[]> {
  const { query, limit = 50, sort = 'globalPagerank' } = params;

  const tags: string[][] = [
    ['param', 'search', query],
    ['param', 'limit', String(limit)],
    ['param', 'sort', sort],
    ['output', 'application/json'],
  ];

  const { content, error } = await dvmRequest(
    signer,
    { kind: 5315, content: '', tags, created_at: Math.floor(Date.now() / 1000) },
    6315
  );

  if (error) throw new Error(error.message);

  try {
    const parsed = JSON.parse(content) as Array<{
      pubkey: string;
      rank: number;
      reputationRank?: number;
    } | [string, number]>;

    return parsed.map(item => {
      if (Array.isArray(item)) return { pubkey: item[0], rank: item[1] };
      return { pubkey: item.pubkey, rank: item.rank, reputationRank: item.reputationRank };
    });
  } catch {
    throw new Error('Failed to parse VertexLab search response');
  }
}

// ─── Kind 5316: Discovery Feed request ───────────────────────────────────

export interface DiscoveryFeedPreset {
  id: 'signal' | 'global-pulse' | 'tribe';
  label: string;
  description: string;
  icon: string;
  params: Record<string, string>;
}

export const DISCOVERY_PRESETS: DiscoveryFeedPreset[] = [
  {
    id: 'signal',
    label: 'The Signal',
    description: 'High-value content within your extended Web of Trust (depth 2, min 21k sats zapped)',
    icon: '📡',
    params: { trust_depth: '2', filter_min_zaps: '21000', sort: 'globalPagerank' },
  },
  {
    id: 'global-pulse',
    label: 'Global Pulse',
    description: 'Most reputable content across the entire Nostr network, sorted by PageRank',
    icon: '🌐',
    params: { sort: 'globalPagerank', kind: '1' },
  },
  {
    id: 'tribe',
    label: 'Tribe Discovery',
    description: 'Content popular among your specific social tribe (WoT overlap)',
    icon: '🏕️',
    params: { wot_overlap: 'true', sort: 'globalPagerank' },
  },
];

export interface DiscoveryFeedParams {
  presetId: DiscoveryFeedPreset['id'];
  seedPubkeys: string[]; // user's followed pubkeys (Core 5 or full follow list)
  limit?: number;
}

export async function fetchVertexDiscovery(
  signer: MinimalSigner,
  params: DiscoveryFeedParams
): Promise<VertexDiscoveryEntry[]> {
  const { presetId, seedPubkeys, limit = 30 } = params;
  const preset = DISCOVERY_PRESETS.find(p => p.id === presetId);
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);

  const tags: string[][] = [
    ['param', 'limit', String(limit)],
    ['output', 'application/json'],
  ];

  // Add preset-specific params
  for (const [k, v] of Object.entries(preset.params)) {
    tags.push(['param', k, v]);
  }

  // Seed the WoT with the user's follows (up to 150 for bandwidth)
  for (const pk of seedPubkeys.slice(0, 150)) {
    tags.push(['p', pk]);
  }

  const { content, error } = await dvmRequest(
    signer,
    { kind: 5316, content: '', tags, created_at: Math.floor(Date.now() / 1000) },
    6316
  );

  if (error) throw new Error(error.message);

  try {
    const parsed = JSON.parse(content) as Array<{
      id?: string;
      pubkey?: string;
      rank?: number;
    } | [string, string]>;

    return parsed.map(item => {
      if (Array.isArray(item)) return { id: item[0], pubkey: item[1] };
      return { id: item.id ?? '', pubkey: item.pubkey ?? '', rank: item.rank };
    });
  } catch {
    throw new Error('Failed to parse VertexLab discovery response');
  }
}

// ─── React hook wrapper ───────────────────────────────────────────────────

export function useVertexSigner() {
  const { user } = useCurrentUser();
  return user?.signer ?? null;
}
