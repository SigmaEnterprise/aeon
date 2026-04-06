/**
 * useRelaySet — NIP-51 Relay Sets
 *
 * NIP-51 kind:30002 is an addressable list of relay URLs.
 * Users can publish multiple named relay sets, each identified by a `d` tag.
 *
 * This hook:
 *  1. Fetches the logged-in user's kind:30002 relay set events
 *  2. Fetches a specific relay set by pubkey + identifier
 *
 * https://github.com/nostr-protocol/nips/blob/master/51.md
 */
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export interface RelaySetItem {
  url: string;
  marker?: string; // 'read' | 'write' | undefined = both
}

export interface RelaySet {
  id: string;
  pubkey: string;
  name: string; // d-tag
  title?: string; // title tag if present
  relays: RelaySetItem[];
  createdAt: number;
}

/** Fetch all relay sets for the current user (kind:30002) */
export function useMyRelaySets() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<RelaySet[]>({
    queryKey: ['relay-sets', user?.pubkey ?? ''],
    queryFn: async () => {
      if (!user?.pubkey) return [];

      const events = await nostr.query(
        [{ kinds: [30002], authors: [user.pubkey], limit: 50 }],
        { signal: AbortSignal.timeout(8000) }
      );

      return events.map(ev => {
        const name = ev.tags.find(t => t[0] === 'd')?.[1] ?? 'Unnamed';
        const title = ev.tags.find(t => t[0] === 'title')?.[1];
        const relays: RelaySetItem[] = ev.tags
          .filter(t => t[0] === 'r' && t[1]?.startsWith('wss://'))
          .map(t => ({ url: t[1], marker: t[2] as string | undefined }));

        return {
          id: ev.id,
          pubkey: ev.pubkey,
          name,
          title,
          relays,
          createdAt: ev.created_at,
        };
      });
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });
}

/** Fetch a specific relay set by pubkey and d-tag identifier */
export function useRelaySetByIdentifier(pubkey: string, identifier: string) {
  const { nostr } = useNostr();

  return useQuery<RelaySet | null>({
    queryKey: ['relay-set', pubkey, identifier],
    queryFn: async () => {
      const events = await nostr.query(
        [{ kinds: [30002], authors: [pubkey], '#d': [identifier], limit: 1 }],
        { signal: AbortSignal.timeout(8000) }
      );

      if (!events.length) return null;
      const ev = events[0];
      const name = ev.tags.find(t => t[0] === 'd')?.[1] ?? identifier;
      const title = ev.tags.find(t => t[0] === 'title')?.[1];
      const relays: RelaySetItem[] = ev.tags
        .filter(t => t[0] === 'r' && t[1]?.startsWith('wss://'))
        .map(t => ({ url: t[1], marker: t[2] as string | undefined }));

      return {
        id: ev.id,
        pubkey: ev.pubkey,
        name,
        title,
        relays,
        createdAt: ev.created_at,
      };
    },
    enabled: !!pubkey && !!identifier,
    staleTime: 5 * 60 * 1000,
  });
}
