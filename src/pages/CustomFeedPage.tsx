/**
 * CustomFeedPage — Manual follows + VertexLab Discovery Feeds
 *
 * Three Vertex preset feeds (kind:5316):
 *  📡 The Signal      — trust_depth:2, min_zaps:21k — high-value WoT content
 *  🌐 Global Pulse    — globalPagerank — most reputable across all Nostr
 *  🏕️ Tribe Discovery — wot_overlap:true — content popular in your tribe
 *
 * Plus the original manual "Custom Follow Feed" powered by useFeed.
 * Users can pin Vertex feeds to their sidebar (stored in localStorage).
 */
import { useState, useCallback } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/useToast';
import { useFeed } from '@/hooks/useFeed';
import { useFollowList } from '@/hooks/useFollowList';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  fetchVertexDiscovery, useVertexSigner,
  DISCOVERY_PRESETS, type DiscoveryFeedPreset,
} from '@/hooks/useVertexDVM';
import {
  Loader2, Star, Users, RefreshCw, Radio, Pin, AlertCircle,
  Zap, Globe, TrendingUp, Layers, Lock, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';
import { SupportButton } from '@/components/SupportButton';

// ─── Helpers ──────────────────────────────────────────────────────────────

function decodePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey;
  } catch { /* ignore */ }
  return null;
}

// ─── Vertex Discovery Feed ────────────────────────────────────────────────

function VertexDiscoveryFeed({ preset, pinnedIds, onTogglePin }: {
  preset: DiscoveryFeedPreset;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
}) {
  const signer = useVertexSigner();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { data: followList = [] } = useFollowList();
  const isPinned = pinnedIds.includes(preset.id);

  // ── Step 1: request event IDs from Vertex DVM ──
  const {
    data: discoveryEntries,
    isLoading: dvmLoading,
    isError: dvmError,
    error: dvmErr,
    refetch: refetchDvm,
    isFetching: dvmFetching,
  } = useQuery({
    queryKey: ['vertex-discovery', preset.id, user?.pubkey ?? 'anon', followList.slice(0, 30).join(',')],
    queryFn: async () => {
      if (!signer) throw new Error('Login required to use VertexLab feeds');
      return fetchVertexDiscovery(signer, {
        presetId: preset.id,
        seedPubkeys: followList,
        limit: 30,
      });
    },
    enabled: !!signer && !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Step 2: fetch actual event content by IDs ──
  const eventIds = discoveryEntries?.map(e => e.id).filter(Boolean) ?? [];
  const {
    data: events = [],
    isLoading: eventsLoading,
  } = useQuery<NostrEvent[]>({
    queryKey: ['vertex-events', eventIds.slice().sort().join(',')],
    queryFn: async () => {
      if (!eventIds.length) return [];
      const fetched = await nostr.query(
        [{ ids: eventIds, limit: eventIds.length }],
        { signal: AbortSignal.timeout(12000) }
      );
      // Sort by discovery rank order
      const idOrder = new Map(eventIds.map((id, i) => [id, i]));
      return fetched.sort((a, b) => (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99));
    },
    enabled: eventIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = dvmLoading || eventsLoading;

  if (!user) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-3">
          <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">Login required</p>
          <p className="text-xs text-muted-foreground">
            VertexLab discovery feeds require signing a kind:5316 DVM request.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feed header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <span>{preset.icon}</span>
            {preset.label}
            <Badge variant="secondary" className="text-[10px]">VertexLab</Badge>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{preset.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isPinned ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => onTogglePin(preset.id)}
              >
                <Pin className="h-3 w-3" />
                {isPinned ? 'Pinned' : 'Pin'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPinned ? 'Remove from sidebar' : 'Pin to sidebar for quick access'}
            </TooltipContent>
          </Tooltip>
          <Button
            variant="ghost" size="sm"
            className="h-7 w-7 p-0"
            onClick={() => refetchDvm()}
            disabled={dvmFetching}
            title="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', dvmFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* DVM Error */}
      {dvmError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {(dvmErr as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {dvmLoading ? `Querying VertexLab (kind:5316)…` : 'Fetching events…'}
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1 flex-1">
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

      {/* Events */}
      {!isLoading && events.length > 0 && (
        <div className="space-y-4">
          {events.map(event => (
            <NoteCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !dvmError && events.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-2">
            <Radio className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No events found for this feed.
            </p>
            <p className="text-xs text-muted-foreground">
              Try following more people to seed your Web of Trust.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Manual follow feed ───────────────────────────────────────────────────

function ManualFollowFeed() {
  const { toast } = useToast();
  const [savedPubkeys, setSavedPubkeys] = useLocalStorage<string[]>('aeon:custom-feed-pubkeys', []);
  const [inputValue, setInputValue] = useState(savedPubkeys.join('\n'));
  const [activePubkeys, setActivePubkeys] = useState<string[]>(savedPubkeys);
  const [showEditor, setShowEditor] = useState(savedPubkeys.length === 0);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isFetching,
  } = useFeed({
    authors: activePubkeys.length > 0 ? activePubkeys : undefined,
    kinds: [1, 30023],
    limit: 30,
  });

  const allEvents: NostrEvent[] = (data?.pages ?? []).flatMap(p => p.events);

  const handleSave = () => {
    const lines = inputValue.split('\n').map(l => l.trim()).filter(Boolean);
    const pubkeys: string[] = [];
    const invalid: string[] = [];

    for (const line of lines) {
      const pk = decodePubkey(line);
      if (pk) pubkeys.push(pk);
      else invalid.push(line);
    }

    const unique = [...new Set(pubkeys)];
    setSavedPubkeys(unique);
    setActivePubkeys(unique);
    setShowEditor(false);

    if (invalid.length > 0) {
      toast({ title: `Saved ${unique.length} pubkeys`, description: `${invalid.length} invalid entries skipped.`, variant: 'destructive' });
    } else {
      toast({ title: `Saved ${unique.length} pubkeys!` });
    }
  };

  return (
    <div className="space-y-4">
      {/* Editor toggle */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Manual Follow List
              {savedPubkeys.length > 0 && (
                <Badge variant="secondary">{savedPubkeys.length}</Badge>
              )}
            </CardTitle>
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setShowEditor(v => !v)}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showEditor && 'rotate-90')} />
              {showEditor ? 'Collapse' : 'Edit'}
            </Button>
          </div>
        </CardHeader>
        {showEditor && (
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">
              One npub or hex pubkey per line.
            </p>
            <Textarea
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={"npub1abc...\nnpub1xyz...\n64-char-hex-pubkey..."}
              className="min-h-[100px] font-mono text-xs resize-none"
            />
            <div className="flex gap-2">
              <Button onClick={handleSave} size="sm" className="gap-1.5">
                <Star className="h-3.5 w-3.5" />Save
              </Button>
              <Button variant="outline" onClick={() => refetch()} disabled={isFetching} size="sm" className="gap-1.5">
                <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Feed */}
      {activePubkeys.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">Latest from your follows</h3>
            {allEvents.length > 0 && <span className="text-xs text-muted-foreground">{allEvents.length} notes</span>}
          </div>

          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1 flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))
          ) : allEvents.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground text-sm">
                  No notes from these pubkeys. Try refreshing or add more follows.
                </p>
              </CardContent>
            </Card>
          ) : (
            allEvents.map(event => <NoteCard key={event.id} event={event} />)
          )}

          {hasNextPage && (
            <Button variant="outline" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</> : 'Load more'}
            </Button>
          )}
        </div>
      )}

      {activePubkeys.length === 0 && !showEditor && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">No pubkeys saved yet. Click "Edit" to add follows.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Pinned feeds sidebar notice ──────────────────────────────────────────

function PinnedFeedsInfo({ pinnedIds }: { pinnedIds: string[] }) {
  if (pinnedIds.length === 0) return null;
  const names = pinnedIds
    .map(id => DISCOVERY_PRESETS.find(p => p.id === id))
    .filter(Boolean);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
      <Pin className="h-3 w-3" />
      <span>Pinned: {names.map(p => p!.label).join(', ')}</span>
    </div>
  );
}

// ─── Main CustomFeedPage ──────────────────────────────────────────────────

export function CustomFeedPage() {
  useSeoMeta({
    title: 'Custom Feeds — Aeon',
    description: 'VertexLab Web of Trust discovery feeds and custom follow lists',
  });

  const [pinnedIds, setPinnedIds] = useLocalStorage<string[]>('aeon:pinned-vertex-feeds', []);

  const togglePin = useCallback((id: string) => {
    setPinnedIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, [setPinnedIds]);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <Card className="border-primary/20 shadow-sm bg-gradient-to-br from-card to-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Custom Feeds
            </CardTitle>
            <CardDescription>
              VertexLab Web of Trust algorithms · algorithmic discovery · manual follow list
            </CardDescription>
          </CardHeader>
          {pinnedIds.length > 0 && (
            <CardContent className="pt-0 pb-3">
              <PinnedFeedsInfo pinnedIds={pinnedIds} />
            </CardContent>
          )}
        </Card>

        {/* Feed tabs */}
        <Tabs defaultValue="signal">
          <TabsList className="w-full grid grid-cols-4 h-auto gap-0.5 p-1">
            {DISCOVERY_PRESETS.map(preset => (
              <TabsTrigger
                key={preset.id}
                value={preset.id}
                className="flex flex-col gap-0.5 py-2 px-1 text-[10px] h-auto relative"
              >
                <span className="text-base leading-none">{preset.icon}</span>
                <span className="leading-tight text-center">{preset.label.split(' ')[preset.label.split(' ').length - 1]}</span>
                {pinnedIds.includes(preset.id) && (
                  <Pin className="h-2 w-2 absolute top-1 right-1 text-primary" />
                )}
              </TabsTrigger>
            ))}
            <TabsTrigger value="manual" className="flex flex-col gap-0.5 py-2 px-1 text-[10px] h-auto">
              <Users className="h-4 w-4" />
              <span>Manual</span>
            </TabsTrigger>
          </TabsList>

          {DISCOVERY_PRESETS.map(preset => (
            <TabsContent key={preset.id} value={preset.id} className="mt-4">
              <VertexDiscoveryFeed
                preset={preset}
                pinnedIds={pinnedIds}
                onTogglePin={togglePin}
              />
            </TabsContent>
          ))}

          <TabsContent value="manual" className="mt-4">
            <ManualFollowFeed />
          </TabsContent>
        </Tabs>

        <SupportButton />
      </div>
    </AppLayout>
  );
}
