/**
 * BUD-03: User Server List
 *
 * kind:10063 is a replaceable event where users publish their preferred
 * Blossom media servers as `server` tags.
 *
 * This hook:
 *  1. Fetches the logged-in user's kind:10063 event
 *  2. Extracts ordered server URLs from `server` tags
 *  3. Provides a mutation to publish a new kind:10063 event
 *
 * https://nostrcompass.org/en/topics/bud-03/
 */
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';

const BLOSSOM_KIND = 10063;

/** Default well-known Blossom servers to pre-populate if none found */
const DEFAULT_SERVERS = [
  'https://blossom.primal.net',
  'https://nostr.build',
  'https://void.cat',
];

export function useBlossomServers(pubkey?: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const targetPubkey = pubkey ?? user?.pubkey;

  return useQuery<string[]>({
    queryKey: ['blossom-servers', targetPubkey ?? ''],
    queryFn: async () => {
      if (!targetPubkey) return DEFAULT_SERVERS;

      const events = await nostr.query(
        [{ kinds: [BLOSSOM_KIND], authors: [targetPubkey], limit: 1 }],
        { signal: AbortSignal.timeout(6000) }
      );

      if (!events.length) return DEFAULT_SERVERS;

      const servers = events[0].tags
        .filter(t => t[0] === 'server' && t[1])
        .map(t => {
          // CRITICAL: Blossom uses HTTP/HTTPS REST — never wss://
          // Auto-fix any wss:// URLs that may have been saved incorrectly
          let url: string = t[1];
          if (url.startsWith('wss://')) url = 'https://' + url.slice(6);
          else if (url.startsWith('ws://')) url = 'http://' + url.slice(5);
          return url;
        })
        .filter(url => url.startsWith('https://') || url.startsWith('http://'));

      return servers.length > 0 ? servers : DEFAULT_SERVERS;
    },
    enabled: !!targetPubkey,
    staleTime: 5 * 60 * 1000,
  });
}

/** Publish (or update) the user's kind:10063 Blossom server list */
export function usePublishBlossomServers() {
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (servers: string[]) => {
      const tags = servers
        .filter(s => s.startsWith('https://'))
        .map(s => ['server', s]);

      return publish({
        kind: BLOSSOM_KIND,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blossom-servers', user?.pubkey] });
    },
  });
}
