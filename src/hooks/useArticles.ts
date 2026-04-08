/**
 * useArticles — NIP-23 Long-form Content hooks.
 *
 * Provides:
 *  - useBrowseArticles()    : kind 30023 global feed (published articles)
 *  - useMyArticles()        : kind 30023 articles authored by the logged-in user
 *  - useMyDrafts()          : kind 30024 drafts authored by the logged-in user
 *  - useArticleByNaddr()    : fetch a single article by its naddr/d-tag
 *
 * NIP-23 specifics:
 *  - kind 30023 = published long-form article (addressable, replaces by pubkey+kind+d)
 *  - kind 30024 = draft (same structure, never shown publicly unless queried directly)
 *  - d tag = unique slug per author (slugified title for new articles)
 *  - title, summary, image, published_at = optional but standard metadata tags
 *  - t tags = hashtags/topics
 */

import { useNostr } from '@nostrify/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from './useCurrentUser';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArticleMeta {
  d: string;
  title: string;
  summary: string;
  image: string;
  publishedAt: number | null;
  tags: string[];
}

/** Extract NIP-23 metadata from a kind 30023/30024 event. */
export function parseArticleMeta(event: NostrEvent): ArticleMeta {
  const getTag = (name: string) =>
    event.tags.find(([t]) => t === name)?.[1] ?? '';

  const d = getTag('d');
  const title = getTag('title') || d || 'Untitled';
  const summary = getTag('summary');
  const image = getTag('image');
  const publishedAtRaw = getTag('published_at');
  const publishedAt = publishedAtRaw ? parseInt(publishedAtRaw, 10) : null;
  const tags = event.tags.filter(([t]) => t === 't').map(([, v]) => v);

  return { d, title, summary, image, publishedAt, tags };
}

/** Slugify a title to use as the d-tag. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `article-${Date.now()}`;
}

/** Validate that a kind:30023 or kind:30024 event has a d tag (required). */
function isValidArticle(event: NostrEvent): boolean {
  if (event.kind !== 30023 && event.kind !== 30024) return false;
  const d = event.tags.find(([t]) => t === 'd')?.[1];
  return typeof d === 'string' && d.length > 0;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Browse published articles from the global feed (kind 30023).
 * Returns paginated articles sorted newest-first.
 */
export function useBrowseArticles(limit = 20): UseQueryResult<NostrEvent[]> {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['articles', 'browse', limit],
    queryFn: async () => {
      const events = await nostr.query(
        [{ kinds: [30023], limit }],
        { signal: AbortSignal.timeout(8000) }
      );
      return events.filter(isValidArticle);
    },
    staleTime: 2 * 60 * 1000,
    retry: 2,
  });
}

/**
 * Fetch published articles (kind 30023) by the logged-in user.
 * MUST filter by author so relay delivers only their events.
 */
export function useMyArticles(): UseQueryResult<NostrEvent[]> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['articles', 'mine', user?.pubkey],
    queryFn: async () => {
      if (!user) return [];
      const events = await nostr.query(
        [{ kinds: [30023], authors: [user.pubkey], limit: 100 }],
        { signal: AbortSignal.timeout(8000) }
      );
      return events.filter(isValidArticle);
    },
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: 2,
  });
}

/**
 * Fetch drafts (kind 30024) by the logged-in user.
 * Always authored-filtered — drafts are private per author.
 */
export function useMyDrafts(): UseQueryResult<NostrEvent[]> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['articles', 'drafts', user?.pubkey],
    queryFn: async () => {
      if (!user) return [];
      const events = await nostr.query(
        [{ kinds: [30024], authors: [user.pubkey], limit: 100 }],
        { signal: AbortSignal.timeout(8000) }
      );
      return events.filter(e => isValidArticle({ ...e, kind: 30024 }));
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    retry: 2,
  });
}

/**
 * Fetch a single article by author pubkey + d-tag.
 * Always author-filtered (NIP-23: naddr includes pubkey for secure lookup).
 */
export function useArticleByCoords(
  pubkey: string | undefined,
  dTag: string | undefined,
  kind: 30023 | 30024 = 30023
): UseQueryResult<NostrEvent | null> {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['articles', 'single', pubkey, dTag, kind],
    queryFn: async () => {
      if (!pubkey || !dTag) return null;
      const events = await nostr.query(
        [{
          kinds: [kind],
          authors: [pubkey],    // CRITICAL: always author-filter addressable events
          '#d': [dTag],
          limit: 1,
        }],
        { signal: AbortSignal.timeout(8000) }
      );
      return events[0] ?? null;
    },
    enabled: !!pubkey && !!dTag,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  });
}
