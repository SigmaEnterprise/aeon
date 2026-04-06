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
import { genUserName } from '@/lib/genUserName';
import {
  Pencil, Globe, Zap, BadgeCheck, ExternalLink, Users, UserCheck,
  Copy, ArrowRight, Wifi, WifiOff
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { SupportButton } from '@/components/SupportButton';

// ─── Mini profile card for follow lists ────────────────────────────────────
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
        <AvatarImage src={meta?.picture} /><AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
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

// ─── Relay browser row ──────────────────────────────────────────────────────
function RelayRow({ url, read, write }: { url: string; read: boolean; write: boolean }) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');

  const check = () => {
    setStatus('checking');
    try {
      const ws = new WebSocket(url);
      const t = setTimeout(() => { ws.close(); setStatus('offline'); }, 5000);
      ws.onopen = () => { clearTimeout(t); ws.close(); setStatus('online'); };
      ws.onerror = () => { clearTimeout(t); setStatus('offline'); };
    } catch { setStatus('offline'); }
  };

  // Convert wss:// relay URL to https:// for browsing
  const browserUrl = url.replace(/^wss?:\/\//, 'https://');

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border bg-card text-sm">
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs truncate">{url}</p>
        <div className="flex gap-1 mt-0.5">
          {read && <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4">read</Badge>}
          {write && <Badge variant="secondary" className="text-[9px] py-0 px-1 h-4">write</Badge>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {status === 'online' && <Wifi className="h-3.5 w-3.5 text-green-500" />}
        {status === 'offline' && <WifiOff className="h-3.5 w-3.5 text-destructive" />}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={check}
          disabled={status === 'checking'}>
          {status === 'checking' ? '…' : 'Ping'}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" asChild>
          <a href={browserUrl} target="_blank" rel="noopener noreferrer">
            <Globe className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}

// ─── Main profile page ──────────────────────────────────────────────────────
export function ProfilePage() {
  useSeoMeta({ title: 'Profile — Aeon', description: 'Your Nostr profile' });

  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { toast } = useToast();
  const author = useAuthor(user?.pubkey);
  const [isEditing, setIsEditing] = useState(false);

  // NIP-02 follows
  const { data: followedPubkeys = [], isLoading: followLoading } = useFollowList();

  // Own posts
  const { data: postsData, isLoading: feedLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed({
    authors: user?.pubkey ? [user.pubkey] : undefined,
    kinds: [1],
    limit: 20,
  });
  const allPosts: NostrEvent[] = (postsData?.pages ?? []).flatMap(p => p.events);

  // Followers: kind:3 events that contain our pubkey in p tags
  const { data: followerPubkeys = [], isLoading: followersLoading } = useQuery<string[]>({
    queryKey: ['followers', user?.pubkey ?? ''],
    queryFn: async () => {
      if (!user?.pubkey) return [];
      const events = await nostr.query(
        [{ kinds: [3], '#p': [user.pubkey], limit: 500 }],
        { signal: AbortSignal.timeout(10000) }
      );
      // Deduplicate by pubkey
      const seen = new Set<string>();
      return events.filter(e => { if (seen.has(e.pubkey)) return false; seen.add(e.pubkey); return true; })
        .map(e => e.pubkey);
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  // User's NIP-65 relay list (kind:10002)
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
          read: !t[2] || t[2] === 'read',
          write: !t[2] || t[2] === 'write',
        }));
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? (user?.pubkey ? genUserName(user.pubkey) : 'Unknown');
  const npub = user?.pubkey ? nip19.npubEncode(user.pubkey) : null;

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

  if (isEditing) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Edit Profile</h1>
            <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
          </div>
          <EditProfileForm />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Profile header */}
        <Card className="overflow-hidden">
          <div className="relative h-36 bg-gradient-to-r from-primary/20 to-primary/40">
            {metadata?.banner && (
              <img src={metadata.banner} alt="banner" className="w-full h-full object-cover" />
            )}
          </div>
          <CardContent className="relative pt-0 pb-4">
            <div className="flex items-end justify-between -mt-10 mb-4">
              <Avatar className="h-20 w-20 ring-4 ring-background shadow-lg">
                <AvatarImage src={metadata?.picture} alt={displayName} />
                <AvatarFallback className="text-2xl font-bold">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />Edit Profile
              </Button>
            </div>

            {author.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-32" /><Skeleton className="h-16 w-full" /></div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold">{displayName}</h1>
                    {metadata?.display_name && metadata.display_name !== metadata.name && (
                      <span className="text-muted-foreground text-sm">@{metadata.display_name}</span>
                    )}
                  </div>
                  {npub && (
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-mono text-muted-foreground">{npub.slice(0, 20)}…{npub.slice(-8)}</p>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                        onClick={() => { navigator.clipboard.writeText(npub); toast({ title: 'npub copied!' }); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Follow stats */}
                <div className="flex gap-4 mt-3">
                  <div className="text-center">
                    <p className="text-lg font-bold">{followLoading ? '…' : followedPubkeys.length}</p>
                    <p className="text-xs text-muted-foreground">Following</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold">{followersLoading ? '…' : followerPubkeys.length}</p>
                    <p className="text-xs text-muted-foreground">Followers</p>
                  </div>
                </div>

                {metadata?.about && <p className="mt-3 text-sm whitespace-pre-wrap">{metadata.about}</p>}

                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {metadata?.website && (
                    <a href={metadata.website} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline">
                      <Globe className="h-3.5 w-3.5" />{metadata.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {metadata?.lud16 && (
                    <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                      <Zap className="h-3.5 w-3.5" />{metadata.lud16}
                    </span>
                  )}
                  {metadata?.nip05 && (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <BadgeCheck className="h-3.5 w-3.5" />{metadata.nip05}
                    </span>
                  )}
                  {npub && (
                    <a href={`https://njump.me/${npub}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />njump
                    </a>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tabs: Notes / Following / Followers / Relays / Info */}
        <Tabs defaultValue="posts">
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="posts" className="text-xs">Notes</TabsTrigger>
            <TabsTrigger value="following" className="text-xs">Following</TabsTrigger>
            <TabsTrigger value="followers" className="text-xs">Followers</TabsTrigger>
            <TabsTrigger value="relays" className="text-xs">Relays</TabsTrigger>
            <TabsTrigger value="info" className="text-xs">Info</TabsTrigger>
          </TabsList>

          {/* Notes */}
          <TabsContent value="posts" className="space-y-4 mt-4">
            {feedLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></CardContent></Card>
              ))
            ) : allPosts.length === 0 ? (
              <Card className="border-dashed"><CardContent className="py-12 text-center"><p className="text-muted-foreground text-sm">No notes yet.</p></CardContent></Card>
            ) : (
              allPosts.map(event => <NoteCard key={event.id} event={event} />)
            )}
            {hasNextPage && (
              <Button variant="outline" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
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
              <CardContent className="space-y-1 max-h-96 overflow-y-auto">
                {followLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-4 flex-1" />
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

          {/* Followers */}
          <TabsContent value="followers" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />Followers
                  <Badge variant="secondary" className="ml-1">{followerPubkeys.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-96 overflow-y-auto">
                {followersLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-4 flex-1" />
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
                  <Globe className="h-4 w-4" />Your Relay List (NIP-65)
                  <Badge variant="secondary" className="ml-1">{userRelays.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {userRelays.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No relay list published yet. Go to Relays to configure.</p>
                ) : (
                  userRelays.map(r => <RelayRow key={r.url} url={r.url} read={r.read} write={r.write} />)
                )}
                <p className="text-xs text-muted-foreground pt-2">
                  Click <Globe className="h-3 w-3 inline" /> to browse a relay as a website. Click Ping to check connectivity.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Info */}
          <TabsContent value="info" className="mt-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">npub</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono break-all bg-muted rounded p-2 flex-1">{npub}</p>
                    <Button variant="ghost" size="sm" className="h-7 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(npub!); toast({ title: 'Copied!' }); }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">hex pubkey</p>
                  <p className="text-xs font-mono break-all bg-muted rounded p-2">{user?.pubkey}</p>
                </div>
                {metadata?.nip05 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">NIP-05</p>
                    <Badge variant="secondary" className="text-xs">{metadata.nip05}</Badge>
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
