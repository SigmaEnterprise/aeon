/**
 * CustomFeedPage — Manual follows + VertexLab Discovery Feeds
 *
 * Three Vertex discovery tabs, all using real VertexLab API kinds:
 *
 *  🌐 Top Global    → Kind 5313 sort:globalPagerank
 *                     Globally highest-ranked profiles to follow
 *
 *  📡 My Network    → Kind 5313 sort:personalizedPagerank source:<user_pubkey>
 *                     Personalized recommendations from the user's social graph
 *
 *  ⭐ Rank My Follows → Kind 5314 targets:<user_follow_list>
 *                       User's existing follows sorted by global PageRank
 *
 *  👥 Manual        → useFeed with saved pubkeys (original behaviour)
 *
 * IMPORTANT: Kind 5316 does not exist in VertexLab. Discovery feeds return
 * ranked *pubkeys*, not event IDs. We then fetch their latest Kind 1 notes
 * from the Nostr relay to show a social feed.
 */
import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/useToast';
import { useFeed } from '@/hooks/useFeed';
import { useFollowList } from '@/hooks/useFollowList';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import {
  fetchVertexRecommendFollows,
  fetchVertexRankProfiles,
  clearVertexCache,
  useVertexSigner,
  DISCOVERY_PRESETS,
  type DiscoveryFeedPreset,
  type VertexRankEntry,
} from '@/hooks/useVertexDVM';
import {
  Loader2, Star, Users, RefreshCw, AlertCircle,
  TrendingUp, Lock, ChevronRight, Trophy, Pin, ArrowUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { SupportButton } from '@/components/SupportButton';
import { genUserName } from '@/lib/genUserName';

// ─── Helpers ──────────────────────────────────────────────────────────────

function decodePubkey(input: string): string | null {
  const t = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return t.toLowerCase();
  try {
    const d = nip19.decode(t);
    if (d.type === 'npub') return d.data as string;
    if (d.type === 'nprofile') return (d.data as { pubkey: string }).pubkey;
  } catch { /* ignore */ }
  return null;
}

// ─── Ranked profile mini-card ─────────────────────────────────────────────

function RankedProfileCard({ entry, rank }: { entry: VertexRankEntry; rank: number }) {
  const navigate = useNavigate();
  const author = useAuthor(entry.pubkey);
  const meta = author.data?.metadata as NostrMetadata | undefined;
  const npub = nip19.npubEncode(entry.pubkey);
  const name = meta?.name ?? genUserName(entry.pubkey);

  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group"
      onClick={() => navigate(`/${npub}`)}
    >
      <span className="text-xs font-bold text-muted-foreground tabular-nums w-6 text-right shrink-0">
        #{rank}
      </span>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-xs font-bold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        {meta?.picture && <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>}
        <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        {entry.followers !== undefined && (
          <p className="text-[10px] text-muted-foreground">
            {entry.followers.toLocaleString()} followers
          </p>
        )}
      </div>
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-primary/30 text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <TrendingUp className="h-2.5 w-2.5" />
        {entry.rank.toExponential(1)}
      </Badge>
    </div>
  );
}

// ─── Vertex Discovery Feed ────────────────────────────────────────────────

function VertexDiscoveryFeed({ preset }: { preset: DiscoveryFeedPreset }) {
  const signer = useVertexSigner();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { data: followList = [], isLoading: followsLoading } = useFollowList();
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Step 1: get ranked pubkeys from VertexLab ──
  const {
    data: rankedEntries,
    isLoading: vertexLoading,
    isError: vertexError,
    error: vertexErr,
    isFetching,
  } = useQuery<VertexRankEntry[]>({
    queryKey: ['vertex-feed', preset.id, user?.pubkey ?? 'anon', refreshKey],
    queryFn: async () => {
      if (!signer) throw new Error('Login required to use VertexLab feeds');

      if (preset.requiresFollows) {
        // Kind 5314: rank the user's existing follow list
        if (followList.length === 0) {
          throw new Error('Your follow list is empty. Follow some people on Nostr first.');
        }
        return fetchVertexRankProfiles(signer, {
          targets: followList.slice(0, 500), // max 500 for performance
          sort: preset.sort,
          limit: 50,
        });
      } else {
        // Kind 5313: recommend follows (global or personalized)
        return fetchVertexRecommendFollows(signer, {
          sort: preset.sort,
          source: preset.sort === 'personalizedPagerank' ? user?.pubkey : undefined,
          limit: 50,
        });
      }
    },
    enabled: !!signer && !!user && (preset.requiresFollows ? !followsLoading : true),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Step 2: fetch recent Kind 1 notes from the ranked pubkeys ──
  const topPubkeys = rankedEntries?.slice(0, 30).map(e => e.pubkey) ?? [];

  const { data: notes = [], isLoading: notesLoading } = useQuery<NostrEvent[]>({
    queryKey: ['vertex-feed-notes', topPubkeys.join(',')],
    queryFn: async () => {
      if (!topPubkeys.length) return [];
      const events = await nostr.query(
        [{ kinds: [1], authors: topPubkeys, limit: 30 }],
        { signal: AbortSignal.timeout(12000) }
      );
      // Sort newest first
      return events.sort((a, b) => b.created_at - a.created_at);
    },
    enabled: topPubkeys.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = vertexLoading || (topPubkeys.length > 0 && notesLoading);

  const handleRefresh = () => {
    clearVertexCache();
    setRefreshKey(n => n + 1);
  };

  if (!user) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-3">
          <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">Login required</p>
          <p className="text-xs text-muted-foreground">
            VertexLab feeds require signing a DVM request with your Nostr key.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <span>{preset.icon}</span>
            {preset.label}
            <Badge variant="secondary" className="text-[10px]">
              {preset.requiresFollows ? 'kind:5314' : 'kind:5313'}
            </Badge>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{preset.description}</p>
        </div>
        <Button
          variant="ghost" size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={handleRefresh}
          disabled={isFetching}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {/* Error */}
      {vertexError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">{(vertexErr as Error).message}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {vertexLoading
              ? `Querying VertexLab (${preset.requiresFollows ? 'kind:5314' : 'kind:5313'})…`
              : 'Fetching notes from ranked profiles…'}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
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

      {/* Ranked profiles list */}
      {!isLoading && rankedEntries && rankedEntries.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors py-1">
            <Trophy className="h-3.5 w-3.5" />
            View {rankedEntries.length} ranked profiles from VertexLab
            <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90 transition-transform ml-auto" />
          </summary>
          <div className="mt-2 space-y-1 max-h-64 overflow-y-auto pr-1">
            {rankedEntries.map((entry, i) => (
              <RankedProfileCard key={entry.pubkey} entry={entry} rank={i + 1} />
            ))}
          </div>
        </details>
      )}

      {/* Notes feed */}
      {!isLoading && notes.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Latest notes from top {topPubkeys.length} ranked profiles
          </p>
          {notes.map(event => <NoteCard key={event.id} event={event} />)}
        </div>
      )}

      {!isLoading && !vertexError && notes.length === 0 && rankedEntries && rankedEntries.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No recent notes from these profiles. Try refreshing.
          </CardContent>
        </Card>
      )}

      {!isLoading && !vertexError && !rankedEntries && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-sm text-muted-foreground">Ready to query VertexLab</p>
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

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isFetching } =
    useFeed({ authors: activePubkeys.length > 0 ? activePubkeys : undefined, kinds: [1, 6, 16, 30023], limit: 30 });

  const allEvents: NostrEvent[] = (data?.pages ?? []).flatMap(p => p.events);

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    rootMargin: 400,
  });

  const handleSave = () => {
    const lines = inputValue.split('\n').map(l => l.trim()).filter(Boolean);
    const pubkeys: string[] = [];
    const invalid: string[] = [];
    for (const line of lines) {
      const pk = decodePubkey(line);
      if (pk) pubkeys.push(pk); else invalid.push(line);
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
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Manual Follow List
              {savedPubkeys.length > 0 && <Badge variant="secondary">{savedPubkeys.length}</Badge>}
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5"
              onClick={() => setShowEditor(v => !v)}>
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showEditor && 'rotate-90')} />
              {showEditor ? 'Collapse' : 'Edit'}
            </Button>
          </div>
        </CardHeader>
        {showEditor && (
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">One npub or hex pubkey per line.</p>
            <Textarea
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={"npub1abc...\nnpub1xyz...\n64-char-hex..."}
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

      {activePubkeys.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">Latest from your follows</h3>
            {allEvents.length > 0 && <span className="text-xs text-muted-foreground">{allEvents.length} notes</span>}
          </div>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1 flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div>
                  </div>
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))
          ) : allEvents.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground text-sm">No notes found. Try refreshing.</p>
              </CardContent>
            </Card>
          ) : (
            allEvents.map(event => <NoteCard key={event.id} event={event} />)
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

          {isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Loading more notes…</span>
            </div>
          )}

          {!hasNextPage && allEvents.length > 0 && (
            <div className="text-center py-4 space-y-1">
              <p className="text-xs text-muted-foreground">{allEvents.length} notes loaded</p>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                <ArrowUp className="h-3 w-3" />Back to top
              </Button>
            </div>
          )}
        </div>
      )}

      {activePubkeys.length === 0 && !showEditor && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">No pubkeys saved. Click "Edit" to add follows.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export function CustomFeedPage() {
  useSeoMeta({
    title: 'Custom Feeds — Aeon',
    description: 'VertexLab Web of Trust discovery feeds and custom follow lists',
  });

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="border-primary/20 shadow-sm bg-gradient-to-br from-card to-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <Pin className="h-5 w-5 text-primary" />
              Custom Feeds
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              VertexLab Web of Trust · personalizedPagerank · globalPagerank · manual follow list
            </p>
          </CardHeader>
        </Card>

        <Tabs defaultValue="top-global">
          <TabsList className="w-full grid grid-cols-4 h-auto gap-0.5 p-1">
            {DISCOVERY_PRESETS.map(preset => (
              <TabsTrigger
                key={preset.id}
                value={preset.id}
                className="flex flex-col gap-0.5 py-2 px-1 text-[10px] h-auto"
              >
                <span className="text-base leading-none">{preset.icon}</span>
                <span className="leading-tight text-center line-clamp-1">
                  {preset.label.split(' ').slice(-1)[0]}
                </span>
              </TabsTrigger>
            ))}
            <TabsTrigger value="manual" className="flex flex-col gap-0.5 py-2 px-1 text-[10px] h-auto">
              <Users className="h-4 w-4" />
              <span>Manual</span>
            </TabsTrigger>
          </TabsList>

          {DISCOVERY_PRESETS.map(preset => (
            <TabsContent key={preset.id} value={preset.id} className="mt-4">
              <VertexDiscoveryFeed preset={preset} />
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
