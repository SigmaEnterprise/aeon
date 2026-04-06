/**
 * RelayExplorerPage — NIP-51 Relay Explorer
 *
 * Initializes a temporary single-relay connection to browse events
 * specifically hosted on that relay. Clicking any relay URL throughout
 * the app navigates here.
 *
 * Features:
 *  - Show relay metadata (NIP-11 info document)
 *  - Recent events from this relay
 *  - Relay status check
 *  - NIP-51 relay sets (kind:30002) published to this relay
 */
import { useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Globe, ArrowLeft, Radio, Wifi, WifiOff, RefreshCw,
  Info, AlertCircle, Loader2, ExternalLink, Copy,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';

// ─── Relay info (NIP-11) ──────────────────────────────────────────────────

interface RelayInfo {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_filters?: number;
    max_event_tags?: number;
    max_content_length?: number;
    auth_required?: boolean;
    payment_required?: boolean;
  };
  icon?: string;
}

function useRelayInfo(relayUrl: string) {
  return useQuery<RelayInfo>({
    queryKey: ['relay-info', relayUrl],
    queryFn: async () => {
      const httpUrl = relayUrl.replace(/^wss?:\/\//, 'https://');
      const res = await fetch(httpUrl, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<RelayInfo>;
    },
    enabled: !!relayUrl,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

// ─── Single-relay event query (no Nostrify pool — direct WebSocket) ────────

function useRelayFeed(relayUrl: string, limit = 30) {
  return useQuery<NostrEvent[]>({
    queryKey: ['relay-feed', relayUrl, limit],
    queryFn: async () => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Relay connection timed out'));
        }, 15000);

        const events: NostrEvent[] = [];
        const subId = `aeon-explore-${Math.random().toString(36).slice(2)}`;

        const ws = new WebSocket(relayUrl);

        ws.onopen = () => {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [1], limit }]));
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data as string) as [string, ...unknown[]];
            if (data[0] === 'EVENT' && data[1] === subId) {
              events.push(data[2] as NostrEvent);
            } else if (data[0] === 'EOSE') {
              clearTimeout(timeout);
              ws.send(JSON.stringify(['CLOSE', subId]));
              ws.close();
              resolve(events.sort((a, b) => b.created_at - a.created_at));
            }
          } catch { /* ignore parse errors */ }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error — relay may be offline'));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          if (events.length > 0) {
            resolve(events.sort((a, b) => b.created_at - a.created_at));
          }
        };
      });
    },
    enabled: !!relayUrl,
    staleTime: 60000,
    retry: 0,
  });
}

// ─── Relay status check ───────────────────────────────────────────────────

function useRelayStatus(relayUrl: string) {
  return useQuery<'online' | 'offline'>({
    queryKey: ['relay-status', relayUrl],
    queryFn: () => {
      return new Promise(resolve => {
        try {
          const ws = new WebSocket(relayUrl);
          const t = setTimeout(() => { ws.close(); resolve('offline'); }, 5000);
          ws.onopen = () => { clearTimeout(t); ws.close(); resolve('online'); };
          ws.onerror = () => { clearTimeout(t); resolve('offline'); };
        } catch {
          resolve('offline');
        }
      });
    },
    enabled: !!relayUrl,
    staleTime: 30000,
  });
}

// ─── Main RelayExplorer page ──────────────────────────────────────────────

export function RelayExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [inputUrl, setInputUrl] = useState('');

  const relayUrl = searchParams.get('relay') ?? '';

  const { data: relayInfo, isLoading: infoLoading, isError: infoError } = useRelayInfo(relayUrl);
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useRelayStatus(relayUrl);
  const { data: feedEvents, isLoading: feedLoading, isError: feedError, refetch: refetchFeed } = useRelayFeed(relayUrl);

  const handleExplore = () => {
    let url = inputUrl.trim();
    if (!url) return;
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }
    setSearchParams({ relay: url });
    setInputUrl('');
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
            <Radio className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Relay Explorer</h1>
            <p className="text-xs text-muted-foreground">Browse events from a specific Nostr relay</p>
          </div>
        </div>

        {/* URL input */}
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-2">
              <Input
                placeholder="wss://relay.example.com"
                value={inputUrl}
                onChange={e => setInputUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleExplore()}
                className="font-mono text-sm"
              />
              <Button onClick={handleExplore} disabled={!inputUrl.trim()}>
                Explore
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* No relay selected */}
        {!relayUrl && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center space-y-2">
              <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">Enter a relay URL above or click any relay link in the app</p>
              <p className="text-xs text-muted-foreground">Relay URLs are clickable throughout the Relays and profile pages</p>
            </CardContent>
          </Card>
        )}

        {relayUrl && (
          <>
            {/* Relay header card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {infoLoading ? (
                        <Skeleton className="h-5 w-40" />
                      ) : (
                        <CardTitle className="text-base truncate">
                          {relayInfo?.name ?? relayUrl.replace(/^wss?:\/\//, '')}
                        </CardTitle>
                      )}
                      {/* Status badge */}
                      {statusLoading ? (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />Checking
                        </Badge>
                      ) : status === 'online' ? (
                        <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30 gap-1 text-xs">
                          <Wifi className="h-2.5 w-2.5" />Online
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <WifiOff className="h-2.5 w-2.5" />Offline
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="font-mono text-xs mt-1 truncate">{relayUrl}</CardDescription>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                      onClick={() => { navigator.clipboard.writeText(relayUrl); toast({ title: 'Relay URL copied!' }); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                      <a href={relayUrl.replace(/^wss?:\/\//, 'https://')} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                      onClick={() => { refetchStatus(); refetchFeed(); }}
                      title="Refresh">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Description */}
                {relayInfo?.description && (
                  <p className="text-sm text-muted-foreground mt-2">{relayInfo.description}</p>
                )}

                {/* Supported NIPs */}
                {relayInfo?.supported_nips && relayInfo.supported_nips.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {relayInfo.supported_nips.slice(0, 12).map(nip => (
                      <Badge key={nip} variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        NIP-{nip}
                      </Badge>
                    ))}
                    {relayInfo.supported_nips.length > 12 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        +{relayInfo.supported_nips.length - 12} more
                      </Badge>
                    )}
                  </div>
                )}

                {/* Limitations */}
                {relayInfo?.limitation && (
                  <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                    {relayInfo.limitation.auth_required && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Info className="h-2.5 w-2.5" />Auth required
                      </Badge>
                    )}
                    {relayInfo.limitation.payment_required && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Info className="h-2.5 w-2.5" />Payment required
                      </Badge>
                    )}
                    {relayInfo.limitation.max_message_length && (
                      <span>Max msg: {(relayInfo.limitation.max_message_length / 1024).toFixed(0)}KB</span>
                    )}
                  </div>
                )}

                {infoError && (
                  <Alert className="mt-2 border-amber-500/30 bg-amber-500/10">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                    <AlertDescription className="text-xs">
                      Could not fetch NIP-11 relay info (CORS or relay offline).
                    </AlertDescription>
                  </Alert>
                )}
              </CardHeader>
            </Card>

            {/* Feed tabs */}
            <Tabs defaultValue="feed">
              <TabsList className="w-full grid grid-cols-1">
                <TabsTrigger value="feed">Recent Notes from this Relay</TabsTrigger>
              </TabsList>

              <TabsContent value="feed" className="space-y-4 mt-4">
                {feedError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Failed to connect to relay. It may be offline or blocking browser connections.
                    </AlertDescription>
                  </Alert>
                )}

                {feedLoading && (
                  <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Card key={i}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-10 w-10 rounded-full" />
                            <div className="space-y-1">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                          </div>
                          <Skeleton className="h-16 w-full" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {!feedLoading && !feedError && feedEvents?.length === 0 && (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center text-muted-foreground">
                      <p>No recent notes found on this relay</p>
                    </CardContent>
                  </Card>
                )}

                {feedEvents?.map(event => (
                  <NoteCard key={event.id} event={event} />
                ))}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AppLayout>
  );
}
