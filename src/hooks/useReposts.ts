/**
 * useReposts — fetches repost counts for a Nostr event (NIP-18).
 *
 * Queries kind:6 (repost of kind:1), kind:16 (generic repost), and
 * kind:1 quote reposts (kind:1 with an embedded e-tag referencing the event).
 *
 * Returns:
 *  - repostCount   — number of kind:6 / kind:16 reposts
 *  - quoteCount    — number of kind:1 quote reposts
 *  - totalCount    — combined total
 *  - hasReposted   — whether the current user has already reposted
 *  - reposts       — raw repost events
 */

import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';

export interface RepostData {
  repostCount: number;
  quoteCount: number;
  totalCount: number;
  hasReposted: boolean;
  reposts: NostrEvent[];
  quotes: NostrEvent[];
}

export function useReposts(event: NostrEvent, enabled = true) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<RepostData>({
    queryKey: ['reposts', event.id],
    queryFn: async () => {
      const isAddressable = event.kind >= 30000 && event.kind < 40000;
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? '';
      const aCoord = `${event.kind}:${event.pubkey}:${dTag}`;

      // Build filters: always query by event ID (#e), and also by address (#a)
      // for addressable events so we catch both old-style and new-style reposts.
      const repostFilters = isAddressable
        ? [
            { kinds: [16], '#e': [event.id], limit: 100 },
            { kinds: [16], '#a': [aCoord], limit: 100 },
          ]
        : [{ kinds: [6, 16], '#e': [event.id], limit: 200 }];

      // Fetch kind:6 reposts, kind:16 generic reposts, and kind:1 quote reposts
      const events = await nostr.query(
        [
          ...repostFilters,
          {
            kinds: [1],
            '#e': [event.id],
            '#q': [event.id],
            limit: 50,
          },
        ],
        { signal: AbortSignal.timeout(8000) }
      );

      // kind:6 and kind:16 are pure reposts
      const reposts = events.filter(e => e.kind === 6 || e.kind === 16);

      // kind:1 with a q-tag are quote reposts (NIP-18 / NIP-10 #q tag)
      const quotes = events.filter(
        e =>
          e.kind === 1 &&
          e.tags.some(t => t[0] === 'q' && t[1] === event.id)
      );

      const hasReposted = user
        ? reposts.some(r => r.pubkey === user.pubkey)
        : false;

      return {
        repostCount: reposts.length,
        quoteCount: quotes.length,
        totalCount: reposts.length + quotes.length,
        hasReposted,
        reposts,
        quotes,
      };
    },
    enabled: enabled && !!event.id,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}
