import { useState, useRef, useCallback } from 'react';
import { useSeoMeta } from '@unhead/react';
import { AppLayout } from '@/components/AppLayout';
import { NoteCard } from '@/components/NoteCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { useFeed } from '@/hooks/useFeed';
import { cn } from '@/lib/utils';
import { Loader2, RefreshCw, PauseCircle, PlayCircle, Send, Paperclip, Tag, Zap, Image } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

export function FeedPage() {
  useSeoMeta({
    title: 'Feed — Bitchat',
    description: 'Global Nostr feed',
  });

  const { user } = useCurrentUser();
  const { mutate: publishEvent, isPending: isPublishing } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [paused, setPaused] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isFetching,
  } = useFeed({ kinds: [1], limit: 20 });

  const allEvents: NostrEvent[] = (data?.pages ?? []).flatMap(p => p.events);

  // Infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage && !paused) {
        fetchNextPage();
      }
    });
    observerRef.current.observe(node);
  }, [hasNextPage, isFetchingNextPage, paused, fetchNextPage]);

  const handlePublish = async () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to publish.', variant: 'destructive' });
      return;
    }

    let finalContent = content.trim();
    const eventTags: string[][] = [];

    // Upload file if selected
    if (selectedFile) {
      try {
        const uploadedTags = await uploadFile(selectedFile);
        const urlTag = uploadedTags.find(t => t[0] === 'url');
        if (urlTag) {
          finalContent = finalContent ? finalContent + '\n\n' + urlTag[1] : urlTag[1];
          // Add imeta tag
          eventTags.push(uploadedTags as string[]);
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

    // Add hashtag tags
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    tagList.forEach(tag => eventTags.push(['t', tag]));

    publishEvent(
      {
        kind: 1,
        content: finalContent,
        tags: eventTags,
        created_at: Math.floor(Date.now() / 1000),
      },
      {
        onSuccess: () => {
          toast({ title: 'Note published!' });
          setContent('');
          setTags('');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          refetch();
        },
        onError: (err) => {
          toast({ title: 'Failed to publish', description: (err as Error).message, variant: 'destructive' });
        },
      }
    );
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Compose card */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Global Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={user ? "What's on your mind?" : "Log in to publish notes..."}
              value={content}
              onChange={e => setContent(e.target.value)}
              className="min-h-[100px] resize-none"
              disabled={!user}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Paperclip className="h-3 w-3" />
                  Attach media
                </Label>
                <div className="flex gap-2">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*"
                    className="text-xs"
                    disabled={!user}
                    onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  {selectedFile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      ×
                    </Button>
                  )}
                </div>
                {selectedFile && (
                  <p className="text-xs text-muted-foreground truncate">{selectedFile.name}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  Hashtags (comma-separated)
                </Label>
                <Input
                  placeholder="bitcoin, nostr, freedom"
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  className="text-sm"
                  disabled={!user}
                />
              </div>
            </div>

            {selectedFile && (
              <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                <Image className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={handlePublish}
                disabled={!user || isPublishing || isUploading || (!content.trim() && !selectedFile)}
                className="gap-2"
              >
                {(isPublishing || isUploading) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {isUploading ? 'Uploading…' : isPublishing ? 'Publishing…' : 'Publish'}
              </Button>

              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </Button>

              <Button
                variant="outline"
                onClick={() => setPaused(p => !p)}
                className="gap-2"
              >
                {paused ? (
                  <><PlayCircle className="h-4 w-4" />Resume</>
                ) : (
                  <><PauseCircle className="h-4 w-4" />Pause</>
                )}
              </Button>

              {paused && <Badge variant="secondary" className="text-xs">Feed paused</Badge>}
            </div>
          </CardContent>
        </Card>

        {/* Feed */}
        <div className="space-y-4">
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
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </CardContent>
              </Card>
            ))
          ) : allEvents.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <p className="text-muted-foreground">No notes yet. Make sure you have relays connected.</p>
              </CardContent>
            </Card>
          ) : (
            allEvents.map(event => (
              <NoteCard key={event.id} event={event} />
            ))
          )}

          {/* Infinite scroll sentinel */}
          <div ref={loadMoreRef} className="h-4" />

          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!hasNextPage && allEvents.length > 0 && (
            <p className="text-center text-sm text-muted-foreground py-4">You've reached the end</p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
