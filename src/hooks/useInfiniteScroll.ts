/**
 * useInfiniteScroll — reusable IntersectionObserver-based infinite scroll hook.
 *
 * Returns a `sentinelRef` callback ref to attach to the sentinel element at
 * the bottom of a list. When the sentinel enters the viewport the `onLoadMore`
 * callback is called — but only when it's safe to do so (not already loading,
 * not paused, and there is a next page).
 *
 * Features:
 * - rootMargin of 400px so loading begins *before* the user hits the sentinel
 * - Single IntersectionObserver instance, properly cleaned up
 * - Threshold of 0 (triggers the moment any pixel is visible)
 * - Respects `enabled` / `paused` flags to avoid double-triggers
 */
import { useRef, useCallback, useEffect } from 'react';

interface UseInfiniteScrollOptions {
  /** Called when the sentinel enters the viewport and loading should begin */
  onLoadMore: () => void;
  /** Whether there is more data to load */
  hasNextPage: boolean | undefined;
  /** Whether a fetch is already in-flight */
  isFetchingNextPage: boolean;
  /** Optionally pause auto-loading (e.g. user clicked Pause) */
  paused?: boolean;
  /** How far from the bottom (in px) to pre-trigger. Default: 400 */
  rootMargin?: number;
}

export function useInfiniteScroll({
  onLoadMore,
  hasNextPage,
  isFetchingNextPage,
  paused = false,
  rootMargin = 400,
}: UseInfiniteScrollOptions) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Stable callback so the ref stays valid across re-renders
  const canLoad = hasNextPage && !isFetchingNextPage && !paused;
  const canLoadRef = useRef(canLoad);
  useEffect(() => { canLoadRef.current = canLoad; }, [canLoad]);

  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);

  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    // Disconnect the previous observer whenever the node changes
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && canLoadRef.current) {
          onLoadMoreRef.current();
        }
      },
      {
        rootMargin: `0px 0px ${rootMargin}px 0px`,
        threshold: 0,
      }
    );

    observerRef.current.observe(node);
  }, [rootMargin]); // rootMargin is intentionally the only dep; others use refs

  // Clean up on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return { sentinelRef };
}
