import { useState, useRef } from 'react';
import { useSeoMeta } from '@unhead/react';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MentionTextarea } from '@/components/MentionTextarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { useFeed } from '@/hooks/useFeed';
import { useFollowList } from '@/hooks/useFollowList';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { cn } from '@/lib/utils';
import {
  Loader2, RefreshCw, PauseCircle, PlayCircle, Send,
  Paperclip, Tag, Zap, Image as ImageIcon, Globe, Users, Search, AtSign,
  ArrowUp,
} from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { SupportButton } from '@/components/SupportButton';

// ─── Feed mode ───────────────────────────────────────────────────────────────

type FeedMode = 'global' | 'following' | 'search';

// ─── Mention badge (shown under compose box) ──────────────────────────────────

import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { X } from 'lucide-react';

function MentionBadge({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const author = useAuthor(pubkey);
  const displayName = author.data?.metadata?.name ?? genUserName(pubkey);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[11px] font-medium px-2 py-0.5 ring-1 ring-primary/20">
      <Avatar className="h-3.5 w-3.5">
        <AvatarImage src={author.data?.metadata?.picture} />
        <AvatarFallback className="text-[7px]">{displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      @{displayName}
      <button type="button" onClick={onRemove} className="ml-0.5 hover:text-destructive transition-colors">
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function FeedPage() {
  useSeoMeta({
    title: 'Feed — Aeon',
    description: 'Global Nostr feed',
  });

  const { user } = useCurrentUser();
  const { mutate: publishEvent, isPending: isPublishing } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  // ── Compose state ──────────────────────────────────────────────────────────
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [paused, setPaused] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [mentionedPubkeys, setMentionedPubkeys] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleMentionSelect = (pubkey: string) => {
    setMentionedPubkeys(prev => new Set([...prev, pubkey]));
  };

  // ── Feed mode ──────────────────────────────────────────────────────────────
  const [feedMode, setFeedMode] = useState<FeedMode>('global');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // ── Follow list (NIP-02) ───────────────────────────────────────────────────
  const { data: followedPubkeys = [], isLoading: followLoading } = useFollowList();

  // ── Feed queries ───────────────────────────────────────────────────────────
  // Global feed – no author filter, kind:1 notes + kind:30023 long-form articles
  const globalFeed = useFeed({ kinds: [1, 30023], limit: 30 });

  // Following feed – filter by NIP-02 contact list
  const followingFeed = useFeed({
    kinds: [1, 30023],
    limit: 30,
    authors: followedPubkeys.length > 0 ? followedPubkeys : undefined,
  });

  // Keyword / hashtag search feed
  const searchFeed = useFeed({
    kinds: [1, 30023],
    limit: 30,
    hashtag: activeSearch || undefined,
  });

  // Pick the active query object
  const activeFeed =
    feedMode === 'global'    ? globalFeed :
    feedMode === 'following' ? followingFeed :
                               searchFeed;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isFetching } = activeFeed;

  const allEvents: NostrEvent[] = (data?.pages ?? []).flatMap(p => p.events);

  // ── Infinite scroll ────────────────────────────────────────────────────────
  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    paused,
    rootMargin: 600, // start loading 600px before bottom
  });

  // ── Publish ────────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to publish.', variant: 'destructive' });
      return;
    }

    let finalContent = content.trim();
    const eventTags: string[][] = [];

    if (selectedFile) {
      try {
        const uploadedTags = await uploadFile(selectedFile);
        const urlTag = uploadedTags.find(t => t[0] === 'url');
        if (urlTag) {
          finalContent = finalContent ? `${finalContent}\n\n${urlTag[1]}` : urlTag[1];
          // Add imeta tag for proper NIP-94 metadata
          const imetaValues = uploadedTags.map(t => t.join(' '));
          eventTags.push(['imeta', ...imetaValues]);
        }
      } catch (err) {
        toast({ title: 'Upload failed', description: (err as Error).message, variant: 'destructive' });
        return;
      }
    }

    if (!finalContent) {
      toast({ title: 'Nothing to publish', description: 'Write something first.', variant: 'destructive' });
      return;
    }

    tags.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => eventTags.push(['t', tag]));

    // NIP-27: add p tags for every mentioned pubkey so they get notified
    for (const pubkey of mentionedPubkeys) {
      eventTags.push(['p', pubkey]);
    }

    publishEvent(
      { kind: 1, content: finalContent, tags: eventTags, created_at: Math.floor(Date.now() / 1000) },
      {
        onSuccess: () => {
          toast({ title: 'Note published!' });
          setContent('');
          setTags('');
          setSelectedFile(null);
          setMentionedPubkeys(new Set());
          setComposeOpen(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          refetch();
        },
        onError: (err) => {
          toast({ title: 'Failed to publish', description: (err as Error).message, variant: 'destructive' });
        },
      }
    );
  };

  const handleSearchSubmit = () => {
    const q = searchQuery.trim().replace(/^#/, '');
    if (!q) return;
    setActiveSearch(q);
    setFeedMode('search');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">

        {/* ── Header row: title + controls ─────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Feed
          </h1>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5 h-8"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaused(p => !p)}
              className="gap-1.5 h-8"
            >
              {paused
                ? <><PlayCircle className="h-3.5 w-3.5" />Resume</>
                : <><PauseCircle className="h-3.5 w-3.5" />Pause</>}
            </Button>

            {user && (
              <Button
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => setComposeOpen(o => !o)}
              >
                <Send className="h-3.5 w-3.5" />
                {composeOpen ? 'Close' : 'New Note'}
              </Button>
            )}

            {paused && <Badge variant="secondary" className="text-xs">Paused</Badge>}
          </div>
        </div>

        {/* ── Compose panel (collapsible) ───────────────────────────────── */}
        {composeOpen && user && (
          <Card className="shadow-sm animate-fade-in border-primary/30">
            <CardContent className="pt-4 space-y-3">
              {/* Mention hint */}
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AtSign className="h-3 w-3" />
                <span>Type <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">@name</kbd> to mention someone</span>
              </div>
              <MentionTextarea
                value={content}
                onChange={setContent}
                onMentionSelect={handleMentionSelect}
                placeholder="What's on your mind?"
                minHeight="90px"
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePublish(); }}
              />
              {/* Mentioned pubkeys badge strip */}
              {mentionedPubkeys.size > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Mentioning:</span>
                  {[...mentionedPubkeys].map(pk => (
                    <MentionBadge key={pk} pubkey={pk} onRemove={() => {
                      setMentionedPubkeys(prev => { const next = new Set(prev); next.delete(pk); return next; });
                    }} />
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />Attach media
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,audio/*"
                      className="text-xs"
                      onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
                    />
                    {selectedFile && (
                      <Button variant="ghost" size="sm" className="shrink-0 h-9 px-2"
                        onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                        ×
                      </Button>
                    )}
                  </div>
                  {selectedFile && (
                    <div className="flex items-center gap-1.5 p-1.5 bg-muted rounded text-xs text-muted-foreground">
                      <ImageIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedFile.name} · {(selectedFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Tag className="h-3 w-3" />Hashtags (comma-separated)
                  </Label>
                  <Input
                    placeholder="bitcoin, nostr, freedom"
                    value={tags}
                    onChange={e => setTags(e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Ctrl+Enter to send</span>
                <Button
                  onClick={handlePublish}
                  disabled={isPublishing || isUploading || (!content.trim() && !selectedFile)}
                  size="sm"
                  className="gap-2"
                >
                  {(isPublishing || isUploading)
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />}
                  {isUploading ? 'Uploading…' : isPublishing ? 'Publishing…' : 'Publish'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Feed mode tabs ────────────────────────────────────────────── */}
        <div className="space-y-3">
          <Tabs value={feedMode} onValueChange={v => setFeedMode(v as FeedMode)}>
            <TabsList className="w-full grid grid-cols-3 h-10">
              <TabsTrigger value="global" className="gap-1.5 text-xs sm:text-sm">
                <Globe className="h-3.5 w-3.5" />
                Global
              </TabsTrigger>
              <TabsTrigger value="following" className="gap-1.5 text-xs sm:text-sm" disabled={!user}>
                <Users className="h-3.5 w-3.5" />
                Following
                {feedMode === 'following' && followedPubkeys.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0 h-4">
                    {followedPubkeys.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="search" className="gap-1.5 text-xs sm:text-sm">
                <Search className="h-3.5 w-3.5" />
                Search
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* ── Search bar (only shown when search tab active) ─────────── */}
          {feedMode === 'search' && (
            <div className="flex gap-2 animate-fade-in">
              <Input
                placeholder="Search hashtag or keyword (e.g. bitcoin)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchSubmit()}
                className="flex-1"
              />
              <Button onClick={handleSearchSubmit} size="sm" className="gap-1.5 shrink-0">
                <Search className="h-3.5 w-3.5" />
                Search
              </Button>
            </div>
          )}

          {/* ── Following tab: extra info strip ───────────────────────── */}
          {feedMode === 'following' && (
            <div className="animate-fade-in">
              {!user ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    Log in to see notes from people you follow
                  </CardContent>
                </Card>
              ) : followLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading your follow list…
                </div>
              ) : followedPubkeys.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center space-y-1">
                    <p className="text-sm font-medium">You're not following anyone yet</p>
                    <p className="text-xs text-muted-foreground">
                      Follow people on Nostr and their notes will appear here
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <p className="text-xs text-muted-foreground px-1">
                  Showing notes from <span className="font-medium text-foreground">{followedPubkeys.length}</span> accounts you follow
                </p>
              )}
            </div>
          )}

          {/* ── Search tab: active query label ─────────────────────────── */}
          {feedMode === 'search' && activeSearch && (
            <div className="flex items-center gap-2 animate-fade-in">
              <Badge variant="outline" className="gap-1">
                <Search className="h-3 w-3" />#{activeSearch}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => { setActiveSearch(''); setSearchQuery(''); }}
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        {/* ── Feed events ───────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Don't render the feed if following tab has no pubkeys yet */}
          {feedMode === 'following' && (!user || (followedPubkeys.length === 0 && !followLoading)) ? null : (
            <>
              {isLoading ? (
                <FeedSkeleton />
              ) : allEvents.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center">
                    <p className="text-muted-foreground text-sm">
                      {feedMode === 'search' && !activeSearch
                        ? 'Enter a hashtag or keyword above and press Search'
                        : feedMode === 'search'
                        ? `No notes found for #${activeSearch}`
                        : 'No notes yet — check your relay connections or refresh'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                allEvents.map(event => (
                  <NoteCard key={event.id} event={event} />
                ))
              )}

              {/* ── Infinite scroll sentinel ── */}
              {/* Placed before the loading state so it renders as soon as events are shown */}
              <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

              {/* Loading more indicator */}
              {isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading more notes…</span>
                </div>
              )}

              {/* Paused notice */}
              {paused && hasNextPage && (
                <div className="text-center py-3">
                  <Badge variant="outline" className="gap-1.5 text-xs">
                    <PauseCircle className="h-3 w-3" />
                    Auto-load paused — click Resume to continue
                  </Badge>
                </div>
              )}

              {/* End of feed */}
              {!hasNextPage && allEvents.length > 0 && (
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    You've reached the end · {allEvents.length} notes loaded
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                    Back to top
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <SupportButton />
      </div>
    </AppLayout>
  );
}
