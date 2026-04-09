/**
 * ReputationUtility — VertexLab Kind-5312 "Verify Reputation" integration
 *
 * Uses the VertexLab DVM (Data Vending Machine) to score pubkeys by their
 * global PageRank on the Nostr social graph. Low-rank accounts are classified
 * as likely spam / low-signal, enabling the notifications panel to hide or
 * de-prioritise them.
 *
 * Protocol:
 *   Request  kind 5312 — ["param","target","<hex-pubkey>"]
 *   Response kind 6312 — JSON content: [{ pubkey, rank, follows, followers }, ...]
 *   Error    kind 7000 — ["status","error","<msg>"]
 *
 * The first element of the 6312 content array is always the target itself.
 * rank == 0 means the node is entirely outside the PageRank graph (likely bot/spam).
 *
 * Thresholds (tunable):
 *   >= HIGH_SIGNAL_THRESHOLD   → trusted  (green)
 *   >= MEDIUM_SIGNAL_THRESHOLD → unknown  (neutral)
 *   <  MEDIUM_SIGNAL_THRESHOLD → likely spam (red)
 */

import {
  fetchVertexReputationSingle,
  type VertexRankEntry,
} from './vertexReputationSingle';

// ─── Thresholds ────────────────────────────────────────────────────────────

/** globalPagerank value above which we call an account "high signal" */
export const HIGH_SIGNAL_THRESHOLD = 0.0001;

/** globalPagerank value above which we call an account "neutral / unknown" */
export const MEDIUM_SIGNAL_THRESHOLD = 0.000005;

// ─── Types ─────────────────────────────────────────────────────────────────

export type ReputationTier = 'trusted' | 'neutral' | 'spam';

export interface ReputationResult {
  pubkey: string;
  rank: number;
  tier: ReputationTier;
  follows?: number;
  followers?: number;
  /** true if the key is known to be leaked (per VertexLab response) */
  leaked: boolean;
}

// ─── In-memory batch cache (session-scoped) ────────────────────────────────

const SESSION_CACHE = new Map<string, ReputationResult>();

export function getCachedReputation(pubkey: string): ReputationResult | undefined {
  return SESSION_CACHE.get(pubkey);
}

function tierFromRank(rank: number): ReputationTier {
  if (rank >= HIGH_SIGNAL_THRESHOLD) return 'trusted';
  if (rank >= MEDIUM_SIGNAL_THRESHOLD) return 'neutral';
  return 'spam';
}

function toResult(entry: VertexRankEntry): ReputationResult {
  return {
    pubkey: entry.pubkey,
    rank: entry.rank,
    tier: tierFromRank(entry.rank),
    follows: entry.follows,
    followers: entry.followers,
    leaked: entry.leaked === true,
  };
}

// ─── Single-pubkey reputation fetch ──────────────────────────────────────

/**
 * Fetch and cache the reputation score for a single pubkey.
 *
 * Returns null if the signer is unavailable or the request fails — callers
 * should treat null as "unknown" and not penalise the user for it.
 */
export async function fetchReputation(
  signer: {
    signEvent(e: {
      kind: number;
      content: string;
      tags: string[][];
      created_at: number;
    }): Promise<{ id: string; pubkey: string; sig: string; kind: number; content: string; tags: string[][]; created_at: number }>;
  },
  pubkey: string
): Promise<ReputationResult | null> {
  const cached = SESSION_CACHE.get(pubkey);
  if (cached) return cached;

  try {
    const entries = await fetchVertexReputationSingle(signer, pubkey);
    if (!entries.length) return null;

    const result = toResult(entries[0]);
    SESSION_CACHE.set(pubkey, result);
    return result;
  } catch {
    // Network failure, no credits, etc. — degrade gracefully
    return null;
  }
}

// ─── Batch scorer for a list of pubkeys ──────────────────────────────────

/**
 * Score a batch of pubkeys, returning a map of pubkey → ReputationResult.
 * Pubkeys already cached are served instantly; the rest are fetched in
 * parallel (each as a separate kind-5312 request).
 *
 * We do NOT use kind-5314 (Rank Profiles) here because that endpoint is
 * designed for ranking the *user's* follow list, and it requires targets to
 * be known in advance. Kind-5312 is the correct endpoint for single-target
 * reputation lookup.
 */
export async function batchScoreReputation(
  signer: Parameters<typeof fetchReputation>[0],
  pubkeys: string[],
  /** Skip pubkeys already in this set (e.g. the user's own follow list) */
  skip: Set<string> = new Set()
): Promise<Map<string, ReputationResult>> {
  const results = new Map<string, ReputationResult>();

  const toFetch = pubkeys.filter(pk => {
    if (skip.has(pk)) return false;
    const cached = SESSION_CACHE.get(pk);
    if (cached) { results.set(pk, cached); return false; }
    return true;
  });

  // Fetch up to 10 in parallel to avoid flooding the relay
  const CHUNK = 10;
  for (let i = 0; i < toFetch.length; i += CHUNK) {
    const chunk = toFetch.slice(i, i + CHUNK);
    await Promise.allSettled(
      chunk.map(async pk => {
        const r = await fetchReputation(signer, pk);
        if (r) results.set(pk, r);
      })
    );
  }

  return results;
}

// ─── Spam classification helpers ──────────────────────────────────────────

export function isLikelySpam(result: ReputationResult | undefined): boolean {
  if (!result) return false; // unknown → don't penalise
  return result.tier === 'spam';
}

export function isTrusted(result: ReputationResult | undefined): boolean {
  if (!result) return true; // unknown → give benefit of the doubt
  return result.tier === 'trusted' || result.tier === 'neutral';
}
