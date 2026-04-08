/**
 * ArticlesPage — NIP-23 Long-form Content Dashboard
 *
 * Three-tab interface:
 *  - Browse:       global kind:30023 published articles feed (raw relay)
 *  - High Signal:  Vertex PageRank-filtered articles — surfaces high-reputation
 *                  authors only, eliminating spam/slop. Powered by VertexLab
 *                  DVM (kind:5313 globalPagerank → kind:30023 filtered by top authors)
 *  - My Articles:  logged-in user's own kind:30023 articles + kind:30024 drafts
 *
 * Routes:
 *  /articles           → this dashboard
 *  /articles/new       → ArticleEditor (new article)
 *  /articles/edit/:id  → ArticleEditor (edit existing)
 *  /articles/:naddr    → ArticleView (read full article)
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow, format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { AppLayout } from '@/components/AppLayout';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBrowseArticles, useMyArticles, useMyDrafts, parseArticleMeta } from '@/hooks/useArticles';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import {
  fetchHighSignalArticleAuthors,
  useVertexSigner,
  clearVertexCache,
  type VertexRankEntry,
} from '@/hooks/useVertexDVM';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

import {
  BookOpen, PenSquare, Clock, Calendar, Tag, Globe,
  FileText, User, Loader2, RefreshCw, Plus, Edit3, FilePen,
  TrendingUp, Lock, AlertCircle, ShieldCheck, Info,
  BarChart2, Sparkles, ChevronDown, ChevronUp,
} from 'lucide-react';

import type { NostrEvent } from '@nostrify/nostrify';
import { cn } from '@/lib/utils';

// ─── Shared: Article card (used by Browse AND High Signal) ────────────────────

function ArticleCard({
  event,
  rankEntry,
}: {
  event: NostrEvent;
  rankEntry?: VertexRankEntry;
}) {
  const meta = parseArticleMeta(event);
  const author = useAuthor(event.pubkey);
  const authorMeta = author.data?.metadata;
  const displayName = authorMeta?.name ?? genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);

  const naddr = nip19.naddrEncode({
    kind: 30023,
    pubkey: event.pubkey,
    identifier: meta.d,
    relays: [],
  });

  const publishedDate = meta.publishedAt
    ? format(new Date(meta.publishedAt * 1000), 'MMM d, yyyy')
    : formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });

  const wordCount = event.content.trim().split(/\s+/).length;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <Card className="group overflow-hidden hover:shadow-md transition-all duration-200 border hover:border-primary/30 flex flex-col">
      {/* Hero image */}
      {meta.image && (
        <div className="relative h-44 overflow-hidden bg-muted shrink-0">
          <img
            src={meta.image}
            alt={meta.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          {/* Vertex rank badge overlay */}
          {rankEntry && (
            <div className="absolute top-2 right-2">
              <Badge className="text-[10px] px-1.5 h-5 bg-violet-600/90 hover:bg-violet-600 text-white border-0 gap-1 backdrop-blur-sm">
                <BarChart2 className="h-2.5 w-2.5" />
                {rankEntry.rank.toExponential(1)}
              </Badge>
            </div>
          )}
        </div>
      )}

      <CardContent className={cn('flex flex-col flex-1', meta.image ? 'pt-4 pb-4' : 'pt-5 pb-4')}>
        {/* Tags */}
        {meta.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {meta.tags.slice(0, 4).map(tag => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                <Tag className="h-2.5 w-2.5 mr-0.5" />
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Title */}
        <Link to={`/articles/${naddr}`} className="block group/title mb-1.5">
          <h2 className="font-bold text-base leading-snug group-hover/title:text-primary transition-colors line-clamp-2">
            {meta.title}
          </h2>
        </Link>

        {/* Summary */}
        {meta.summary && (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-3 flex-1">
            {meta.summary}
          </p>
        )}

        <Separator className="my-3 opacity-50" />

        {/* Footer */}
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/${npub}`}
            className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          >
            <Avatar className="h-6 w-6 shrink-0">
              <AvatarImage src={authorMeta?.picture} alt={displayName} />
              <AvatarFallback className="text-[9px] font-bold bg-primary/10 text-primary">
                {displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium truncate max-w-[120px]">{displayName}</span>
          </Link>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
            <span className="flex items-center gap-0.5">
              <Calendar className="h-3 w-3" />
              {publishedDate}
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {readMinutes}m
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── My article row ────────────────────────────────────────────────────────────

function MyArticleRow({
  event,
  isDraft = false,
}: {
  event: NostrEvent;
  isDraft?: boolean;
}) {
  const navigate = useNavigate();
  const meta = parseArticleMeta(event);

  const naddr = nip19.naddrEncode({
    kind: isDraft ? 30024 : 30023,
    pubkey: event.pubkey,
    identifier: meta.d,
    relays: [],
  });

  const updatedAt = formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
  const wordCount = event.content.trim().split(/\s+/).length;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/30 transition-colors group">
      {meta.image ? (
        <div className="h-14 w-20 shrink-0 rounded overflow-hidden bg-muted">
          <img src={meta.image} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="h-14 w-20 shrink-0 rounded bg-muted/50 flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground/40" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {isDraft && (
                <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-amber-500/50 text-amber-600 dark:text-amber-400">
                  <FilePen className="h-2.5 w-2.5 mr-0.5" />
                  Draft
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground font-mono truncate">
                d:{meta.d.slice(0, 24)}{meta.d.length > 24 ? '…' : ''}
              </span>
            </div>
            <h3 className="font-semibold text-sm leading-tight truncate">{meta.title}</h3>
            {meta.summary && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{meta.summary}</p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost" size="icon" className="h-7 w-7" title="Edit"
              onClick={() => navigate(`/articles/edit/${naddr}`)}
            >
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            {!isDraft && (
              <Button
                variant="ghost" size="icon" className="h-7 w-7" title="Read"
                onClick={() => navigate(`/articles/${naddr}`)}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {updatedAt}
          </span>
          <span className="flex items-center gap-0.5">
            <BookOpen className="h-2.5 w-2.5" />
            {readMinutes}m · {wordCount} words
          </span>
          {meta.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {meta.tags.slice(0, 3).map(tag => (
                <span key={tag} className="px-1 py-0 rounded bg-muted text-[10px]">#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function BrowseSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <Skeleton className="h-44 rounded-none" />
          <CardContent className="pt-4 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Separator className="my-2 opacity-50" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
          <Skeleton className="h-14 w-20 rounded shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Vertex High Signal Feed ───────────────────────────────────────────────────
//
// Two-phase approach (same pattern as CustomFeedPage's VertexDiscoveryFeed):
//  Phase 1: kind:5313 globalPagerank → top-ranked author pubkeys
//  Phase 2: kind:30023 authored by those pubkeys → their articles
//
// Articles are then sorted by the author's PageRank so the highest-signal
// content surfaces first. Ties broken by recency.

interface RankedArticle {
  event: NostrEvent;
  rankEntry: VertexRankEntry;
}

function VertexHighSignalFeed() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const signer = useVertexSigner();
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAuthors, setShowAuthors] = useState(false);

  // ── Phase 1: Fetch ranked authors from VertexLab ─────────────────────────
  const {
    data: rankedAuthors,
    isLoading: authorsLoading,
    isError: authorsError,
    error: authorsErr,
    isFetching: authorsFetching,
  } = useQuery<VertexRankEntry[]>({
    queryKey: ['vertex-article-authors', 'global', refreshKey],
    queryFn: async () => {
      if (!signer) throw new Error('Login required — Vertex DVM requests must be signed with your Nostr key.');
      return fetchHighSignalArticleAuthors(signer, { mode: 'global', limit: 40 });
    },
    enabled: !!signer && !!user,
    staleTime: 24 * 60 * 60 * 1000, // 24h — PageRank scores are stable
    retry: 1,
  });

  // ── Phase 2: Fetch kind:30023 articles from those ranked pubkeys ──────────
  const rankedPubkeys = rankedAuthors?.map(e => e.pubkey) ?? [];

  const {
    data: rawArticles,
    isLoading: articlesLoading,
    isFetching: articlesFetching,
  } = useQuery<NostrEvent[]>({
    queryKey: ['vertex-articles', rankedPubkeys.join(',')],
    queryFn: async () => {
      if (!rankedPubkeys.length) return [];
      const events = await nostr.query(
        [{ kinds: [30023], authors: rankedPubkeys, limit: 60 }],
        { signal: AbortSignal.timeout(12000) }
      );
      // Validate: must have a d tag
      return events.filter(e => !!e.tags.find(([t]) => t === 'd')?.[1]);
    },
    enabled: rankedPubkeys.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // ── Phase 3: Sort by author PageRank (then by recency as tiebreaker) ──────
  const rankedArticles: RankedArticle[] = (() => {
    if (!rawArticles || !rankedAuthors) return [];
    const rankMap = new Map<string, VertexRankEntry>(
      rankedAuthors.map(e => [e.pubkey, e])
    );
    return rawArticles
      .map(event => ({ event, rankEntry: rankMap.get(event.pubkey)! }))
      .filter(r => !!r.rankEntry)
      .sort((a, b) => {
        const rankDiff = b.rankEntry.rank - a.rankEntry.rank;
        if (Math.abs(rankDiff) > 1e-10) return rankDiff;
        return b.event.created_at - a.event.created_at;
      });
  })();

  const isLoading = authorsLoading || (rankedPubkeys.length > 0 && articlesLoading);
  const isFetching = authorsFetching || articlesFetching;

  const handleRefresh = () => {
    clearVertexCache();
    setRefreshKey(n => n + 1);
  };

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="space-y-4">
        <VertexDisclaimer />
        <Card className="border-dashed">
          <CardContent className="py-14 text-center space-y-3">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm font-medium">Login required</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              High Signal articles use VertexLab DVM requests which must be
              signed with your Nostr key.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Vertex disclaimer ──────────────────────────────────────────── */}
      <VertexDisclaimer />

      {/* ── Controls row ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold">High Signal Articles</span>
          <Badge variant="secondary" className="text-[10px] gap-0.5">
            <BarChart2 className="h-2.5 w-2.5" />
            globalPagerank
          </Badge>
          {rankedArticles.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {rankedArticles.length} articles
            </Badge>
          )}
        </div>

        <Button
          variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
          onClick={handleRefresh}
          disabled={isFetching}
          title="Refresh Vertex rankings"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {authorsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {(authorsErr as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Loading states ─────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            {authorsLoading
              ? 'Querying VertexLab PageRank (kind:5313)…'
              : `Fetching articles from ${rankedPubkeys.length} high-signal authors…`}
          </div>
          <BrowseSkeleton />
        </div>
      )}

      {/* ── Ranked authors collapsible ──────────────────────────────────── */}
      {!isLoading && rankedAuthors && rankedAuthors.length > 0 && (
        <div className="rounded-lg border bg-muted/20 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            onClick={() => setShowAuthors(v => !v)}
          >
            <span className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-violet-500" />
              Showing articles from <strong className="text-foreground">{rankedAuthors.length}</strong> Vertex-ranked authors
            </span>
            {showAuthors
              ? <ChevronUp className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />
            }
          </button>
          {showAuthors && (
            <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto">
              {rankedAuthors.map((entry, i) => (
                <RankedAuthorPill key={entry.pubkey} entry={entry} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Article grid ───────────────────────────────────────────────── */}
      {!isLoading && !authorsError && rankedArticles.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart2 className="h-3 w-3 text-violet-500" />
            Sorted by author PageRank · {rankedArticles.length} articles from {rankedPubkeys.length} authors
            {isFetching && !isLoading && (
              <span className="ml-2 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Updating…
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rankedArticles.map(({ event, rankEntry }) => (
              <ArticleCard
                key={`${event.pubkey}:${event.tags.find(([t]) => t === 'd')?.[1]}`}
                event={event}
                rankEntry={rankEntry}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Empty after load ────────────────────────────────────────────── */}
      {!isLoading && !authorsError && rankedArticles.length === 0 && rankedAuthors && rankedAuthors.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No articles found from these top-ranked authors on your connected relays.
            </p>
            <Button variant="outline" size="sm" className="gap-1.5 mt-2" onClick={handleRefresh}>
              <RefreshCw className="h-3.5 w-3.5" />
              Try refreshing
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Ranked author pill (inside the collapsible) ──────────────────────────────

function RankedAuthorPill({ entry, rank }: { entry: VertexRankEntry; rank: number }) {
  const author = useAuthor(entry.pubkey);
  const meta = author.data?.metadata;
  const name = meta?.name ?? genUserName(entry.pubkey);
  const npub = nip19.npubEncode(entry.pubkey);

  return (
    <Link
      to={`/${npub}`}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 transition-colors min-w-0 group"
    >
      <span className="text-[10px] font-bold text-muted-foreground tabular-nums w-5 text-right shrink-0">
        #{rank}
      </span>
      <Avatar className="h-5 w-5 shrink-0">
        <AvatarImage src={meta?.picture} alt={name} />
        <AvatarFallback className="text-[8px] font-bold bg-violet-500/10 text-violet-600">
          {name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">
        {name}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/60 ml-auto shrink-0 hidden sm:block">
        {entry.rank.toExponential(1)}
      </span>
    </Link>
  );
}

// ─── Vertex disclaimer banner ─────────────────────────────────────────────────

function VertexDisclaimer() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <Alert className="border-violet-500/30 bg-violet-500/5 text-foreground">
      <ShieldCheck className="h-4 w-4 text-violet-500 shrink-0" />
      <AlertDescription className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 text-xs leading-relaxed">
          <p className="font-semibold text-sm text-foreground">
            Powered by VertexLab · globalPagerank
          </p>
          <p className="text-muted-foreground">
            This feed filters articles by <strong>author reputation</strong> using
            VertexLab's Web of Trust PageRank graph (
            <span className="font-mono text-[10px]">kind:5313</span>
            {' '}DVM, ~455k nodes). It ranks high-signal authors — not content — so
            slop and spam from low-reputation keys is automatically excluded.
          </p>
          <p className="text-muted-foreground mt-1 flex items-center gap-1">
            <Info className="h-3 w-3 shrink-0" />
            Results are cached for 24 hours. Rankings reflect the global Nostr
            social graph, not Aeon's opinion. Aeon is not affiliated with VertexLab.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors text-xs mt-0.5"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </AlertDescription>
    </Alert>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ArticlesPage() {
  useSeoMeta({
    title: 'Articles — Aeon',
    description: 'Browse and publish long-form Nostr articles (NIP-23)',
  });

  const { user } = useCurrentUser();
  const [activeTab, setActiveTab] = useState('browse');

  const browseQuery = useBrowseArticles(30);
  const myArticlesQuery = useMyArticles();
  const myDraftsQuery = useMyDrafts();

  const browseArticles = browseQuery.data ?? [];
  const myArticles = myArticlesQuery.data ?? [];
  const myDrafts = myDraftsQuery.data ?? [];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span className="text-xl">🗞️</span>
              Articles
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Long-form content on Nostr · NIP-23
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              onClick={() => {
                browseQuery.refetch();
                if (user) { myArticlesQuery.refetch(); myDraftsQuery.refetch(); }
              }}
              disabled={browseQuery.isFetching}
            >
              <RefreshCw className={cn(`h-3.5 w-3.5`, browseQuery.isFetching ? 'animate-spin' : '')} />
              Refresh
            </Button>

            {user && (
              <Button asChild size="sm" className="gap-1.5 h-8">
                <Link to="/articles/new">
                  <Plus className="h-3.5 w-3.5" />
                  New Article
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-sm h-9">
            <TabsTrigger value="browse" className="gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="high-signal" className="gap-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              High Signal
            </TabsTrigger>
            <TabsTrigger value="mine" className="gap-1.5 text-xs" disabled={!user}>
              <User className="h-3.5 w-3.5" />
              Mine
              {myArticles.length + myDrafts.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 text-[10px] px-1 py-0 h-4">
                  {myArticles.length + myDrafts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Browse Tab ──────────────────────────────────────────────── */}
          <TabsContent value="browse" className="mt-4">
            {browseQuery.isLoading ? (
              <BrowseSkeleton />
            ) : browseArticles.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center space-y-2">
                  <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <p className="font-medium text-sm">No articles found</p>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    No long-form articles (kind:30023) found from your connected relays.
                    Try refreshing or check your relay connections.
                  </p>
                  {user && (
                    <Button asChild size="sm" className="mt-2">
                      <Link to="/articles/new">
                        <PenSquare className="h-3.5 w-3.5 mr-1.5" />
                        Be the first — Write an Article
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">
                    {browseArticles.length} article{browseArticles.length !== 1 ? 's' : ''} found
                  </p>
                  {browseQuery.isFetching && !browseQuery.isLoading && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Updating…
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {browseArticles.map(event => (
                    <ArticleCard
                      key={`${event.pubkey}:${event.tags.find(([t]) => t === 'd')?.[1]}`}
                      event={event}
                    />
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── High Signal Tab ─────────────────────────────────────────── */}
          <TabsContent value="high-signal" className="mt-4">
            <VertexHighSignalFeed />
          </TabsContent>

          {/* ── My Articles Tab ─────────────────────────────────────────── */}
          <TabsContent value="mine" className="mt-4">
            {!user ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center">
                  <p className="text-sm text-muted-foreground">Log in to view your articles and drafts.</p>
                </CardContent>
              </Card>
            ) : (myArticlesQuery.isLoading || myDraftsQuery.isLoading) ? (
              <MySkeleton />
            ) : (myArticles.length === 0 && myDrafts.length === 0) ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center space-y-3">
                  <PenSquare className="h-10 w-10 mx-auto text-muted-foreground/30" />
                  <div>
                    <p className="font-medium text-sm">No articles yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Start writing your first long-form article on Nostr.
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link to="/articles/new">
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Write your first article
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-5">
                {myArticles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-3">
                      <Globe className="h-4 w-4 text-primary" />
                      <h2 className="font-semibold text-sm">Published</h2>
                      <Badge variant="secondary" className="text-[10px]">{myArticles.length}</Badge>
                    </div>
                    {myArticles.map(event => (
                      <MyArticleRow
                        key={`${event.pubkey}:${event.tags.find(([t]) => t === 'd')?.[1]}`}
                        event={event}
                        isDraft={false}
                      />
                    ))}
                  </div>
                )}

                {myDrafts.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-3">
                      <FilePen className="h-4 w-4 text-amber-500" />
                      <h2 className="font-semibold text-sm">Drafts</h2>
                      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400">
                        {myDrafts.length}
                      </Badge>
                    </div>
                    {myDrafts.map(event => (
                      <MyArticleRow
                        key={`${event.pubkey}:${event.tags.find(([t]) => t === 'd')?.[1]}`}
                        event={event}
                        isDraft={true}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
