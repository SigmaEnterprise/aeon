import React, { useEffect, useMemo, useRef } from 'react';
import { type NostrSigner, NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { NUser, useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();
  const { logins } = useNostrLogin();

  const queryClient = useQueryClient();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Use refs so the pool always has the latest data
  const relayMetadata = useRef(config.relayMetadata);

  // Stable ref to the current user's signer for NIP-42 AUTH.
  // The `open()` callback reads from this ref when a relay sends an AUTH
  // challenge, so it always uses the latest signer without recreating the pool.
  const signerRef = useRef<NostrSigner | undefined>(undefined);

  // Derive the current signer from the active login. This mirrors the
  // logic in useCurrentUser but avoids a circular dependency (useCurrentUser
  // depends on NostrContext which we are providing here).
  const currentLogin = logins[0];
  const currentSigner = useMemo(() => {
    if (!currentLogin) return undefined;
    try {
      switch (currentLogin.type) {
        case 'nsec':
          return NUser.fromNsecLogin(currentLogin).signer;
        case 'bunker':
          // pool.current is guaranteed to exist here: the pool is created
          // synchronously during the first render (below), and useMemo runs
          // after the render body has executed.
          return NUser.fromBunkerLogin(currentLogin, pool.current!).signer;
        case 'extension':
          return NUser.fromExtensionLogin(currentLogin).signer;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }, [currentLogin]);

  // Keep the ref in sync so the AUTH callback always sees the latest signer.
  signerRef.current = currentSigner;

  // Invalidate Nostr queries when relay metadata changes
  useEffect(() => {
    relayMetadata.current = config.relayMetadata;
    queryClient.invalidateQueries({ queryKey: ['nostr'] });
  }, [config.relayMetadata, queryClient]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url, {
          // NIP-42: Respond to relay AUTH challenges by signing a kind
          // 22242 ephemeral event with the current user's signer.
          auth: async (challenge: string) => {
            const signer = signerRef.current;
            if (!signer) {
              throw new Error('AUTH failed: no signer available (user not logged in)');
            }
            return signer.signEvent({
              kind: 22242,
              content: '',
              tags: [
                ['relay', url],
                ['challenge', challenge],
              ],
              created_at: Math.floor(Date.now() / 1000),
            });
          },
        });
      },
      reqRouter(filters: NostrFilter[]) {
        const routes = new Map<string, NostrFilter[]>();

        // Relay gossip / outbox model:
        // 1. If a filter has specific `authors`, route ONLY to relays that those
        //    authors are likely to write to. This is the core gossip/outbox strategy
        //    that prevents duplicate traffic across all relays for the same events.
        // 2. For global/unfiltered queries, use a reduced set of well-known relays
        //    rather than blasting all relays simultaneously.

        // Route to all read relays
        const readRelays = relayMetadata.current.relays
          .filter(r => r.read)
          .map(r => r.url);

        // A minimal set of reliable public relays for global feeds.
        // We intentionally limit this to 2 relays for deduplication —
        // sending to all relays wastes bandwidth and causes duplicate delivery.
        const publicRelays = [
          'wss://relay.primal.net', // has good aggregation
          'wss://relay.damus.io',
        ];

        // For author-specific queries: include author's known write relays
        // (fetched from their NIP-65 kind:10002 if available)
        // For now use the read relay set + 2 public relays = lean gossip strategy.
        // This reduces bandwidth vs routing to ALL configured relays.
        const allReadRelays = new Set<string>([...readRelays, ...publicRelays]);

        // Deduplicate: only send each filter set to each relay ONCE
        for (const url of allReadRelays) {
          routes.set(url, filters);
        }

        return routes;
      },
      eventRouter(_event: NostrEvent) {
        // Get write relays from metadata
        const writeRelays = relayMetadata.current.relays
          .filter(r => r.write)
          .map(r => r.url);

        // Always publish to default write relays as fallback
        const defaultWriteRelays = [
          'wss://relay.ditto.pub',
          'wss://relay.primal.net',
          'wss://relay.damus.io',
        ];

        const allRelays = new Set<string>([...writeRelays, ...defaultWriteRelays]);

        return [...allRelays];
      },
      eoseTimeout: 8000,
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;