import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

interface FeedOptions {
  /**
   * Explicit author list. When omitted (undefined) the query has NO author
   * filter — i.e. a true global feed. Pass an empty array to skip the query.
   */
  authors?: string[];
  limit?: number;
  kinds?: number[];
  /** Hashtag to filter by (relays that support NIP-12 tag queries) */
  hashtag?: string;
  /** Raw keyword search — relayed via `search` field (NIP-50 compliant relays) */
  keyword?: string;
}

interface FeedPage {
  events: NostrEvent[];
  until?: number;
}

export function useFeed(options: FeedOptions = {}) {
  const { nostr } = useNostr();
  const { authors, limit = 30, kinds = [1], hashtag, keyword } = options;

  // If authors is explicitly [] (empty array) we skip the query entirely.
  const enabled = !authors || authors.length > 0;

  return useInfiniteQuery<FeedPage, Error>({
    queryKey: ['feed', { authors, kinds, hashtag, keyword }],
    queryFn: async ({ pageParam }) => {
      const until = pageParam as number | undefined;

      // Build the filter object — only include fields that are set.
      // Critically: do NOT include `authors` unless explicitly provided,
      // so the global feed truly returns notes from all pubkeys.
      const filter: Record<string, unknown> = { kinds, limit };

      if (authors && authors.length > 0) {
        filter.authors = authors;
      }
      if (until) {
        filter.until = until;
      }
      if (hashtag) {
        filter['#t'] = [hashtag];
      }
      if (keyword) {
        filter.search = keyword;
      }

      const events = await nostr.query(
        [filter as Parameters<typeof nostr.query>[0][0]],
        { signal: AbortSignal.timeout(10000) }
      );

      // Deduplicate and sort newest-first
      const seen = new Set<string>();
      const unique = events.filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      const sorted = unique.sort((a, b) => b.created_at - a.created_at);
      const oldest = sorted.length > 0 ? sorted[sorted.length - 1].created_at : undefined;

      return { events: sorted, until: oldest };
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.events.length || !lastPage.until) return undefined;
      // go one second before the oldest event we have
      return lastPage.until - 1;
    },
    enabled,
    staleTime: 30000,
  });
}
