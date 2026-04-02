import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * Fetches the logged-in user's NIP-02 contact list (kind 3).
 * Returns an array of pubkeys they follow.
 */
export function useFollowList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<string[]>({
    queryKey: ['follow-list', user?.pubkey ?? ''],
    queryFn: async () => {
      if (!user?.pubkey) return [];

      const events = await nostr.query(
        [{ kinds: [3], authors: [user.pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(8000) }
      );

      if (!events.length) return [];

      // NIP-02: each "p" tag is a followed pubkey
      return events[0].tags
        .filter(t => t[0] === 'p' && t[1]?.length === 64)
        .map(t => t[1]);
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
