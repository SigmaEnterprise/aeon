import { useNostr } from '@nostrify/react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

interface FeedOptions {
  authors?: string[];
  limit?: number;
  kinds?: number[];
  hashtag?: string;
}

interface FeedPage {
  events: NostrEvent[];
  until?: number;
}

export function useFeed(options: FeedOptions = {}) {
  const { nostr } = useNostr();
  const { authors, limit = 20, kinds = [1], hashtag } = options;

  return useInfiniteQuery<FeedPage, Error>({
    queryKey: ['feed', { authors, kinds, hashtag }],
    queryFn: async ({ pageParam }) => {
      const until = pageParam as number | undefined;

      const filter: Record<string, unknown> = {
        kinds,
        limit,
      };

      if (authors && authors.length > 0) {
        filter.authors = authors;
      }

      if (until) {
        filter.until = until;
      }

      if (hashtag) {
        filter['#t'] = [hashtag];
      }

      const events = await nostr.query(
        [filter as Parameters<typeof nostr.query>[0][0]],
        { signal: AbortSignal.timeout(8000) }
      );

      const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
      const oldestTimestamp = sorted.length > 0 ? sorted[sorted.length - 1].created_at : undefined;

      return { events: sorted, until: oldestTimestamp };
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.events.length || !lastPage.until) return undefined;
      return lastPage.until - 1;
    },
    staleTime: 30000,
  });
}
