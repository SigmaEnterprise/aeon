import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { EditProfileForm } from '@/components/EditProfileForm';
import { LoginArea } from '@/components/auth/LoginArea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useFeed } from '@/hooks/useFeed';
import { genUserName } from '@/lib/genUserName';
import { Pencil, Globe, Zap, BadgeCheck, ExternalLink } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

export function ProfilePage() {
  useSeoMeta({
    title: 'Profile — Bitchat',
    description: 'Your Nostr profile',
  });

  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey);
  const [isEditing, setIsEditing] = useState(false);

  const {
    data,
    isLoading: feedLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFeed({
    authors: user?.pubkey ? [user.pubkey] : undefined,
    kinds: [1],
    limit: 20,
  });

  const allPosts: NostrEvent[] = (data?.pages ?? []).flatMap(p => p.events);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? (user?.pubkey ? genUserName(user.pubkey) : 'Unknown');
  const npub = user?.pubkey ? nip19.npubEncode(user.pubkey) : null;

  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <p className="text-xl font-semibold">Welcome to Bitchat</p>
              <p className="text-muted-foreground">Log in to view your profile and post notes</p>
              <div className="flex justify-center">
                <LoginArea className="max-w-xs" />
              </div>
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
        {/* Profile header card */}
        <Card className="overflow-hidden">
          {/* Banner */}
          <div className="relative h-36 bg-gradient-to-r from-primary/20 to-primary/40">
            {metadata?.banner && (
              <img
                src={metadata.banner}
                alt="banner"
                className="w-full h-full object-cover"
              />
            )}
          </div>

          <CardContent className="relative pt-0 pb-4">
            {/* Avatar */}
            <div className="flex items-end justify-between -mt-10 mb-4">
              <Avatar className="h-20 w-20 ring-4 ring-background shadow-lg">
                <AvatarImage src={metadata?.picture} alt={displayName} />
                <AvatarFallback className="text-2xl font-bold">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit Profile
              </Button>
            </div>

            {author.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold">{displayName}</h1>
                    {metadata?.display_name && metadata.display_name !== metadata.name && (
                      <span className="text-muted-foreground">@{metadata.display_name}</span>
                    )}
                  </div>
                  {npub && (
                    <p className="text-xs font-mono text-muted-foreground break-all">{npub}</p>
                  )}
                </div>

                {metadata?.about && (
                  <p className="mt-3 text-sm whitespace-pre-wrap">{metadata.about}</p>
                )}

                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  {metadata?.website && (
                    <a
                      href={metadata.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {metadata.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {metadata?.lud16 && (
                    <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                      <Zap className="h-3.5 w-3.5" />
                      {metadata.lud16}
                    </span>
                  )}
                  {metadata?.nip05 && (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <BadgeCheck className="h-3.5 w-3.5" />
                      {metadata.nip05}
                    </span>
                  )}
                  {npub && (
                    <a
                      href={`https://njump.me/${npub}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View on njump
                    </a>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Posts */}
        <Tabs defaultValue="posts">
          <TabsList className="w-full">
            <TabsTrigger value="posts" className="flex-1">Notes</TabsTrigger>
            <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
          </TabsList>

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
                  <p className="text-muted-foreground text-sm">No notes yet. Be the first to post!</p>
                </CardContent>
              </Card>
            ) : (
              allPosts.map(event => (
                <NoteCard key={event.id} event={event} />
              ))
            )}

            {hasNextPage && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                Load more
              </Button>
            )}
          </TabsContent>

          <TabsContent value="info" className="mt-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Public Key (npub)</p>
                  <p className="text-xs font-mono break-all bg-muted rounded p-2">{npub}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Public Key (hex)</p>
                  <p className="text-xs font-mono break-all bg-muted rounded p-2">{user?.pubkey}</p>
                </div>
                {metadata?.nip05 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">NIP-05 Identifier</p>
                    <Badge variant="secondary" className="text-xs">{metadata.nip05}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
