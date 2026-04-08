/**
 * useMentionSearch — searches Nostr for profiles matching a query string.
 *
 * Strategy (in priority order):
 * 1. NIP-50 search on relay.nostr.band — the most reliable search relay
 * 2. NIP-50 search on nostr.wine — another good search relay
 * 3. Client-side filter of cached TanStack Query entries (already-fetched profiles)
 *
 * Returns up to 8 matching profiles with metadata.
 */
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NSchema as n, type NostrMetadata } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

export interface MentionProfile {
  pubkey: string;
  metadata: NostrMetadata;
}

// NIP-50 capable relays — queried directly for search
const SEARCH_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nostr.wine',
];

export function useMentionSearch(query: string, enabled: boolean) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  return useQuery<MentionProfile[]>({
    queryKey: ['mention-search', query],
    queryFn: async () => {
      if (!query || query.length < 1) return [];

      const lc = query.toLowerCase().trim();
      const results: MentionProfile[] = [];
      const seen = new Set<string>();

      // ── 1. Try NIP-50 search on dedicated search relays ──────────────────
      for (const relayUrl of SEARCH_RELAYS) {
        if (results.length >= 8) break;
        try {
          const relay = nostr.relay(relayUrl);
          const events = await relay.query(
            [{ kinds: [0], search: lc, limit: 8 }],
            { signal: AbortSignal.timeout(3000) }
          );

          for (const event of events) {
            if (seen.has(event.pubkey) || results.length >= 8) continue;
            seen.add(event.pubkey);
            try {
              const metadata = n.json().pipe(n.metadata()).parse(event.content);
              results.push({ pubkey: event.pubkey, metadata });
            } catch { /* skip malformed */ }
          }
        } catch {
          // relay unavailable or doesn't support NIP-50 — try next
        }
      }

      // ── 2. Client-side search through cached author profiles ──────────────
      // This searches profiles we've already fetched (visible in the feed)
      // which works even without NIP-50 relay support
      if (results.length < 8) {
        const cache = queryClient.getQueriesData<{ metadata?: NostrMetadata; event?: { pubkey: string } }>({
          queryKey: ['nostr', 'author'],
        });

        for (const [, data] of cache) {
          if (!data?.metadata || !data?.event?.pubkey) continue;
          if (results.length >= 8) break;

          const pubkey = data.event.pubkey;
          if (seen.has(pubkey)) continue;

          const meta = data.metadata;
          const nameMatch =
            meta.name?.toLowerCase().includes(lc) ||
            meta.display_name?.toLowerCase().includes(lc) ||
            meta.nip05?.toLowerCase().includes(lc);

          // Also match if user types an npub or hex prefix
          let pubkeyMatch = pubkey.startsWith(lc);
          if (!pubkeyMatch && lc.startsWith('npub1')) {
            try {
              const decoded = nip19.decode(lc);
              if (decoded.type === 'npub') pubkeyMatch = pubkey === decoded.data;
            } catch { /* ignore */ }
          }

          if (nameMatch || pubkeyMatch) {
            seen.add(pubkey);
            results.push({ pubkey, metadata: meta });
          }
        }
      }

      // Sort: prefer exact name starts-with over partial matches
      results.sort((a, b) => {
        const aName = (a.metadata.name ?? '').toLowerCase();
        const bName = (b.metadata.name ?? '').toLowerCase();
        const aStarts = aName.startsWith(lc) ? 0 : 1;
        const bStarts = bName.startsWith(lc) ? 0 : 1;
        return aStarts - bStarts;
      });

      return results.slice(0, 8);
    },
    enabled: enabled && query.length > 0,
    staleTime: 15_000,
    gcTime: 60_000,
  });
}
