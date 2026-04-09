/**
 * vertexReputationSingle — Kind-5312 Verify Reputation (single target)
 *
 * Thin wrapper around the VertexLab DVM websocket / HTTP transport,
 * lifted out of the main useVertexDVM.ts to avoid circular imports and
 * to keep the reputation utility self-contained.
 */

const VERTEX_RELAY = 'wss://relay.vertexlab.io';
const VERTEX_API   = 'https://relay.vertexlab.io/api/v1/dvms';
const TIMEOUT_MS   = 20_000;

export interface VertexRankEntry {
  pubkey: string;
  rank: number;
  follows?: number;
  followers?: number;
  leaked?: boolean;
}

interface SignedEvent {
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

// ─── Local 24h localStorage cache ─────────────────────────────────────────

const CACHE_TTL = 24 * 60 * 60 * 1000;

function lsRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as { d: T; ts: number };
    if (Date.now() - p.ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return p.d;
  } catch { return null; }
}

function lsWrite<T>(key: string, d: T): void {
  try { localStorage.setItem(key, JSON.stringify({ d, ts: Date.now() })); } catch { /* quota */ }
}

// ─── Transport ────────────────────────────────────────────────────────────

async function dvmPost(signed: SignedEvent): Promise<string> {
  const r = await fetch(VERTEX_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json() as { content?: string; tags?: string[][] };

  // Handle kind:7000 error
  if (data.tags) {
    const statusTag = (data.tags as string[][]).find((t: string[]) => t[0] === 'status');
    if (statusTag) throw new Error(statusTag[2] ?? 'VertexLab DVM error');
  }
  return data.content ?? '';
}

async function dvmWS(signed: SignedEvent, responseKind: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws?.close(); } catch { /**/ } reject(new Error('timeout')); }
    }, TIMEOUT_MS);

    const settle = (ok: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /**/ }
      if (typeof ok === 'string') resolve(ok); else reject(ok);
    };

    let ws: WebSocket | null = null;
    try { ws = new WebSocket(VERTEX_RELAY); } catch (e) { reject(e); return; }

    ws.onopen = () => {
      if (!ws) return;
      ws.send(JSON.stringify(['EVENT', signed]));
      const subId = `rep-${signed.id.slice(0, 10)}`;
      ws.send(JSON.stringify(['REQ', subId, { kinds: [responseKind, 7000], '#e': [signed.id], limit: 1 }]));
    };

    ws.onmessage = (msg) => {
      try {
        const frame = JSON.parse(msg.data as string) as [string, ...unknown[]];
        if (frame[0] === 'EVENT') {
          const ev = frame[2] as { kind: number; content: string; tags: string[][] };
          if (ev.kind === 7000) {
            const s = ev.tags.find((t: string[]) => t[0] === 'status');
            settle(new Error(s?.[2] ?? 'DVM error'));
            return;
          }
          if (ev.kind === responseKind) { settle(ev.content); return; }
        }
        if (frame[0] === 'EOSE') {
          setTimeout(() => { if (!settled) settle(new Error('no response after EOSE')); }, 8000);
        }
      } catch { /**/ }
    };

    ws.onerror = () => settle(new Error('WS error'));
    ws.onclose = () => { if (!settled) settle(new Error('WS closed')); };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Fetch VertexLab kind-5312 Verify Reputation for a single pubkey.
 * Returns an array where [0] is the target and [1..n] are their top followers.
 */
export async function fetchVertexReputationSingle(
  signer: MinimalSigner,
  pubkey: string
): Promise<VertexRankEntry[]> {
  const cacheKey = `vertex:rep512:${pubkey}`;
  const cached = lsRead<VertexRankEntry[]>(cacheKey);
  if (cached) return cached;

  const reqEvent = {
    kind: 5312,
    content: '',
    tags: [
      ['param', 'target', pubkey],
      ['param', 'limit', '3'],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };

  const signed = await signer.signEvent(reqEvent);

  let content: string;
  try {
    content = await dvmWS(signed, 6312);
  } catch {
    // WS failed — try HTTP
    content = await dvmPost(signed);
  }

  if (!content) return [];

  const raw = JSON.parse(content) as Array<{
    pubkey: string;
    rank: number;
    follows?: number;
    followers?: number;
    leak?: { status: string };
  }>;

  const entries: VertexRankEntry[] = raw
    .filter((item) => item && typeof item.pubkey === 'string')
    .map((item) => ({
      pubkey: item.pubkey,
      rank: item.rank ?? 0,
      follows: item.follows,
      followers: item.followers,
      leaked: item.leak?.status === 'confirmed',
    }));

  lsWrite(cacheKey, entries);
  return entries;
}
