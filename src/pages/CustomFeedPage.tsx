import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';
import { useFeed } from '@/hooks/useFeed';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { Loader2, Star, Users, RefreshCw } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

function decodePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey;
  } catch {
    // ignore
  }
  return null;
}

export function CustomFeedPage() {
  useSeoMeta({
    title: 'Custom Feeds — Aeon',
    description: 'Follow specific Nostr users',
  });

  const { toast } = useToast();
  const [savedPubkeys, setSavedPubkeys] = useLocalStorage<string[]>('aeon:custom-feed-pubkeys', []);
  const [inputValue, setInputValue] = useState(savedPubkeys.join('\n'));
  const [activePubkeys, setActivePubkeys] = useState<string[]>(savedPubkeys);

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
    kinds: [1],
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

    if (invalid.length > 0) {
      toast({
        title: `Saved ${unique.length} pubkeys`,
        description: `${invalid.length} invalid entries were skipped.`,
        variant: 'destructive',
      });
    } else {
      toast({ title: `Saved ${unique.length} pubkeys successfully!` });
    }
  };

  const handleFetch = () => {
    if (activePubkeys.length === 0) {
      toast({ title: 'No pubkeys', description: 'Save at least one pubkey first.', variant: 'destructive' });
      return;
    }
    refetch();
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Custom Feeds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Enter one npub or hex pubkey per line to follow specific users.
              </p>
              <Textarea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={"npub1abc...\nnpub1xyz...\n64-char-hex-pubkey..."}
                className="min-h-[120px] font-mono text-xs resize-none"
              />
            </div>

            {savedPubkeys.length > 0 && (
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {savedPubkeys.length} pubkey{savedPubkeys.length !== 1 ? 's' : ''} saved
                </span>
                <Badge variant="secondary" className="text-xs">{savedPubkeys.length}</Badge>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleSave} className="gap-2">
                <Star className="h-4 w-4" />
                Save Follows
              </Button>
              <Button variant="outline" onClick={handleFetch} disabled={isFetching} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                Fetch Feed
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Feed results */}
        {activePubkeys.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Latest from your follows</h2>
              {allEvents.length > 0 && (
                <span className="text-sm text-muted-foreground">{allEvents.length} notes</span>
              )}
            </div>

            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
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
                    <Skeleton className="h-4 w-3/5" />
                  </CardContent>
                </Card>
              ))
            ) : allEvents.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground text-sm">
                    No notes found from these pubkeys. They may not have posted recently, or check your relay connections.
                  </p>
                </CardContent>
              </Card>
            ) : (
              allEvents.map(event => (
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
                {isFetchingNextPage ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading more…</>
                ) : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
