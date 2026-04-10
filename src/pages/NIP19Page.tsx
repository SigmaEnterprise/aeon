import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { useParams, useNavigate } from 'react-router-dom';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthor } from '@/hooks/useAuthor';
import { useFollowList } from '@/hooks/useFollowList';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { avatarImage, isAnimatedGif } from '@/lib/imgproxy';
import {
  Globe, Zap, BadgeCheck, ExternalLink, ArrowLeft, Copy,
  Users, UserCheck, Wifi, WifiOff, ArrowRight, MessageCircle,
  UserPlus, UserMinus, Loader2, Lock,
} from 'lucide-react';
import NotFound from './NotFound';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useFeed } from '@/hooks/useFeed';

// ─── helpers ─────────────────────────────────────────────────────────────────

function resolveAvatar(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined;
  if (isAnimatedGif(url)) return url;
  return avatarImage(url, size);
}

// ─── MiniProfileCard ─────────────────────────────────────────────────────────

function MiniProfileCard({ pubkey }: { pubkey: string }) {
  const navigate = useNavigate();
  const author = useAuthor(pubkey);
  const meta = author.data?.metadata;
  const npub = nip19.npubEncode(pubkey);
  const name = meta?.name ?? genUserName(pubkey);
  const { toast } = useToast();

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors group">
      <Avatar className="h-9 w-9 shrink-0 cursor-pointer" onClick={() => navigate(`/${npub}`)}>
        <AvatarImage src={resolveAvatar(meta?.picture, 72)} />
        <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/${npub}`)}>
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-[10px] font-mono text-muted-foreground truncate">{npub.slice(0, 20)}…</p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={() => { navigator.clipboard.writeText(npub); toast({ title: 'npub copied!' }); }}>
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigate(`/${npub}`)}>
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── RelayRow ────────────────────────────────────────────────────────────────

function RelayRowPublic({ url, read, write }: { url: string; read: boolean; write: boolean }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');

  const check = () => {
    setStatus('checking');
    try {
      const ws = new WebSocket(url);
      const t = setTimeout(() => { ws.close(); setStatus('offline'); }, 5000);
      ws.onopen  = () => { clearTimeout(t); ws.close(); setStatus('online'); };
      ws.onerror = () => { clearTimeout(t); setStatus('offline'); };
    } catch { setStatus('offline'); }
  };

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-card text-sm">
      <div className="flex-1 min-w-0">
        <button
          className="font-mono text-xs truncate text-primary hover:underline text-left"
          onClick={() => navigate(`/relay-explorer?relay=${encodeURIComponent(url)}`)}
          title="Explore this relay"
        >
          {url}
        </button>
        <div className="flex gap-1 mt-0.5">
          {read  && <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4">read</Badge>}
          {write && <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4">write</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {status === 'online'  && <Wifi    className="h-3.5 w-3.5 text-green-500" />}
        {status === 'offline' && <WifiOff className="h-3.5 w-3.5 text-destructive" />}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={check}
          disabled={status === 'checking'}>
          {status === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ping'}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" asChild>
          <a href={url.replace(/^wss?:\/\//, 'https://')} target="_blank" rel="noopener noreferrer">
            <Globe className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}

// ─── FollowButton ─────────────────────────────────────────────────────────────

function FollowButton({ targetPubkey }: { targetPubkey: string }) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { data: followedPubkeys = [], isLoading } = useFollowList();
  const [isPending, setIsPending] = useState(false);

  if (!user || user.pubkey === targetPubkey) return null;

  const isFollowing = followedPubkeys.includes(targetPubkey);

  const handleToggle = async () => {
    setIsPending(true);
    try {
      // Fetch the current kind:3 event to preserve existing follows
      const existing = await nostr.query(
        [{ kinds: [3], authors: [user.pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(8000) }
      );

      const currentTags: string[][] = existing[0]?.tags?.filter(
        (t: string[]) => t[0] === 'p'
      ) ?? [];

      let newTags: string[][];
      if (isFollowing) {
        // Unfollow: remove the target pubkey
        newTags = currentTags.filter((t: string[]) => t[1] !== targetPubkey);
      } else {
        // Follow: add the target pubkey (preserve relay hints if any)
        newTags = [...currentTags, ['p', targetPubkey]];
      }

      await publishEvent({
        kind: 3,
        content: existing[0]?.content ?? '',
        tags: newTags,
      });

      queryClient.invalidateQueries({ queryKey: ['follow-list', user.pubkey] });
      toast({ title: isFollowing ? 'Unfollowed' : 'Following!' });
    } catch (err) {
      toast({ title: 'Failed', description: (err as Error).message, variant: 'destructive' });
    }
    setIsPending(false);
  };

  return (
    <Button
      variant={isFollowing ? 'outline' : 'default'}
      size="sm"
      className="gap-1.5 h-9 min-w-[100px]"
      onClick={handleToggle}
      disabled={isPending || isLoading}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isFollowing ? (
        <><UserMinus className="h-3.5 w-3.5" />Unfollow</>
      ) : (
        <><UserPlus className="h-3.5 w-3.5" />Follow</>
      )}
    </Button>
  );
}

// ─── MessageButton ────────────────────────────────────────────────────────────

function MessageButton({ targetPubkey }: { targetPubkey: string }) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const author = useAuthor(targetPubkey);
  const displayName = author.data?.metadata?.name ?? genUserName(targetPubkey);

  // Don't show if viewing own profile
  if (user?.pubkey === targetPubkey) return null;

  const handleMessage = () => {
    if (!user) {
      // Navigate to shielded page — it will show the login prompt
      navigate('/shielded');
      return;
    }
    // Navigate to shielded DMs with this pubkey pre-loaded as the recipient
    navigate('/shielded', {
      state: { recipientPubkey: targetPubkey },
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5 h-9"
          onClick={handleMessage}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Message
          {!user && (
            <Lock className="h-3 w-3 text-muted-foreground ml-0.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {user
          ? `Send a private NIP-17 DM to ${displayName}`
          : 'Log in to send a private message'}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── PublicKeyView ────────────────────────────────────────────────────────────

function PublicKeyView({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const { nostr } = useNostr();
  const navigate = useNavigate();
  const { toast } = useToast();
  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const npub = nip19.npubEncode(pubkey);
  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);

  // NIP-02 follow list for this user
  const { data: followedPubkeys = [], isLoading: followLoading } = useQuery<string[]>({
    queryKey: ['follow-list', pubkey],
    queryFn: async () => {
      const events = await nostr.query(
        [{ kinds: [3], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(8000) }
      );
      if (!events.length) return [];
      return events[0].tags
        .filter((t: string[]) => t[0] === 'p' && t[1]?.length === 64)
        .map((t: string[]) => t[1]);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
  });

  // Follower count
  const { data: followerPubkeys = [], isLoading: followersLoading } = useQuery<string[]>({
    queryKey: ['followers', pubkey],
    queryFn: async () => {
      const events = await nostr.query(
        [{ kinds: [3], '#p': [pubkey], limit: 500 }],
        { signal: AbortSignal.timeout(10000) }
      );
      const seen = new Set<string>();
      return events
        .filter(e => { if (seen.has(e.pubkey)) return false; seen.add(e.pubkey); return true; })
        .map(e => e.pubkey);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
  });

  // NIP-65 relay list
  const { data: userRelays = [] } = useQuery<{ url: string; read: boolean; write: boolean }[]>({
    queryKey: ['user-relays', pubkey],
    queryFn: async () => {
      const events = await nostr.query(
        [{ kinds: [10002], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(6000) }
      );
      if (!events.length) return [];
      return events[0].tags
        .filter((t: string[]) => t[0] === 'r' && t[1]?.startsWith('wss://'))
        .map((t: string[]) => ({
          url: t[1],
          read:  !t[2] || t[2] === 'read',
          write: !t[2] || t[2] === 'write',
        }));
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
  });

  // Feed for this author
  const { data: postsData, isLoading: feedLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed({
    authors: [pubkey],
    kinds: [1],
    limit: 20,
  });
  const allPosts: NostrEvent[] = (postsData?.pages ?? []).flatMap(p => p.events);

  const bannerSrc = metadata?.banner ?? undefined;
  const avatarSrc = resolveAvatar(metadata?.picture, 160);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">

        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />Back
        </Button>

        {/* ── Profile header card ─────────────────────────────────────────── */}
        <Card className="overflow-hidden">

          {/* Banner */}
          <div className="h-36 bg-gradient-to-br from-primary/20 via-primary/30 to-violet-500/20">
            {bannerSrc && (
              <img
                src={bannerSrc}
                alt="banner"
                className="w-full h-full object-cover"
                loading="eager"
              />
            )}
          </div>

          <CardContent className="relative pt-0 pb-5">
            {/* Avatar row */}
            <div className="flex items-end justify-between -mt-12 mb-3 flex-wrap gap-3">
              <Avatar className="h-24 w-24 ring-4 ring-background shadow-xl shrink-0">
                {avatarSrc && (
                  <AvatarImage src={avatarSrc} alt={displayName} />
                )}
                <AvatarFallback className="text-3xl font-bold bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              {/* Action buttons — always visible even while loading */}
              <div className="flex items-center gap-2 flex-wrap pb-1">
                <MessageButton targetPubkey={pubkey} />
                <FollowButton targetPubkey={pubkey} />
              </div>
            </div>

            {author.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <>
                {/* Names */}
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold">{displayName}</h1>
                    {metadata?.display_name && metadata.name && metadata.display_name !== metadata.name && (
                      <span className="text-sm text-muted-foreground">@{metadata.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-mono text-muted-foreground">
                      {npub.slice(0, 12)}…{npub.slice(-8)}
                    </p>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(npub); toast({ title: 'npub copied!' }); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-5 mt-3">
                  <div>
                    <span className="text-base font-bold">{followLoading ? '…' : followedPubkeys.length}</span>
                    <span className="text-xs text-muted-foreground ml-1">Following</span>
                  </div>
                  <div>
                    <span className="text-base font-bold">{followersLoading ? '…' : followerPubkeys.length}</span>
                    <span className="text-xs text-muted-foreground ml-1">Followers</span>
                  </div>
                </div>

                {metadata?.about && (
                  <p className="mt-3 text-sm whitespace-pre-wrap leading-relaxed">{metadata.about}</p>
                )}

                {/* Meta links */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {metadata?.website && (
                    <a
                      href={metadata.website.startsWith('http') ? metadata.website : `https://${metadata.website}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate max-w-[180px]">{metadata.website.replace(/^https?:\/\//, '')}</span>
                    </a>
                  )}
                  {(metadata?.lud16 || metadata?.lud06) && (
                    <span className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
                      <Zap className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate max-w-[200px]">{metadata.lud16 ?? 'LNURL'}</span>
                    </span>
                  )}
                  {metadata?.nip05 && (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate max-w-[200px]">{metadata.nip05}</span>
                    </span>
                  )}
                  <a href={`https://njump.me/${npub}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />njump
                  </a>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="posts">
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="posts"     className="text-xs">Notes</TabsTrigger>
            <TabsTrigger value="following" className="text-xs">Following</TabsTrigger>
            <TabsTrigger value="followers" className="text-xs">Followers</TabsTrigger>
            <TabsTrigger value="relays"    className="text-xs">Relays</TabsTrigger>
            <TabsTrigger value="info"      className="text-xs">Info</TabsTrigger>
          </TabsList>

          {/* Notes */}
          <TabsContent value="posts" className="space-y-4 mt-4">
            {feedLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </CardContent>
                </Card>
              ))
            ) : allPosts.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground text-sm">No notes found on connected relays.</p>
                </CardContent>
              </Card>
            ) : (
              allPosts.map(event => <NoteCard key={event.id} event={event} />)
            )}
            {hasNextPage && (
              <Button variant="outline" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</> : 'Load more'}
              </Button>
            )}
          </TabsContent>

          {/* Following */}
          <TabsContent value="following" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserCheck className="h-4 w-4" />Following
                  <Badge variant="secondary" className="ml-1">{followedPubkeys.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[480px] overflow-y-auto">
                {followLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))
                ) : followedPubkeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Not following anyone</p>
                ) : (
                  followedPubkeys.map(pk => <MiniProfileCard key={pk} pubkey={pk} />)
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Followers */}
          <TabsContent value="followers" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />Followers
                  <Badge variant="secondary" className="ml-1">{followerPubkeys.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[480px] overflow-y-auto">
                {followersLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))
                ) : followerPubkeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No followers found on connected relays</p>
                ) : (
                  followerPubkeys.map(pk => <MiniProfileCard key={pk} pubkey={pk} />)
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Relays */}
          <TabsContent value="relays" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="h-4 w-4" />Relay List (NIP-65)
                  <Badge variant="secondary" className="ml-1">{userRelays.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {userRelays.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No NIP-65 relay list published</p>
                ) : (
                  userRelays.map(r => (
                    <RelayRowPublic key={r.url} url={r.url} read={r.read} write={r.write} />
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Info */}
          <TabsContent value="info" className="mt-4">
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">npub</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono break-all bg-muted rounded p-2 flex-1">{npub}</p>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(npub); toast({ title: 'Copied!' }); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Hex Public Key</p>
                  <p className="text-xs font-mono break-all bg-muted rounded p-2">{pubkey}</p>
                </div>
                {metadata?.nip05 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">NIP-05</p>
                    <Badge variant="secondary" className="text-xs gap-1.5">
                      <BadgeCheck className="h-3 w-3 text-green-500" />{metadata.nip05}
                    </Badge>
                  </div>
                )}
                {metadata?.lud16 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Lightning Address</p>
                    <div className="flex items-center gap-2">
                      <Badge className="text-xs gap-1.5 bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30">
                        <Zap className="h-3 w-3" />{metadata.lud16}
                      </Badge>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                        onClick={() => { navigator.clipboard.writeText(metadata.lud16!); toast({ title: 'Lightning address copied!' }); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">View On</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'njump.me',   url: `https://njump.me/${npub}` },
                      { label: 'primal.net', url: `https://primal.net/p/${npub}` },
                      { label: 'nostrudel',  url: `https://nostrudel.ninja/#/u/${npub}` },
                    ].map(({ label, url }) => (
                      <Button key={label} variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3" />{label}
                        </a>
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Message shortcut in info tab */}
                <div className="pt-2 border-t">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Actions</p>
                  <div className="flex gap-2 flex-wrap">
                    <MessageButton targetPubkey={pubkey} />
                    <FollowButton targetPubkey={pubkey} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// ─── NoteView ─────────────────────────────────────────────────────────────────

function NoteView({ eventId }: { eventId: string }) {
  const { nostr } = useNostr();
  const navigate = useNavigate();

  const { data: events, isLoading } = useQuery<NostrEvent[]>({
    queryKey: ['note', eventId],
    queryFn: async () => {
      return nostr.query([{ ids: [eventId], limit: 1 }], { signal: AbortSignal.timeout(8000) });
    },
    staleTime: 300000,
  });

  const event = events?.[0];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />Back
        </Button>

        {isLoading ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ) : event ? (
          <NoteCard event={event} />
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              Note not found
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

// ─── NIP19Page router ─────────────────────────────────────────────────────────

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) return <NotFound />;

  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return <NotFound />;
  }

  const { type } = decoded;

  switch (type) {
    case 'npub':
      return <PublicKeyView pubkey={decoded.data as string} />;

    case 'nprofile':
      return <PublicKeyView pubkey={(decoded.data as { pubkey: string }).pubkey} />;

    case 'note':
      return <NoteView eventId={decoded.data as string} />;

    case 'nevent':
      return <NoteView eventId={(decoded.data as { id: string }).id} />;

    case 'naddr': {
      const naddrData = decoded.data as { kind: number; pubkey: string; identifier: string };
      return (
        <AppLayout>
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardContent className="py-12 text-center space-y-4">
                <p className="font-medium">Addressable Event</p>
                <p className="text-sm text-muted-foreground font-mono break-all">{identifier}</p>
                <p className="text-xs text-muted-foreground">Kind {naddrData.kind}</p>
                <Button asChild>
                  <a href={`https://njump.me/${identifier}`} target="_blank" rel="noopener noreferrer" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    View on njump.me
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </AppLayout>
      );
    }

    default:
      return <NotFound />;
  }
}
