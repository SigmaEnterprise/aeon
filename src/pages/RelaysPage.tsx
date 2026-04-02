import { useState, useEffect } from 'react';
import { useSeoMeta } from '@unhead/react';
import { AppLayout } from '@/components/AppLayout';
import { RelayListManager } from '@/components/RelayListManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { Globe, Plus, Trash2, Wifi, WifiOff, RefreshCw, Radio } from 'lucide-react';
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

export function RelaysPage() {
  useSeoMeta({ title: 'Relays — Aeon', description: 'Manage Nostr relay connections' });

  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [relayStatus, setRelayStatus] = useState<RelayStatusMap>({});

  const currentRelays = config.relayMetadata.relays;

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
              Configure which Nostr relays to connect to. Your NIP-65 relay list is synced when you log in.
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-mono truncate">{relay.url}</span>
                      </div>
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Suggested relays */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Suggested Relays</CardTitle>
            <CardDescription className="text-xs">Popular relays you can add to your list</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {DEFAULT_RELAYS.filter(url => !currentRelays.some(r => r.url === url)).map(url => (
                <div key={url} className="flex items-center justify-between p-2.5 rounded-lg border border-dashed gap-2">
                  <span className="text-sm font-mono text-muted-foreground">{url}</span>
                  <Badge variant="outline" className="text-xs shrink-0">Not added</Badge>
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
