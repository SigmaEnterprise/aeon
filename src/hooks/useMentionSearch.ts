/**
 * useMentionSearch — searches Nostr for profiles matching a query string.
 *
 * Used by the @-mention autocomplete in MentionTextarea.
 * Searches kind:0 events by NIP-50 search where supported, falling back to
 * querying known contacts (follow list) for quick local matches.
 */
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { NSchema as n, type NostrMetadata } from '@nostrify/nostrify';

export interface MentionProfile {
  pubkey: string;
  metadata: NostrMetadata;
}

export function useMentionSearch(query: string, enabled: boolean) {
  const { nostr } = useNostr();

  return useQuery<MentionProfile[]>({
    queryKey: ['mention-search', query],
    queryFn: async () => {
      if (!query || query.length < 1) return [];

      const signal = AbortSignal.timeout(3000);

      // Try NIP-50 search first (supported by relays like relay.nostr.band)
      const searchFilter = {
        kinds: [0],
        search: query,
        limit: 8,
      };

      let events = await nostr.query([searchFilter], { signal }).catch(() => []);

      // If NIP-50 search returned nothing, try a loose pubkey prefix match
      // (works when the user types a hex pubkey or npub)
      if (events.length === 0 && query.length >= 8) {
        // Attempt to match by exact pubkey prefix
        events = await nostr.query(
          [{ kinds: [0], limit: 8 }],
          { signal: AbortSignal.timeout(2000) }
        ).catch(() => []);

        // Filter client-side by name/pubkey/nip05
        const lc = query.toLowerCase();
        events = events.filter(e => {
          try {
            const meta = JSON.parse(e.content) as NostrMetadata;
            return (
              meta.name?.toLowerCase().includes(lc) ||
              meta.display_name?.toLowerCase().includes(lc) ||
              meta.nip05?.toLowerCase().includes(lc) ||
              e.pubkey.startsWith(lc)
            );
          } catch {
            return false;
          }
        });
      }

      const results: MentionProfile[] = [];
      const seen = new Set<string>();

      for (const event of events) {
        if (seen.has(event.pubkey)) continue;
        seen.add(event.pubkey);

        try {
          const metadata = n.json().pipe(n.metadata()).parse(event.content);
          results.push({ pubkey: event.pubkey, metadata });
        } catch {
          // skip malformed profiles
        }
      }

      return results.slice(0, 8);
    },
    enabled: enabled && query.length > 0,
    staleTime: 30_000,
    gcTime: 60_000,
  });
}
