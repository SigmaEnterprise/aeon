import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useNavigate } from 'react-router-dom';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { EditProfileForm } from '@/components/EditProfileForm';
import { LoginArea } from '@/components/auth/LoginArea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useFeed } from '@/hooks/useFeed';
import { useFollowList } from '@/hooks/useFollowList';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { genUserName } from '@/lib/genUserName';
import { avatarImage, isAnimatedGif } from '@/lib/imgproxy';
import {
  Pencil, Globe, Zap, BadgeCheck, ExternalLink, Users, UserCheck,
  Copy, ArrowRight, Wifi, WifiOff, Loader2, ArrowUp, AtSign,
  Link as LinkIcon,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { SupportButton } from '@/components/SupportButton';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the avatar src URL — raw for GIFs, optimised otherwise. */
function resolveAvatar(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined;
  if (isAnimatedGif(url)) return url;
  return avatarImage(url, size);
}

/** Returns the banner src URL — always raw so GIFs animate. */
function resolveBanner(url: string | undefined): string | undefined {
  return url ?? undefined;
}

// ─── MiniProfileCard ──────────────────────────────────────────────────────────

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

function RelayRow({ url, read, write }: { url: string; read: boolean; write: boolean }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const { toast } = useToast();

  const check = () => {
    setStatus('checking');
    try {
      const ws = new WebSocket(url);
      const t = setTimeout(() => { ws.close(); setStatus('offline'); }, 5000);
      ws.onopen  = () => { clearTimeout(t); ws.close(); setStatus('online'); };
      ws.onerror = () => { clearTimeout(t); setStatus('offline'); };
    } catch { setStatus('offline'); }
  };

  const browserUrl = url.replace(/^wss?:\/\//, 'https://');

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-card text-sm">
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs truncate">{url}</p>
        <div className="flex gap-1 mt-0.5">
          {read  && <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4">read</Badge>}
          {write && <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4">write</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {status === 'online'   && <Wifi    className="h-3.5 w-3.5 text-green-500" />}
        {status === 'offline'  && <WifiOff className="h-3.5 w-3.5 text-destructive" />}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={check}
          disabled={status === 'checking'}>
          {status === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ping'}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" asChild>
          <a href={browserUrl} target="_blank" rel="noopener noreferrer" title="Open relay website">
            <Globe className="h-3 w-3" />
          </a>
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={() => { navigator.clipboard.writeText(url); toast({ title: 'Relay URL copied!' }); }}
          title="Copy relay URL">
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── CopyRow ─────────────────────────────────────────────────────────────────

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { toast } = useToast();
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className={`text-xs break-all bg-muted rounded p-2 flex-1 leading-relaxed ${mono ? 'font-mono' : ''}`}>
          {value}
        </p>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
          onClick={() => { navigator.clipboard.writeText(value); toast({ title: 'Copied!' }); }}>
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── ProfilePage ──────────────────────────────────────────────────────────────

export function ProfilePage() {
  useSeoMeta({ title: 'Profile — Aeon', description: 'Your Nostr profile' });

  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { toast } = useToast();
  const author = useAuthor(user?.pubkey);
  const [isEditing, setIsEditing] = useState(false);

  // NIP-02 follows
  const { data: followedPubkeys = [], isLoading: followLoading } = useFollowList();

  // Own posts (kinds 1 + 6 reposts)
  const { data: postsData, isLoading: feedLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed({
    authors: user?.pubkey ? [user.pubkey] : undefined,
    kinds: [1],
    limit: 20,
  });
  const allPosts: NostrEvent[] = (postsData?.pages ?? []).flatMap(p => p.events);

  const { sentinelRef: postsSentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    rootMargin: 400,
  });

  // Followers: kind:3 events containing our pubkey in p-tags
  const { data: followerPubkeys = [], isLoading: followersLoading } = useQuery<string[]>({
    queryKey: ['followers', user?.pubkey ?? ''],
    queryFn: async () => {
      if (!user?.pubkey) return [];
      const events = await nostr.query(
        [{ kinds: [3], '#p': [user.pubkey], limit: 500 }],
        { signal: AbortSignal.timeout(10000) }
      );
      const seen = new Set<string>();
      return events
        .filter(e => { if (seen.has(e.pubkey)) return false; seen.add(e.pubkey); return true; })
        .map(e => e.pubkey);
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  // NIP-65 relay list
  const { data: userRelays = [] } = useQuery<{ url: string; read: boolean; write: boolean }[]>({
    queryKey: ['user-relays', user?.pubkey ?? ''],
    queryFn: async () => {
      if (!user?.pubkey) return [];
      const events = await nostr.query(
        [{ kinds: [10002], authors: [user.pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(6000) }
      );
      if (!events.length) return [];
      return events[0].tags
        .filter(t => t[0] === 'r' && t[1]?.startsWith('wss://'))
        .map(t => ({
          url: t[1],
          read:  !t[2] || t[2] === 'read',
          write: !t[2] || t[2] === 'write',
        }));
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || (user?.pubkey ? genUserName(user.pubkey) : 'Unknown');
  const npub = user?.pubkey ? nip19.npubEncode(user.pubkey) : null;

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <p className="text-xl font-semibold">Welcome to Aeon</p>
              <p className="text-muted-foreground">Log in to view your profile</p>
              <div className="flex justify-center"><LoginArea className="max-w-xs" /></div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Edit Profile</h1>
            <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
          </div>
          <EditProfileForm />
          {/* Back to profile after saving */}
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} className="gap-2">
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />Back to Profile
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Profile view ───────────────────────────────────────────────────────────
  const bannerSrc = resolveBanner(metadata?.banner);
  const avatarSrc = resolveAvatar(metadata?.picture, 160);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">

        {/* ── Profile header card ─────────────────────────────────────────── */}
        <Card className="overflow-hidden">

          {/* Banner */}
          <div className="relative h-40 bg-gradient-to-br from-primary/20 via-primary/30 to-violet-500/20">
            {bannerSrc && (
              <img
                src={bannerSrc}
                alt="Profile banner"
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
              />
            )}
            {/* Edit button overlay */}
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-3 right-3 gap-1.5 text-xs shadow h-8 opacity-90 hover:opacity-100"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />Edit Profile
            </Button>
          </div>

          <CardContent className="relative pt-0 pb-5">
            {/* Avatar — overlaps banner */}
            <div className="-mt-12 mb-3 flex items-end justify-between">
              <Avatar className="h-24 w-24 ring-4 ring-background shadow-xl">
                {avatarSrc ? (
                  /* Use a plain <img> inside AvatarImage so GIFs animate */
                  <AvatarImage
                    src={avatarSrc}
                    alt={displayName}
                    style={{ imageRendering: isAnimatedGif(metadata?.picture ?? '') ? 'auto' : undefined }}
                  />
                ) : null}
                <AvatarFallback className="text-3xl font-bold bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Profile info */}
            {author.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <>
                {/* Names */}
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold">{displayName}</h1>
                    {metadata?.display_name && metadata.name && metadata.display_name !== metadata.name && (
                      <span className="text-muted-foreground text-sm">@{metadata.name}</span>
                    )}
                  </div>
                  {npub && (
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-mono text-muted-foreground">{npub.slice(0, 20)}…{npub.slice(-6)}</p>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                        onClick={() => { navigator.clipboard.writeText(npub); toast({ title: 'npub copied!' }); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Follow stats */}
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

                {/* Bio */}
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
                  {npub && (
                    <a
                      href={`https://njump.me/${npub}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />njump
                    </a>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="posts">
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="posts"     className="text-xs">Notes</TabsTrigger>
            <TabsTrigger value="following" className="text-xs">Following</TabsTrigger>
            <TabsTrigger value="followers" className="text-xs">Followers</TabsTrigger>
            <TabsTrigger value="relays"    className="text-xs">Relays</TabsTrigger>
            <TabsTrigger value="info"      className="text-xs">Info</TabsTrigger>
          </TabsList>

          {/* ── Notes ── */}
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
                  <p className="text-muted-foreground text-sm">No notes yet.</p>
                </CardContent>
              </Card>
            ) : (
              allPosts.map(event => <NoteCard key={event.id} event={event} />)
            )}

            <div ref={postsSentinelRef} className="h-1 w-full" aria-hidden="true" />

            {isFetchingNextPage && (
              <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Loading more notes…</span>
              </div>
            )}

            {!hasNextPage && allPosts.length > 0 && (
              <div className="text-center py-4 space-y-1">
                <p className="text-xs text-muted-foreground">{allPosts.length} notes loaded</p>
                <Button
                  variant="ghost" size="sm"
                  className="gap-1.5 text-xs text-muted-foreground"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                  <ArrowUp className="h-3 w-3" />Back to top
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── Following ── */}
          <TabsContent value="following" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserCheck className="h-4 w-4" />Following
                  <Badge variant="secondary" className="ml-1">{followedPubkeys.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[480px] overflow-y-auto pr-2">
                {followLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))
                ) : followedPubkeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Not following anyone yet</p>
                ) : (
                  followedPubkeys.map(pk => <MiniProfileCard key={pk} pubkey={pk} />)
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Followers ── */}
          <TabsContent value="followers" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />Followers
                  <Badge variant="secondary" className="ml-1">{followerPubkeys.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[480px] overflow-y-auto pr-2">
                {followersLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))
                ) : followerPubkeys.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No followers found on connected relays
                  </p>
                ) : (
                  followerPubkeys.map(pk => <MiniProfileCard key={pk} pubkey={pk} />)
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Relays ── */}
          <TabsContent value="relays" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="h-4 w-4" />Your Relay List
                  <Badge variant="secondary" className="ml-1">{userRelays.length}</Badge>
                  <span className="text-xs text-muted-foreground font-normal">NIP-65</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {userRelays.length === 0 ? (
                  <div className="text-center py-8 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      No relay list published yet.
                    </p>
                    <Button variant="outline" size="sm" asChild>
                      <a href="/relays">Configure Relays</a>
                    </Button>
                  </div>
                ) : (
                  userRelays.map(r => (
                    <RelayRow key={r.url} url={r.url} read={r.read} write={r.write} />
                  ))
                )}
                {userRelays.length > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Ping checks WebSocket connectivity. Click <Globe className="h-3 w-3 inline" /> to browse relay as website.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Info ── */}
          <TabsContent value="info" className="mt-4">
            <Card>
              <CardContent className="p-5 space-y-4">
                {npub && <CopyRow label="npub" value={npub} />}
                {user?.pubkey && <CopyRow label="Hex Public Key" value={user.pubkey} />}

                {metadata?.nip05 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">NIP-05 Identifier</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs gap-1.5">
                        <BadgeCheck className="h-3 w-3 text-green-500" />{metadata.nip05}
                      </Badge>
                    </div>
                  </div>
                )}

                {metadata?.lud16 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Lightning Address (lud16)</p>
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

                {metadata?.lud06 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">LNURL (lud06)</p>
                    <p className="text-xs font-mono bg-muted rounded p-2 break-all">{metadata.lud06.slice(0, 60)}…</p>
                  </div>
                )}

                {metadata?.website && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Website</p>
                    <a
                      href={metadata.website.startsWith('http') ? metadata.website : `https://${metadata.website}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <LinkIcon className="h-3 w-3" />{metadata.website}
                      <ExternalLink className="h-3 w-3 ml-0.5" />
                    </a>
                  </div>
                )}

                {metadata?.display_name && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Display Name</p>
                    <p className="text-sm">{metadata.display_name}</p>
                  </div>
                )}

                {npub && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">View On</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'njump.me', url: `https://njump.me/${npub}` },
                        { label: 'primal.net', url: `https://primal.net/p/${npub}` },
                        { label: 'nostrudel', url: `https://nostrudel.ninja/#/u/${npub}` },
                      ].map(({ label, url }) => (
                        <Button key={label} variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3" />{label}
                          </a>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <SupportButton />
      </div>
    </AppLayout>
  );
}
