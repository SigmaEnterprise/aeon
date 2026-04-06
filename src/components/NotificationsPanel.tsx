/**
 * NotificationsPanel — Centralized notification center
 *
 * Subscribes to all events tagging the logged-in user's pubkey and sorts
 * them into tabs: All / Reposts (K6) / Comments (K1) / Likes (K7) / Zaps (K9735)
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import {
  Bell, MessageSquare, Repeat2, Heart, Zap, BellOff, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';

// ─── Notification item ────────────────────────────────────────────────────

function NotificationItem({ event }: { event: NostrEvent }) {
  const navigate = useNavigate();
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });

  const getIcon = () => {
    switch (event.kind) {
      case 1: return <MessageSquare className="h-4 w-4 text-blue-500" />;
      case 6: return <Repeat2 className="h-4 w-4 text-green-500" />;
      case 7: return <Heart className="h-4 w-4 text-red-500" />;
      case 9735: return <Zap className="h-4 w-4 text-yellow-500" />;
      default: return <Bell className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getLabel = () => {
    switch (event.kind) {
      case 1: return 'replied to you';
      case 6: return 'reposted your note';
      case 7: {
        const reaction = event.content;
        if (reaction === '+' || reaction === '') return 'liked your note';
        if (reaction === '-') return 'disliked your note';
        return `reacted ${reaction} to your note`;
      }
      case 9735: {
        // Extract amount from zap receipt
        try {
          const descTag = event.tags.find(t => t[0] === 'description')?.[1];
          if (descTag) {
            const zapReq = JSON.parse(descTag) as NostrEvent;
            const amountTag = zapReq.tags?.find((t: string[]) => t[0] === 'amount')?.[1];
            if (amountTag) {
              const sats = Math.floor(parseInt(amountTag) / 1000);
              return `zapped you ${sats.toLocaleString()} sats`;
            }
          }
        } catch { /* ignore */ }
        return 'zapped your note';
      }
      default: return 'mentioned you';
    }
  };

  const getSnippet = () => {
    if (event.kind === 1) {
      return event.content.slice(0, 120) + (event.content.length > 120 ? '…' : '');
    }
    return null;
  };

  return (
    <div
      className="flex gap-3 p-3 rounded-lg hover:bg-accent transition-colors cursor-pointer group"
      onClick={() => {
        try {
          const noteId = nip19.noteEncode(event.id);
          window.open(`https://njump.me/${noteId}`, '_blank', 'noopener,noreferrer');
        } catch { /* ignore */ }
      }}
    >
      {/* Kind icon */}
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted shrink-0 mt-1">
        {getIcon()}
      </div>

      {/* Avatar */}
      <Avatar
        className="h-8 w-8 shrink-0 mt-0.5 cursor-pointer"
        onClick={e => { e.stopPropagation(); navigate(`/${npub}`); }}
      >
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="text-[10px] font-bold">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-semibold truncate cursor-pointer hover:underline"
            onClick={e => { e.stopPropagation(); navigate(`/${npub}`); }}
          >
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground">{getLabel()}</span>
          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{timeAgo}</span>
        </div>
        {getSnippet() && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
            {getSnippet()}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Notifications hook ───────────────────────────────────────────────────

function useNotifications(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<NostrEvent[]>({
    queryKey: ['notifications', pubkey ?? ''],
    queryFn: async () => {
      if (!pubkey) return [];
      const events = await nostr.query(
        [{ kinds: [1, 6, 7, 9735], '#p': [pubkey], limit: 100 }],
        { signal: AbortSignal.timeout(15000) }
      );
      // Deduplicate and sort newest first
      const seen = new Set<string>();
      return events
        .filter(e => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .sort((a, b) => b.created_at - a.created_at);
    },
    enabled: !!pubkey,
    staleTime: 60000,
    refetchInterval: 2 * 60 * 1000, // refresh every 2 minutes
  });
}

// ─── Main NotificationsPanel ──────────────────────────────────────────────

export function NotificationsPanel() {
  const { user } = useCurrentUser();
  const { data: notifications = [], isLoading, refetch, isFetching } = useNotifications(user?.pubkey);
  const [open, setOpen] = useState(false);

  const all = notifications;
  const reposts = notifications.filter(e => e.kind === 6);
  const comments = notifications.filter(e => e.kind === 1);
  const likes = notifications.filter(e => e.kind === 7);
  const zaps = notifications.filter(e => e.kind === 9735);

  const unread = notifications.length;

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Notifications">
          <Bell className="h-4.5 w-4.5" />
          {unread > 0 && !isLoading && (
            <span className={cn(
              'absolute -top-0.5 -right-0.5 flex items-center justify-center',
              'min-w-[18px] h-[18px] rounded-full px-1',
              'bg-red-500 text-white text-[10px] font-bold',
              'animate-in zoom-in-50 duration-200'
            )}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:w-[420px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" />
              Notifications
              {unread > 0 && (
                <Badge variant="secondary" className="text-xs">{unread}</Badge>
              )}
            </SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="all" className="flex flex-col h-full">
            <TabsList className="grid grid-cols-5 mx-4 mt-3 shrink-0 h-8">
              <TabsTrigger value="all" className="text-[10px]">
                All {all.length > 0 && <span className="ml-0.5 text-[9px]">({all.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="reposts" className="text-[10px]">
                <Repeat2 className="h-3 w-3" />
                {reposts.length > 0 && <span className="ml-0.5 text-[9px]">{reposts.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="comments" className="text-[10px]">
                <MessageSquare className="h-3 w-3" />
                {comments.length > 0 && <span className="ml-0.5 text-[9px]">{comments.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="likes" className="text-[10px]">
                <Heart className="h-3 w-3" />
                {likes.length > 0 && <span className="ml-0.5 text-[9px]">{likes.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="zaps" className="text-[10px]">
                <Zap className="h-3 w-3" />
                {zaps.length > 0 && <span className="ml-0.5 text-[9px]">{zaps.length}</span>}
              </TabsTrigger>
            </TabsList>

            {(['all', 'reposts', 'comments', 'likes', 'zaps'] as const).map(tab => {
              const items = tab === 'all' ? all
                : tab === 'reposts' ? reposts
                : tab === 'comments' ? comments
                : tab === 'likes' ? likes
                : zaps;

              return (
                <TabsContent key={tab} value={tab} className="flex-1 mt-0 px-4 py-2 space-y-1">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex gap-3 p-3">
                        <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1">
                          <Skeleton className="h-3 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))
                  ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                      <BellOff className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {tab === 'all' ? 'No notifications yet' : `No ${tab} yet`}
                      </p>
                    </div>
                  ) : (
                    items.map(event => (
                      <NotificationItem key={event.id} event={event} />
                    ))
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
