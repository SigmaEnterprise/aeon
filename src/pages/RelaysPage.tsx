import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { AppLayout } from '@/components/AppLayout';
import { RelayListManager } from '@/components/RelayListManager';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMyRelaySets } from '@/hooks/useRelaySet';
import { useToast } from '@/hooks/useToast';
import { Globe, Wifi, WifiOff, RefreshCw, Radio, ExternalLink, Copy, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.ditto.pub',
  'wss://purplepag.es',
  'wss://nostr.bitcoiner.social',
];

type RelayStatus = 'checking' | 'online' | 'offline';

interface RelayStatusMap {
  [url: string]: RelayStatus;
}

// ─── Clickable relay URL component ────────────────────────────────────────

function ClickableRelayUrl({ url, className }: { url: string; className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      className={cn('font-mono text-xs text-left hover:text-primary hover:underline transition-colors truncate', className)}
      onClick={() => navigate(`/relay-explorer?relay=${encodeURIComponent(url)}`)}
      title={`Explore ${url}`}
    >
      {url}
    </button>
  );
}

export function RelaysPage() {
  useSeoMeta({ title: 'Relays — Aeon', description: 'Manage Nostr relay connections' });

  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [relayStatus, setRelayStatus] = useState<RelayStatusMap>({});

  const currentRelays = config.relayMetadata.relays;

  // NIP-51 relay sets
  const { data: relaySets = [], isLoading: setsLoading } = useMyRelaySets();

  const checkRelayStatus = (url: string) => {
    setRelayStatus(prev => ({ ...prev, [url]: 'checking' }));
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        setRelayStatus(prev => ({ ...prev, [url]: 'offline' }));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        setRelayStatus(prev => ({ ...prev, [url]: 'online' }));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        setRelayStatus(prev => ({ ...prev, [url]: 'offline' }));
      };
    } catch {
      setRelayStatus(prev => ({ ...prev, [url]: 'offline' }));
    }
  };

  const checkAllRelays = () => {
    currentRelays.forEach(r => checkRelayStatus(r.url));
  };

  useEffect(() => {
    checkAllRelays();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getStatusBadge = (url: string) => {
    const status = relayStatus[url];
    if (status === 'checking') return <Badge variant="secondary" className="text-xs gap-1"><RefreshCw className="h-2.5 w-2.5 animate-spin" />Checking</Badge>;
    if (status === 'online') return <Badge className="text-xs gap-1 bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30"><Wifi className="h-2.5 w-2.5" />Online</Badge>;
    if (status === 'offline') return <Badge variant="destructive" className="text-xs gap-1"><WifiOff className="h-2.5 w-2.5" />Offline</Badge>;
    return <Badge variant="outline" className="text-xs">Unknown</Badge>;
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              Relay Management
            </CardTitle>
            <CardDescription>
              Configure your Nostr relay list. Click any relay URL to explore its events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RelayListManager />
          </CardContent>
        </Card>

        {/* Relay status checker */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                Relay Status
              </CardTitle>
              <Button variant="outline" size="sm" onClick={checkAllRelays} className="gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" />
                Check All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {currentRelays.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No relays configured</p>
            ) : (
              <div className="space-y-2">
                {currentRelays.map(relay => (
                  <div key={relay.url} className="flex items-center justify-between p-3 rounded-lg border bg-card gap-3">
                    <div className="flex-1 min-w-0">
                      <ClickableRelayUrl url={relay.url} />
                      <div className="flex gap-2 mt-1">
                        {relay.read && <Badge variant="secondary" className="text-xs py-0">Read</Badge>}
                        {relay.write && <Badge variant="secondary" className="text-xs py-0">Write</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getStatusBadge(relay.url)}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => checkRelayStatus(relay.url)}
                        title="Re-check"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => navigate(`/relay-explorer?relay=${encodeURIComponent(relay.url)}`)}
                        title="Explore relay"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* NIP-51 Relay Sets */}
        {user && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Your NIP-51 Relay Sets
              </CardTitle>
              <CardDescription className="text-xs">
                Named relay sets (kind:30002) you've published. Each set can be used for specific purposes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {setsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : relaySets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No relay sets found. You can create named relay sets (NIP-51 kind:30002) to organize your relays.
                </p>
              ) : (
                <div className="space-y-3">
                  {relaySets.map(set => (
                    <div key={set.id} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium">{set.title ?? set.name}</p>
                        <Badge variant="outline" className="text-xs">{set.relays.length} relays</Badge>
                      </div>
                      <div className="space-y-1">
                        {set.relays.slice(0, 5).map(r => (
                          <div key={r.url} className="flex items-center gap-2">
                            <ClickableRelayUrl url={r.url} className="flex-1" />
                            {r.marker && (
                              <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4 shrink-0">
                                {r.marker}
                              </Badge>
                            )}
                          </div>
                        ))}
                        {set.relays.length > 5 && (
                          <p className="text-xs text-muted-foreground">+{set.relays.length - 5} more relays</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Suggested relays */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Suggested Relays</CardTitle>
            <CardDescription className="text-xs">
              Popular relays you can explore or add to your list
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {DEFAULT_RELAYS.filter(url => !currentRelays.some(r => r.url === url)).map(url => (
                <div key={url} className="flex items-center justify-between p-2.5 rounded-lg border border-dashed gap-2">
                  <ClickableRelayUrl url={url} className="flex-1 text-muted-foreground hover:text-primary" />
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-1.5 gap-1"
                      onClick={() => navigate(`/relay-explorer?relay=${encodeURIComponent(url)}`)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Explore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => { navigator.clipboard.writeText(url); toast({ title: 'Copied!' }); }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {DEFAULT_RELAYS.every(url => currentRelays.some(r => r.url === url)) && (
                <p className="text-sm text-muted-foreground text-center py-2">All suggested relays are already in your list!</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
