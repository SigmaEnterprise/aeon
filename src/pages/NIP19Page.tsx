import { nip19 } from 'nostr-tools';
import { useParams } from 'react-router-dom';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Globe, Zap, BadgeCheck, ExternalLink, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import NotFound from './NotFound';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';

function PublicKeyView({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const { nostr } = useNostr();
  const navigate = useNavigate();
  const metadata = author.data?.metadata;
  const npub = nip19.npubEncode(pubkey);
  const displayName = metadata?.name ?? genUserName(pubkey);

  const { data: events, isLoading } = useQuery<NostrEvent[]>({
    queryKey: ['profile-notes', pubkey],
    queryFn: async () => {
      return nostr.query([{ kinds: [1], authors: [pubkey], limit: 20 }], { signal: AbortSignal.timeout(8000) });
    },
    staleTime: 60000,
  });

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <Card className="overflow-hidden">
          <div className="h-28 bg-gradient-to-r from-primary/20 to-primary/40">
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
            </div>

            {author.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold">{displayName}</h1>
                <p className="text-xs font-mono text-muted-foreground break-all mt-0.5">{npub}</p>
                {metadata?.about && (
                  <p className="mt-3 text-sm whitespace-pre-wrap">{metadata.about}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {metadata?.website && (
                    <a href={metadata.website} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline">
                      <Globe className="h-3.5 w-3.5" />
                      {metadata.website.replace(/^https?:\/\//, '')}
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
                  <a href={`https://njump.me/${npub}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />njump
                  </a>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <h2 className="text-base font-semibold">Recent Notes</h2>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : events?.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-8 text-center text-muted-foreground text-sm">No notes found</CardContent></Card>
        ) : (
          events?.sort((a, b) => b.created_at - a.created_at).map(event => (
            <NoteCard key={event.id} event={event} />
          ))
        )}
      </div>
    </AppLayout>
  );
}

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
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {isLoading ? (
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div>
            </div>
            <Skeleton className="h-20 w-full" />
          </CardContent></Card>
        ) : event ? (
          <NoteCard event={event} />
        ) : (
          <Card className="border-dashed"><CardContent className="py-12 text-center text-muted-foreground">Note not found</CardContent></Card>
        )}
      </div>
    </AppLayout>
  );
}

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) {
    return <NotFound />;
  }

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

    case 'naddr':
      // Addressable event - redirect to njump for now
      return (
        <AppLayout>
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardContent className="py-12 text-center space-y-4">
                <p className="font-medium">Addressable Event</p>
                <p className="text-sm text-muted-foreground font-mono break-all">{identifier}</p>
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

    default:
      return <NotFound />;
  }
}
