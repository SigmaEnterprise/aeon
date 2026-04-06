/**
 * DirectoryPage — VertexLab DVM-powered discovery
 *
 * Features:
 *  1. Top 50 Global Leaders  — Kind 5314 rank request, 24h cache
 *  2. Full-text profile search — Kind 5315 search request, live as-you-type (>3 chars)
 *  3. Error display for Kind 7000 DVM errors (rate limit, term too short, etc.)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNavigate } from 'react-router-dom';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import {
  fetchVertexRank, fetchVertexSearch,
  useVertexSigner,
  type VertexRankEntry, type VertexSearchEntry,
} from '@/hooks/useVertexDVM';
import {
  Search, Copy, ExternalLink, Globe, Zap, BadgeCheck,
  Trophy, RefreshCw, AlertCircle, Loader2, TrendingUp,
  Star, Award, Medal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NostrMetadata } from '@nostrify/nostrify';
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

// rank medal icons
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Award className="h-4 w-4 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-4 w-4 text-slate-400" />;
  if (rank === 3) return <Medal className="h-4 w-4 text-amber-600" />;
  if (rank <= 10) return <Star className="h-3.5 w-3.5 text-primary" />;
  return null;
}

// ─── Profile metadata fetcher ─────────────────────────────────────────────

function useProfilesMetadata(pubkeys: string[]) {
  const { nostr } = useNostr();
  return useQuery<Record<string, NostrMetadata>>({
    queryKey: ['profiles-meta', pubkeys.slice().sort().join(',')],
    queryFn: async () => {
      if (!pubkeys.length) return {};
      const events = await nostr.query(
        [{ kinds: [0], authors: pubkeys, limit: pubkeys.length }],
        { signal: AbortSignal.timeout(12000) }
      );
      const map: Record<string, NostrMetadata> = {};
      for (const ev of events) {
        try { map[ev.pubkey] = JSON.parse(ev.content) as NostrMetadata; } catch { /* ignore */ }
      }
      return map;
    },
    enabled: pubkeys.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Directory Profile Card ───────────────────────────────────────────────

interface DirectoryCardProps {
  pubkey: string;
  rank?: number;
  rankScore?: number;
  metadata?: NostrMetadata;
  isLoading?: boolean;
  onCopy: (text: string, label: string) => void;
}

function DirectoryCard({ pubkey, rank, rankScore, metadata, isLoading, onCopy }: DirectoryCardProps) {
  const navigate = useNavigate();
  const npub = nip19.npubEncode(pubkey);
  const displayName = metadata?.name ?? genUserName(pubkey);
  const shortNpub = `${npub.slice(0, 12)}…${npub.slice(-6)}`;

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-fade-in hover:shadow-md transition-all duration-200 group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Rank number */}
          {rank !== undefined && (
            <div className="flex flex-col items-center gap-0.5 shrink-0 min-w-[2rem] pt-1">
              <span className="text-xs font-bold text-muted-foreground tabular-nums leading-none">
                #{rank}
              </span>
              <RankBadge rank={rank} />
            </div>
          )}

          {/* Avatar */}
          <Avatar
            className="h-12 w-12 ring-2 ring-border shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => navigate(`/${npub}`)}
          >
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-sm font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-bold text-sm cursor-pointer hover:underline"
                  onClick={() => navigate(`/${npub}`)}
                >
                  {displayName}
                </span>
                {metadata?.display_name && metadata.display_name !== metadata.name && (
                  <span className="text-xs text-muted-foreground">@{metadata.display_name}</span>
                )}
                {metadata?.nip05 && (
                  <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                    <BadgeCheck className="h-2.5 w-2.5" />
                    {metadata.nip05.split('@')[0]}
                  </Badge>
                )}
                {rankScore !== undefined && rankScore > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-primary/30 text-primary">
                    <TrendingUp className="h-2.5 w-2.5" />
                    {rankScore.toFixed(4)}
                  </Badge>
                )}
              </div>

              {/* npub — truncated, full on hover */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-[10px] font-mono text-muted-foreground cursor-default">{shortNpub}</p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="font-mono text-xs max-w-xs break-all">
                  {npub}
                </TooltipContent>
              </Tooltip>
            </div>

            {metadata?.about && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {metadata.about}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {metadata?.website && (
                <a href={metadata.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                  <Globe className="h-2.5 w-2.5" />
                  {metadata.website.replace(/^https?:\/\//, '').slice(0, 30)}
                </a>
              )}
              {metadata?.lud16 && (
                <span className="flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400">
                  <Zap className="h-2.5 w-2.5" />
                  {metadata.lud16.split('@')[0]}
                </span>
              )}
            </div>

            {/* Actions — visible on hover */}
            <div className="flex flex-wrap gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => onCopy(npub, 'npub')}>
                <Copy className="h-2.5 w-2.5" />npub
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => onCopy(pubkey, 'hex')}>
                <Copy className="h-2.5 w-2.5" />hex
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" asChild>
                <a href={`https://njump.me/${npub}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-2.5 w-2.5" />njump
                </a>
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => navigate(`/${npub}`)}>
                View Profile
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Top 50 section ───────────────────────────────────────────────────────

function Top50Section() {
  const signer = useVertexSigner();
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [forceRefresh, setForceRefresh] = useState(0);

  const {
    data: rankEntries,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<VertexRankEntry[]>({
    queryKey: ['vertex-top50', forceRefresh],
    queryFn: async () => {
      if (!signer) throw new Error('Login required to use VertexLab ranking');
      return fetchVertexRank(signer, { sort: 'globalPagerank', limit: 50 });
    },
    enabled: !!signer,
    staleTime: 24 * 60 * 60 * 1000, // 24h — matches localStorage cache
    retry: 1,
  });

  const pubkeys = rankEntries?.map(e => e.pubkey) ?? [];
  const { data: metaMap = {}, isLoading: metaLoading } = useProfilesMetadata(pubkeys);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied!` });
  };

  const handleForceRefresh = () => {
    // Clear the 24h cache and re-fetch
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('vertex:rank:'));
      keys.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
    setForceRefresh(n => n + 1);
    refetch();
  };

  if (!user) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-3">
          <Trophy className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">Login to see Top 50 Leaders</p>
          <p className="text-xs text-muted-foreground">
            VertexLab ranking requires a signed DVM request (kind:5314). Log in with your Nostr key.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-sm">
          {(error as Error).message}
          <Button variant="link" size="sm" className="p-0 h-auto ml-2" onClick={() => refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            Global Top 50
            <Badge variant="secondary" className="text-xs">VertexLab PageRank</Badge>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ranked by global PageRank · refreshes every 24 hours
          </p>
        </div>
        <Button
          variant="ghost" size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={handleForceRefresh}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {(isLoading || isFetching) && !rankEntries && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Querying VertexLab DVM (kind:5314)…
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 shrink-0" />
                  <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Results */}
      {rankEntries && rankEntries.length > 0 && (
        <div className="space-y-2">
          {rankEntries.map((entry, idx) => (
            <DirectoryCard
              key={entry.pubkey}
              pubkey={entry.pubkey}
              rank={idx + 1}
              rankScore={entry.rank}
              metadata={metaMap[entry.pubkey]}
              isLoading={metaLoading && !metaMap[entry.pubkey]}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}

      {rankEntries && rankEntries.length === 0 && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No ranking data returned from VertexLab. Try refreshing.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Search section ───────────────────────────────────────────────────────

function SearchSection() {
  const signer = useVertexSigner();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { nostr } = useNostr();

  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search: fire after 600ms of no typing when >3 chars
  const handleInput = useCallback((value: string) => {
    setSearchInput(value);
    setIsTyping(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setIsTyping(false);
      if (value.trim().length > 3) {
        setActiveSearch(value.trim());
      } else if (value.trim().length === 0) {
        setActiveSearch('');
      }
    }, 600);
  }, []);

  // Check if input is a direct npub/hex — skip DVM and fetch directly
  const directPubkey = decodePubkey(activeSearch);

  // ── Vertex Kind 5315 search ──
  const {
    data: vertexResults,
    isLoading: vertexLoading,
    isError: vertexError,
    error: vertexErr,
  } = useQuery<VertexSearchEntry[]>({
    queryKey: ['vertex-search', activeSearch],
    queryFn: async () => {
      if (!signer) throw new Error('Login required for VertexLab search');
      if (directPubkey) return []; // handled by direct lookup
      return fetchVertexSearch(signer, { query: activeSearch, limit: 50, sort: 'globalPagerank' });
    },
    enabled: !!activeSearch && !directPubkey && !!signer && activeSearch.length > 3,
    staleTime: 30000,
    retry: 1,
  });

  // ── Direct pubkey lookup (fallback for npub/hex input) ──
  const { data: directMeta } = useQuery({
    queryKey: ['profile-direct', directPubkey ?? ''],
    queryFn: async () => {
      if (!directPubkey) return null;
      const events = await nostr.query(
        [{ kinds: [0], authors: [directPubkey], limit: 1 }],
        { signal: AbortSignal.timeout(8000) }
      );
      if (!events.length) return null;
      return JSON.parse(events[0].content) as NostrMetadata;
    },
    enabled: !!directPubkey,
    staleTime: 5 * 60 * 1000,
  });

  const pubkeys = vertexResults?.map(e => e.pubkey) ?? [];
  const { data: metaMap = {} } = useProfilesMetadata(pubkeys);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied!` });
  };

  const isSearching = vertexLoading || isTyping;
  const hasQuery = activeSearch.length > 0;

  return (
    <div className="space-y-4">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, npub, or hex key…"
          value={searchInput}
          onChange={e => handleInput(e.target.value)}
          className="pl-9"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Hint */}
      {searchInput.length > 0 && searchInput.length <= 3 && (
        <p className="text-xs text-muted-foreground">Enter at least 4 characters to search…</p>
      )}

      {/* DVM status */}
      {isSearching && hasQuery && !directPubkey && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching the relay (kind:5315)…
        </div>
      )}

      {/* No login warning */}
      {!user && hasQuery && !directPubkey && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Log in to use VertexLab search (requires signing a kind:5315 request).
            Direct npub/hex lookups still work without login.
          </AlertDescription>
        </Alert>
      )}

      {/* Vertex error display (kind:7000) */}
      {vertexError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {(vertexErr as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Direct pubkey result */}
      {directPubkey && directMeta && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Direct lookup result:</p>
          <DirectoryCard
            pubkey={directPubkey}
            metadata={directMeta}
            onCopy={handleCopy}
          />
        </div>
      )}

      {/* Vertex search results */}
      {vertexResults && vertexResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {vertexResults.length} results · sorted by VertexLab PageRank
          </p>
          {vertexResults.map((entry, idx) => (
            <DirectoryCard
              key={entry.pubkey}
              pubkey={entry.pubkey}
              rank={idx + 1}
              rankScore={entry.rank}
              metadata={metaMap[entry.pubkey]}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}

      {/* No results */}
      {vertexResults?.length === 0 && !vertexLoading && hasQuery && !directPubkey && !isTyping && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground text-sm">No profiles found for "{activeSearch}"</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different name or paste an npub directly.</p>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!hasQuery && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-2">
            <Search className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Search any Nostr profile by name, npub, or hex pubkey
            </p>
            <p className="text-xs text-muted-foreground">
              Powered by VertexLab DVM (kind:5315) · ranked by global PageRank
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main DirectoryPage ───────────────────────────────────────────────────

export function DirectoryPage() {
  useSeoMeta({
    title: 'Directory — Aeon',
    description: 'VertexLab-powered Nostr profile discovery and ranking',
  });

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Page header */}
        <Card className="border-primary/20 shadow-sm bg-gradient-to-br from-card to-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl flex items-center gap-2">
              <span className="text-2xl">🔭</span>
              VertexLab Directory
            </CardTitle>
            <CardDescription>
              Algorithmically ranked Nostr profiles powered by{' '}
              <a
                href="https://vertexlab.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium"
              >
                VertexLab
              </a>
              {' '}Web of Trust · Global PageRank · DVM Search
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="top50">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="top50" className="gap-2">
              <Trophy className="h-4 w-4" />
              Top 50 Leaders
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-4 w-4" />
              Search Profiles
            </TabsTrigger>
          </TabsList>

          <TabsContent value="top50" className="mt-4">
            <Top50Section />
          </TabsContent>

          <TabsContent value="search" className="mt-4">
            <SearchSection />
          </TabsContent>
        </Tabs>

        {/* Support CTA */}
        <SupportButton />
      </div>
    </AppLayout>
  );
}
