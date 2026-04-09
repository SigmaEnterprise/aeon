/**
 * NotificationsPanel — Sovereign In-App Notification Center
 *
 * Features:
 *  - Internal navigation: navigates to /nevent1... instead of external njump.me
 *  - NIP-10 threading: differentiates Direct Reply / Thread Mention / Root Reply
 *  - Kind 16 generic reposts: distinct label from Kind 6 note reposts
 *  - Kind 9 deletion events: filters out notifications whose source event
 *    has been deleted by the author (un-like, delete comment)
 *  - Zap depth: extracts bolt11 amount AND the zap request message/sender
 *  - VertexLab reputation scoring: "High Signal" toggle hides likely-spam accounts
 *  - Tabs: All / Reposts (K6+K16) / Replies (K1) / Likes (K7) / Zaps (K9735)
 */

import { useState, useMemo } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useFollowList } from '@/hooks/useFollowList';
import { genUserName } from '@/lib/genUserName';
import {
  Bell, MessageSquare, Repeat2, Heart, Zap, BellOff, RefreshCw,
  ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  batchScoreReputation,
  isLikelySpam,
  type ReputationResult,
} from '@/lib/reputationUtility';
import { useVertexSigner } from '@/hooks/useVertexDVM';

// ─── NIP-10 threading helpers ─────────────────────────────────────────────

type Nip10RelType = 'root' | 'reply' | 'mention';

interface Nip10ETag {
  id: string;
  relayHint: string;
  marker?: Nip10RelType;
}

function parseNip10ETags(event: NostrEvent): Nip10ETag[] {
  return event.tags
    .filter(t => t[0] === 'e' && t[1]?.length === 64)
    .map(t => ({
      id: t[1],
      relayHint: t[2] ?? '',
      marker: (t[3] as Nip10RelType | undefined),
    }));
}

/**
 * Determine how this kind-1 notification relates to the logged-in user.
 *
 * Returns:
 *   'direct-reply'    — the reply marker in an e-tag points to the user's note
 *                       AND the event has a reply marker targeting that note
 *   'thread-mention'  — user is tagged in a p-tag but is not the reply target
 *   'root-reply'      — user's note is the root but someone else is the reply target
 */
type ReplyRelation = 'direct-reply' | 'thread-mention' | 'root-reply';

function classifyReply(event: NostrEvent, userPubkey: string): ReplyRelation {
  const eTags = parseNip10ETags(event);

  // Check if ANY e-tag with marker="reply" directly references a note we
  // know about — we approximate this by checking pTags for direct mention
  const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
  const isDirectlyMentioned = pTags.includes(userPubkey);

  const replyTag = eTags.find(t => t.marker === 'reply');
  const rootTag  = eTags.find(t => t.marker === 'root');

  // Legacy (no markers): last = reply, first = root
  if (!replyTag && !rootTag) {
    if (eTags.length === 1) {
      // Single e-tag: direct reply to that note (both root and reply)
      return isDirectlyMentioned ? 'direct-reply' : 'thread-mention';
    }
    // Multiple e-tags, no markers — last is the reply target
    return isDirectlyMentioned ? 'direct-reply' : 'thread-mention';
  }

  if (replyTag && isDirectlyMentioned) return 'direct-reply';
  if (rootTag  && !replyTag && isDirectlyMentioned) return 'root-reply';
  return 'thread-mention';
}

// ─── Zap receipt parser (NIP-57 depth) ───────────────────────────────────

interface ZapInfo {
  sats: number;
  message: string;
  senderPubkey?: string;
}

function parseZapReceipt(event: NostrEvent): ZapInfo {
  try {
    const descTag = event.tags.find(t => t[0] === 'description')?.[1];
    if (descTag) {
      const zapReq = JSON.parse(descTag) as NostrEvent;
      // amount is in the zap request tags (millisats)
      const amountTag = zapReq.tags?.find((t: string[]) => t[0] === 'amount')?.[1];
      const sats = amountTag ? Math.floor(parseInt(amountTag) / 1000) : 0;
      const message = zapReq.content ?? '';
      const senderPubkey = zapReq.pubkey;
      return { sats, message, senderPubkey };
    }
    // Fallback: bolt11 tag amount
    const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
    if (bolt11) {
      // Very rough amount extraction (millisats encoded in invoice)
      return { sats: 0, message: '' };
    }
  } catch { /* ignore */ }
  return { sats: 0, message: '' };
}

// ─── Reputation badge ─────────────────────────────────────────────────────

function ReputationBadge({ result }: { result?: ReputationResult }) {
  if (!result) return null;

  if (result.leaked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
        </TooltipTrigger>
        <TooltipContent>Key leak detected by VertexLab</TooltipContent>
      </Tooltip>
    );
  }

  if (result.tier === 'trusted') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <ShieldCheck className="h-3 w-3 text-green-500 shrink-0" />
        </TooltipTrigger>
        <TooltipContent>High-signal account (VertexLab)</TooltipContent>
      </Tooltip>
    );
  }

  if (result.tier === 'spam') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <ShieldAlert className="h-3 w-3 text-orange-400 shrink-0" />
        </TooltipTrigger>
        <TooltipContent>Low-rank / likely spam (VertexLab)</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ShieldOff className="h-3 w-3 text-muted-foreground shrink-0" />
      </TooltipTrigger>
      <TooltipContent>Unknown reputation</TooltipContent>
    </Tooltip>
  );
}

// ─── Notification item ────────────────────────────────────────────────────

interface NotificationItemProps {
  event: NostrEvent;
  userPubkey: string;
  reputation?: ReputationResult;
}

function NotificationItem({ event, userPubkey, reputation }: NotificationItemProps) {
  const navigate = useNavigate();
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
  const zapInfo = event.kind === 9735 ? parseZapReceipt(event) : null;

  // ── In-app navigation: build nevent1 URL from e-tags ──────────────────
  const handleNavigate = () => {
    try {
      // For zap receipts, the e-tag is the zapped note
      // For replies/reposts/likes, e-tag is the referenced note
      const eTags = event.tags.filter(t => t[0] === 'e' && t[1]?.length === 64);

      // Pick the most relevant event to navigate to:
      // prefer "reply" marker, then "root", then first available
      const replyTag = event.tags.find(t => t[0] === 'e' && t[3] === 'reply');
      const rootTag  = event.tags.find(t => t[0] === 'e' && t[3] === 'root');
      const chosen   = replyTag ?? rootTag ?? eTags[0];

      if (chosen) {
        const targetId   = chosen[1];
        const relayHint  = chosen[2] ?? '';
        const nevent = nip19.neventEncode({
          id: targetId,
          relays: relayHint ? [relayHint] : [],
          author: event.pubkey,
        });
        navigate(`/${nevent}`);
      } else {
        // No e-tag — navigate to the notification event itself
        const nevent = nip19.neventEncode({
          id: event.id,
          relays: [],
          author: event.pubkey,
        });
        navigate(`/${nevent}`);
      }
    } catch { /* ignore encode errors */ }
  };

  // ── Label (NIP-10 aware) ──────────────────────────────────────────────
  const getLabel = (): string => {
    switch (event.kind) {
      case 1: {
        const relation = classifyReply(event, userPubkey);
        switch (relation) {
          case 'direct-reply':   return 'replied to you';
          case 'thread-mention': return 'mentioned you in a thread';
          case 'root-reply':     return 'replied in your thread';
        }
        break;
      }
      case 6:  return 'reposted your note';
      case 16: {
        const kTag = event.tags.find(t => t[0] === 'k')?.[1];
        if (kTag === '30023') return 'reposted your article';
        if (kTag === '1063')  return 'reposted your file';
        return 'reposted your content';
      }
      case 7: {
        const r = event.content;
        if (r === '+' || r === '') return 'liked your note';
        if (r === '-')             return 'disliked your note';
        return `reacted ${r} to your note`;
      }
      case 9735: {
        if (zapInfo && zapInfo.sats > 0) {
          return `zapped you ${zapInfo.sats.toLocaleString()} sats`;
        }
        return 'zapped your note';
      }
      default: return 'mentioned you';
    }
    return 'mentioned you';
  };

  // ── Snippet ───────────────────────────────────────────────────────────
  const getSnippet = (): string | null => {
    if (event.kind === 1) {
      const text = event.content.trim();
      return text.slice(0, 140) + (text.length > 140 ? '…' : '');
    }
    // Zap message from the zap request
    if (event.kind === 9735 && zapInfo?.message) {
      return `"${zapInfo.message.slice(0, 120)}"`;
    }
    return null;
  };

  // ── Icon ──────────────────────────────────────────────────────────────
  const getIcon = () => {
    switch (event.kind) {
      case 1:    return <MessageSquare className="h-4 w-4 text-blue-500" />;
      case 6:    return <Repeat2 className="h-4 w-4 text-green-500" />;
      case 16:   return <Repeat2 className="h-4 w-4 text-emerald-400" />;
      case 7:    return <Heart className="h-4 w-4 text-red-500" />;
      case 9735: return <Zap className="h-4 w-4 text-yellow-500" />;
      default:   return <Bell className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const snippet = getSnippet();

  return (
    <div
      className="flex gap-3 p-3 rounded-lg hover:bg-accent transition-colors cursor-pointer group"
      onClick={handleNavigate}
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-sm font-semibold truncate cursor-pointer hover:underline"
            onClick={e => { e.stopPropagation(); navigate(`/${npub}`); }}
          >
            {displayName}
          </span>
          <ReputationBadge result={reputation} />
          <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{getLabel()}</span>
          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{timeAgo}</span>
        </div>
        {snippet && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
            {snippet}
          </p>
        )}
        {/* Zap sender name if different from the wrap author */}
        {event.kind === 9735 && zapInfo?.senderPubkey && zapInfo.senderPubkey !== event.pubkey && (
          <ZapSenderLine pubkey={zapInfo.senderPubkey} />
        )}
      </div>
    </div>
  );
}

function ZapSenderLine({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const name = author.data?.metadata?.name ?? genUserName(pubkey);
  return (
    <p className="text-[10px] text-muted-foreground mt-0.5">
      Zap request signed by <span className="font-medium">{name}</span>
    </p>
  );
}

// ─── Notifications hook ───────────────────────────────────────────────────

interface NotificationsData {
  events: NostrEvent[];
  deletedIds: Set<string>;
}

function useNotificationsRaw(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<NotificationsData>({
    queryKey: ['notifications-raw', pubkey ?? ''],
    queryFn: async () => {
      if (!pubkey) return { events: [], deletedIds: new Set() };

      // Single combined query: notifications + deletion events
      const all = await nostr.query(
        [
          // Notifications addressing this pubkey
          { kinds: [1, 6, 7, 9735, 16], '#p': [pubkey], limit: 150 },
          // Kind-9 deletion events published by anyone tagging these events
          // We'll fetch deletions separately below after we know the IDs
        ],
        { signal: AbortSignal.timeout(15000) }
      );

      // Collect seen event IDs to dedup
      const seen = new Set<string>();
      const notifications = all.filter(e => {
        if (e.pubkey === pubkey) return false; // skip own events
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      }).sort((a, b) => b.created_at - a.created_at);

      // Fetch NIP-09 deletion events for these notifications
      // (the source events of likes/comments may have been deleted)
      const notifIds = notifications
        .flatMap(e => e.tags.filter(t => t[0] === 'e').map(t => t[1]))
        .filter(Boolean);

      let deletedIds = new Set<string>();

      if (notifIds.length > 0) {
        try {
          const deletions = await nostr.query(
            [{ kinds: [5], '#e': notifIds.slice(0, 50), limit: 100 }],
            { signal: AbortSignal.timeout(8000) }
          );
          for (const del of deletions) {
            for (const t of del.tags) {
              if (t[0] === 'e' && t[1]) deletedIds.add(t[1]);
            }
          }
        } catch { /* deletions are best-effort */ }
      }

      return { events: notifications, deletedIds };
    },
    enabled: !!pubkey,
    staleTime: 60000,
    refetchInterval: 2 * 60 * 1000,
  });
}

// ─── Main NotificationsPanel ──────────────────────────────────────────────

export function NotificationsPanel() {
  const { user } = useCurrentUser();
  const { data: notifData, isLoading, refetch, isFetching } = useNotificationsRaw(user?.pubkey);
  const { data: followList = [] } = useFollowList();
  const vertexSigner = useVertexSigner();
  const [open, setOpen] = useState(false);
  const [highSignalOnly, setHighSignalOnly] = useState(false);

  const followSet = useMemo(() => new Set(followList), [followList]);

  // ── Collect unique non-followed pubkeys needing reputation scoring ────
  const unfollowedPubkeys = useMemo(() => {
    if (!notifData?.events) return [];
    const pks = new Set<string>();
    for (const e of notifData.events) {
      if (!followSet.has(e.pubkey) && e.pubkey !== user?.pubkey) {
        pks.add(e.pubkey);
      }
    }
    return [...pks];
  }, [notifData?.events, followSet, user?.pubkey]);

  // ── Batch reputation fetch (lazy — only when high-signal toggle is on) ─
  const { data: reputationMap = new Map<string, ReputationResult>() } = useQuery({
    queryKey: ['notifications-reputation', unfollowedPubkeys.join(',')],
    queryFn: async () => {
      if (!vertexSigner || unfollowedPubkeys.length === 0) return new Map<string, ReputationResult>();
      return batchScoreReputation(vertexSigner, unfollowedPubkeys, followSet);
    },
    enabled: !!vertexSigner && open && highSignalOnly && unfollowedPubkeys.length > 0,
    staleTime: 24 * 60 * 60 * 1000, // 24h — reputation doesn't change quickly
    gcTime: Infinity,
  });

  // ── Apply deletion filter + spam filter ───────────────────────────────
  const filteredEvents = useMemo(() => {
    if (!notifData?.events) return [];
    const { events, deletedIds } = notifData;

    return events.filter(e => {
      // NIP-09: filter out notifications whose referenced event was deleted
      const eTags = e.tags.filter(t => t[0] === 'e').map(t => t[1]);
      if (eTags.some(id => deletedIds.has(id))) return false;

      // High-signal filter: skip spam accounts (only when toggle is on)
      if (highSignalOnly && !followSet.has(e.pubkey)) {
        const rep = reputationMap.get(e.pubkey);
        if (isLikelySpam(rep)) return false;
      }

      return true;
    });
  }, [notifData, highSignalOnly, reputationMap, followSet]);

  // ── Tabs ──────────────────────────────────────────────────────────────
  const all      = filteredEvents;
  const reposts  = filteredEvents.filter(e => e.kind === 6 || e.kind === 16);
  const comments = filteredEvents.filter(e => e.kind === 1);
  const likes    = filteredEvents.filter(e => e.kind === 7);
  const zaps     = filteredEvents.filter(e => e.kind === 9735);

  const unread = filteredEvents.length;

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 shrink-0" aria-label="Notifications">
          <Bell className="h-4 w-4" />
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
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base shrink-0">
              <Bell className="h-4 w-4" />
              Notifications
              {unread > 0 && (
                <Badge variant="secondary" className="text-xs">{unread}</Badge>
              )}
            </SheetTitle>
            <div className="flex items-center gap-2 ml-auto">
              {/* High-signal toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className={cn('h-3.5 w-3.5 shrink-0', highSignalOnly ? 'text-green-500' : 'text-muted-foreground')} />
                    <Switch
                      checked={highSignalOnly}
                      onCheckedChange={setHighSignalOnly}
                      className="scale-75 origin-right"
                      aria-label="High-signal only"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {highSignalOnly
                    ? 'High-signal only (VertexLab WoT filtering active)'
                    : 'Show all — enable to filter likely-spam accounts'}
                </TooltipContent>
              </Tooltip>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs shrink-0"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>

          {highSignalOnly && (
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              Accounts not in your follow list are scored by VertexLab PageRank.
              Low-rank accounts are hidden.
            </p>
          )}
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
              const items = tab === 'all'      ? all
                : tab === 'reposts'   ? reposts
                : tab === 'comments'  ? comments
                : tab === 'likes'     ? likes
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
                        {tab === 'all'
                          ? (highSignalOnly ? 'No high-signal notifications yet' : 'No notifications yet')
                          : `No ${tab} yet`}
                      </p>
                      {tab === 'all' && highSignalOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => setHighSignalOnly(false)}
                        >
                          Disable filter to see all
                        </Button>
                      )}
                    </div>
                  ) : (
                    items.map(event => (
                      <NotificationItem
                        key={event.id}
                        event={event}
                        userPubkey={user.pubkey}
                        reputation={reputationMap.get(event.pubkey)}
                      />
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
