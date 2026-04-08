/**
 * useEventEngagement — fetches real-time engagement counts for a Nostr event.
 *
 * Fetches in a single combined query:
 *  - Kind 1  replies (events where e tag points to target with reply/root marker)
 *  - Kind 6  reposts (NIP-18)
 *  - Kind 16 generic reposts (NIP-18)
 *  - Kind 7  reactions (likes, +1, emoji)
 *  - Kind 9735 zap receipts
 *
 * Returns structured counts and the raw events for thread expansion.
 */
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

export interface EngagementData {
  replyCount: number;
  repostCount: number;
  reactionCount: number;
  zapCount: number;
  zapTotal: number; // total sats
  replies: NostrEvent[];
  reposts: NostrEvent[];
  reactions: NostrEvent[];
  zaps: NostrEvent[];
}

export function useEventEngagement(eventId: string, enabled = true) {
  const { nostr } = useNostr();

  return useQuery<EngagementData>({
    queryKey: ['engagement', eventId],
    queryFn: async () => {
      // Single combined query for all engagement kinds
      const events = await nostr.query(
        [
          {
            kinds: [1, 6, 7, 16, 9735],
            '#e': [eventId],
            limit: 300,
          },
        ],
        { signal: AbortSignal.timeout(10000) }
      );

      const replies = events.filter(e => e.kind === 1);
      const reposts = events.filter(e => e.kind === 6 || e.kind === 16);
      const reactions = events.filter(e => e.kind === 7);
      const zaps = events.filter(e => e.kind === 9735);

      // Calculate total sats from zap receipts
      let zapTotal = 0;
      for (const zap of zaps) {
        try {
          const bolt11Tag = zap.tags.find(t => t[0] === 'bolt11')?.[1];
          if (bolt11Tag) {
            // Extract amount from bolt11 - look for millisatoshi amount
            const descTag = zap.tags.find(t => t[0] === 'description')?.[1];
            if (descTag) {
              const zapReq = JSON.parse(descTag) as NostrEvent;
              const amountTag = zapReq.tags?.find((t: string[]) => t[0] === 'amount')?.[1];
              if (amountTag) {
                zapTotal += Math.floor(parseInt(amountTag) / 1000); // msats to sats
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      return {
        replyCount: replies.length,
        repostCount: reposts.length,
        reactionCount: reactions.length,
        zapCount: zaps.length,
        zapTotal,
        replies: replies.sort((a, b) => a.created_at - b.created_at),
        reposts,
        reactions,
        zaps,
      };
    },
    enabled: enabled && !!eventId,
    staleTime: 30000,
    refetchInterval: 60000, // refresh every minute for real-time feel
  });
}
