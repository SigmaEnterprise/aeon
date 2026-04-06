import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { type NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useEventEngagement } from '@/hooks/useEventEngagement';
import { useComments } from '@/hooks/useComments';
import { usePostComment } from '@/hooks/usePostComment';
import { NoteContent } from '@/components/NoteContent';
import { ZapButton } from '@/components/ZapButton';
import type { Event as NostrToolsEvent } from 'nostr-tools';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';
import {
  Share2,
  Copy,
  MessageSquare,
  Repeat2,
  Heart,
  ExternalLink,
  Download,
  FileJson,
  ChevronDown,
  ChevronUp,
  Play,
  BookOpen,
  Music,
  Film,
  Image as ImageIcon,
  Zap,
  Check,
  Send,
  Loader2,
  CornerDownRight,
} from 'lucide-react';

interface NoteCardProps {
  event: NostrEvent;
  className?: string;
  depth?: number; // for nested replies
}

// ─── YouTube helpers ──────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const shortMatch = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
      if (shortMatch) return shortMatch[1];
    }
  } catch { /* ignore */ }
  return null;
}

// ─── URL extraction from content ─────────────────────────────────────────────

function extractMediaUrls(content: string) {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  const urls = content.match(urlRegex) ?? [];
  const seen = new Set<string>();
  const result = {
    images: [] as string[],
    videos: [] as string[],
    audio: [] as string[],
    youtube: [] as string[],
    other: [] as string[],
  };

  for (const url of urls) {
    const clean = url.replace(/[.,!?;:]+$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean);

    const ytId = extractYouTubeId(clean);
    if (ytId) { result.youtube.push(ytId); continue; }
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(clean)) { result.images.push(clean); continue; }
    if (/\.(mp4|webm|mov|ogv|m4v)(\?.*)?$/i.test(clean)) { result.videos.push(clean); continue; }
    if (/\.(mp3|ogg|wav|flac|aac|opus|m4a)(\?.*)?$/i.test(clean)) { result.audio.push(clean); continue; }
    if (/(blossom\.|cdn\.|media\.|nostr\.build|void\.cat|nostpic\.com|nostrimg\.com|image\.nostr\.build)/i.test(clean)) {
      result.images.push(clean); continue;
    }
  }

  return result;
}

// ─── Optimized image URL helper ────────────────────────────────────────────
// Uses media.nostr.build's resize proxy for large images to reduce bandwidth

function optimizeImageUrl(url: string, width = 800): string {
  // Skip already-optimized or data URLs
  if (url.startsWith('data:') || url.includes('wsrv.nl') || url.includes('imageproxy')) {
    return url;
  }
  // Use wsrv.nl as a free image CDN/proxy with resizing
  // This helps mobile clients by not downloading full-size images
  try {
    const encoded = encodeURIComponent(url);
    return `https://wsrv.nl/?url=${encoded}&w=${width}&output=webp&q=80`;
  } catch {
    return url;
  }
}

// ─── YouTube embed ────────────────────────────────────────────────────────────

function YouTubeEmbed({ videoId }: { videoId: string }) {
  const [loaded, setLoaded] = useState(false);
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <div className="relative w-full overflow-hidden rounded-xl border bg-black" style={{ aspectRatio: '16/9' }}>
      {!loaded ? (
        <button
          onClick={() => setLoaded(true)}
          className="group absolute inset-0 w-full h-full flex items-center justify-center"
          aria-label="Play video"
        >
          <img
            src={thumb}
            alt="YouTube thumbnail"
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
          <div className="relative z-10 flex items-center justify-center w-16 h-16 rounded-full bg-red-600 shadow-2xl group-hover:scale-110 transition-transform">
            <Play className="h-7 w-7 text-white fill-white ml-1" />
          </div>
        </button>
      ) : (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
          title="YouTube video"
        />
      )}
    </div>
  );
}

// ─── Image gallery ────────────────────────────────────────────────────────────

function ImageGallery({ urls }: { urls: string[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (urls.length === 0) return null;

  const single = urls.length === 1;

  return (
    <>
      <div className={cn(
        'overflow-hidden rounded-xl border',
        single ? 'block' : 'grid gap-1',
        urls.length === 2 && 'grid-cols-2',
        urls.length === 3 && 'grid-cols-2',
        urls.length >= 4 && 'grid-cols-2',
      )}>
        {urls.slice(0, 4).map((url, i) => (
          <div
            key={url}
            className={cn(
              'relative overflow-hidden bg-muted cursor-pointer group',
              single && 'rounded-xl',
              urls.length === 3 && i === 0 && 'col-span-2',
              urls.length >= 4 && 'aspect-square',
              single && 'aspect-auto max-h-[500px]',
              !single && 'aspect-square',
            )}
            onClick={() => setLightbox(url)}
          >
            <img
              src={optimizeImageUrl(url, single ? 1200 : 600)}
              alt=""
              className={cn(
                'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300',
                single && 'object-contain max-h-[500px]',
              )}
              loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {urls.length > 4 && i === 3 && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-white text-2xl font-bold">+{urls.length - 4}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full w-10 h-10 flex items-center justify-center text-xl hover:bg-black/80 transition-colors"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

// ─── Video player ─────────────────────────────────────────────────────────────

function VideoPlayer({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="space-y-2">
      {urls.map((url, i) => (
        <div key={i} className="relative rounded-xl overflow-hidden border bg-black">
          <video
            src={url}
            controls
            preload="metadata"
            className="w-full max-h-[400px]"
          />
        </div>
      ))}
    </div>
  );
}

// ─── Audio player ─────────────────────────────────────────────────────────────

function AudioPlayer({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="space-y-2">
      {urls.map((url, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl border bg-muted/40"
        >
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 shrink-0">
            <Music className="h-5 w-5 text-primary" />
          </div>
          <audio
            src={url}
            controls
            preload="metadata"
            className="flex-1 min-w-0 h-10"
            style={{ colorScheme: 'normal' }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Rich media attachments ───────────────────────────────────────────────────

function MediaAttachments({ event }: { event: NostrEvent }) {
  const media = extractMediaUrls(event.content);

  const imetaUrls = event.tags
    .filter(t => t[0] === 'imeta')
    .map(t => {
      const urlPart = t.find((p, i) => i > 0 && p.startsWith('url '));
      return urlPart ? urlPart.replace('url ', '') : null;
    })
    .filter((u): u is string => !!u);

  for (const url of imetaUrls) {
    if (!media.images.includes(url) && !media.videos.includes(url)) {
      media.images.push(url);
    }
  }

  const hasAny = media.youtube.length > 0 || media.images.length > 0
    || media.videos.length > 0 || media.audio.length > 0;

  if (!hasAny) return null;

  return (
    <div className="mt-3 space-y-3">
      {media.youtube.map(id => <YouTubeEmbed key={id} videoId={id} />)}
      {media.videos.length > 0 && <VideoPlayer urls={media.videos} />}
      {media.images.length > 0 && <ImageGallery urls={media.images} />}
      {media.audio.length > 0 && <AudioPlayer urls={media.audio} />}
    </div>
  );
}

// ─── npub copy badge ──────────────────────────────────────────────────────────

function NpubBadge({ pubkey }: { pubkey: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const npub = nip19.npubEncode(pubkey);
  const short = `${npub.slice(0, 8)}…${npub.slice(-4)}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(npub);
    setCopied(true);
    toast({ title: 'npub copied!' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors bg-muted/50 hover:bg-muted px-1.5 py-0.5 rounded cursor-pointer"
        >
          {copied ? <Check className="h-2.5 w-2.5 text-green-500" /> : <Copy className="h-2.5 w-2.5" />}
          {short}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-xs max-w-xs break-all">
        {npub}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Inline comment item (recursive) ─────────────────────────────────────────

interface InlineCommentItemProps {
  root: NostrEvent;
  comment: NostrEvent;
  depth?: number;
  allComments: NostrEvent[];
}

function InlineCommentItem({ root, comment, depth = 0, allComments }: InlineCommentItemProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { mutate: postComment, isPending } = usePostComment();
  const { toast } = useToast();
  const author = useAuthor(comment.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(comment.pubkey);
  const npub = nip19.npubEncode(comment.pubkey);
  const timeAgo = formatDistanceToNow(new Date(comment.created_at * 1000), { addSuffix: true });
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [showReplies, setShowReplies] = useState(depth < 1);
  const [replyText, setReplyText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Direct replies to this comment
  const directReplies = allComments.filter(c => {
    const eTag = c.tags.find(([name]) => name === 'e')?.[1];
    return eTag === comment.id;
  }).sort((a, b) => a.created_at - b.created_at);

  const hasReplies = directReplies.length > 0;

  const handleToggleReply = () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to reply.', variant: 'destructive' });
      return;
    }
    setShowReplyForm(v => !v);
    if (!showReplies) setShowReplies(true);
  };

  useEffect(() => {
    if (showReplyForm) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [showReplyForm]);

  const handleSubmitReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !user) return;
    postComment(
      { content: replyText.trim(), root, reply: comment },
      {
        onSuccess: () => {
          toast({ title: 'Reply posted!' });
          setReplyText('');
          setShowReplyForm(false);
          setShowReplies(true);
        },
        onError: () => toast({ title: 'Failed to post reply', variant: 'destructive' }),
      }
    );
  };

  return (
    <div className={cn('group', depth > 0 && 'ml-5 border-l-2 border-border/40 pl-3 mt-2')}>
      {/* Comment bubble */}
      <div className="flex gap-2.5">
        <Avatar
          className="h-7 w-7 shrink-0 cursor-pointer mt-0.5 hover:opacity-80 transition-opacity"
          onClick={() => navigate(`/${npub}`)}
        >
          <AvatarImage src={metadata?.picture} alt={displayName} />
          <AvatarFallback className="text-[10px] font-bold bg-primary/10 text-primary">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Author + time */}
          <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
            <span
              className="text-xs font-semibold cursor-pointer hover:underline"
              onClick={() => navigate(`/${npub}`)}
            >
              {displayName}
            </span>
            <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
          </div>

          {/* Content */}
          <div className="text-sm leading-relaxed text-foreground/90">
            <NoteContent event={comment} className="text-sm" />
          </div>

          {/* Action row */}
          <div className="flex items-center gap-1 mt-1.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1',
                showReplyForm && 'text-primary'
              )}
              onClick={handleToggleReply}
            >
              <CornerDownRight className="h-3 w-3" />
              {showReplyForm ? 'Cancel' : 'Reply'}
            </Button>

            {hasReplies && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                onClick={() => setShowReplies(v => !v)}
              >
                <MessageSquare className="h-3 w-3" />
                {directReplies.length} {directReplies.length === 1 ? 'reply' : 'replies'}
                {showReplies ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Inline reply form */}
      {showReplyForm && (
        <div className={cn('mt-2', depth > 0 ? 'ml-9' : 'ml-9')}>
          <form onSubmit={handleSubmitReply} className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder={`Reply to ${displayName}…`}
              className="min-h-[64px] text-sm resize-none flex-1"
              disabled={isPending}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmitReply(e); }}
            />
            <Button
              type="submit"
              size="sm"
              disabled={!replyText.trim() || isPending}
              className="mb-0.5 shrink-0"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-0.5 ml-0.5">Ctrl+Enter to send</p>
        </div>
      )}

      {/* Nested replies */}
      {hasReplies && showReplies && (
        <div className="mt-2 space-y-2">
          {directReplies.map(reply => (
            <InlineCommentItem
              key={reply.id}
              root={root}
              comment={reply}
              depth={depth + 1}
              allComments={allComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inline comments panel ────────────────────────────────────────────────────

interface InlineCommentsPanelProps {
  event: NostrEvent;
  isOpen: boolean;
}

function InlineCommentsPanel({ event, isOpen }: InlineCommentsPanelProps) {
  const { user } = useCurrentUser();
  const { mutate: postComment, isPending } = usePostComment();
  const { toast } = useToast();
  const { data, isLoading } = useComments(event, 300);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const topLevel = data?.topLevelComments ?? [];
  const allComments = data?.allComments ?? [];

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !user) return;
    postComment(
      { content: text.trim(), root: event },
      {
        onSuccess: () => {
          toast({ title: 'Comment posted!' });
          setText('');
        },
        onError: () => toast({ title: 'Failed to post comment', variant: 'destructive' }),
      }
    );
  };

  return (
    <div className="border-t bg-muted/20 px-4 py-4 space-y-4 animate-fade-in">
      {/* Header */}
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />
        Comments {!isLoading && `(${topLevel.length})`}
      </p>

      {/* Compose box */}
      {user ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write a comment…"
            className="min-h-[80px] text-sm resize-none bg-background"
            disabled={isPending}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit(e); }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Ctrl+Enter to send</span>
            <Button type="submit" size="sm" disabled={!text.trim() || isPending} className="gap-1.5">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {isPending ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="text-center py-3 rounded-lg border border-dashed bg-background/50">
          <p className="text-sm text-muted-foreground">
            <Link to="/" className="text-primary underline underline-offset-2">Log in</Link> to leave a comment
          </p>
        </div>
      )}

      {/* Comments list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="h-7 w-7 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : topLevel.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">
          No comments yet — be the first!
        </p>
      ) : (
        <div className="space-y-4">
          {topLevel.map(comment => (
            <InlineCommentItem
              key={comment.id}
              root={event}
              comment={comment}
              depth={0}
              allComments={allComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Engagement bar ───────────────────────────────────────────────────────────

function EngagementBar({
  eventId,
  event,
  onRepost,
  onLike,
  showComments,
  onToggleComments,
}: {
  eventId: string;
  event: NostrEvent;
  onRepost: () => void;
  onLike: () => void;
  showComments: boolean;
  onToggleComments: () => void;
}) {
  const { data: engagement } = useEventEngagement(eventId);
  const { data: commentsData } = useComments(event, 500);
  const commentCount = commentsData?.topLevelComments?.length ?? 0;

  return (
    <div className="flex items-center gap-0.5 w-full">
      {/* Comments — shows count, click toggles inline panel */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-2 text-muted-foreground hover:text-foreground gap-1.5 transition-colors',
              showComments && 'text-primary bg-primary/10 hover:text-primary'
            )}
            onClick={onToggleComments}
          >
            <MessageSquare className="h-4 w-4" />
            {commentCount > 0 && (
              <span className="text-xs tabular-nums font-medium">{commentCount}</span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {showComments ? 'Hide comments' : commentCount > 0 ? `${commentCount} comments` : 'Add comment'}
        </TooltipContent>
      </Tooltip>

      {/* Repost */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-green-500 gap-1.5" onClick={onRepost}>
            <Repeat2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Repost</TooltipContent>
      </Tooltip>

      {/* Like — shows count */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-red-500 gap-1.5" onClick={onLike}>
            <Heart className="h-4 w-4" />
            {engagement && engagement.reactionCount > 0 && (
              <span className="text-xs tabular-nums">{engagement.reactionCount}</span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{engagement?.reactionCount ?? 0} likes</TooltipContent>
      </Tooltip>

      {/* Zap — shows count and sats */}
      <div className="flex items-center">
        <ZapButton target={event as unknown as NostrToolsEvent} />
        {engagement && engagement.zapCount > 0 && (
          <span className="text-xs tabular-nums text-yellow-600 dark:text-yellow-400 -ml-1 flex items-center gap-0.5">
            <Zap className="h-3 w-3" />
            {engagement.zapTotal > 0 ? `${engagement.zapTotal.toLocaleString()}` : engagement.zapCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Kind 30023 Article card ──────────────────────────────────────────────────

function ArticleCard({ event, className }: NoteCardProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const author = useAuthor(event.pubkey);
  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const { data: commentsData } = useComments(event, 500);
  const [showComments, setShowComments] = useState(false);
  const commentCount = commentsData?.topLevelComments?.length ?? 0;

  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });

  const title = event.tags.find(t => t[0] === 'title')?.[1] ?? 'Untitled Article';
  const summary = event.tags.find(t => t[0] === 'summary')?.[1] ?? event.content.slice(0, 200);
  const image = event.tags.find(t => t[0] === 'image')?.[1];
  const hashtags = event.tags.filter(t => t[0] === 't').map(t => t[1]).slice(0, 5);
  const naddr = nip19.naddrEncode({
    kind: 30023,
    pubkey: event.pubkey,
    identifier: event.tags.find(t => t[0] === 'd')?.[1] ?? '',
  });

  const handleLike = () => {
    if (!user) { toast({ title: 'Login required', variant: 'destructive' }); return; }
    publishEvent({ kind: 7, content: '+', tags: [['e', event.id], ['p', event.pubkey]], created_at: Math.floor(Date.now() / 1000) }, {
      onSuccess: () => toast({ title: 'Liked!' }),
      onError: () => toast({ title: 'Failed to like', variant: 'destructive' }),
    });
  };

  return (
    <Card className={cn('animate-fade-in hover:shadow-lg transition-all duration-200 overflow-hidden', className)}>
      {image && (
        <div className="relative w-full overflow-hidden" style={{ maxHeight: '240px' }}>
          <img
            src={optimizeImageUrl(image, 800)}
            alt={title}
            className="w-full h-full object-cover"
            style={{ maxHeight: '240px' }}
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          <Badge className="absolute top-3 left-3 bg-primary/90 text-primary-foreground gap-1.5">
            <BookOpen className="h-3 w-3" />
            Article
          </Badge>
        </div>
      )}

      <CardHeader className={cn('pb-2', !image && 'pt-4')}>
        {!image && (
          <div className="flex items-center gap-1 mb-2">
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <BookOpen className="h-3 w-3" />
              Article
            </Badge>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Avatar
            className="h-9 w-9 ring-2 ring-border shrink-0 cursor-pointer"
            onClick={() => navigate(`/${npub}`)}
          >
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-xs font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-semibold text-sm truncate cursor-pointer hover:underline"
                onClick={() => navigate(`/${npub}`)}
              >
                {displayName}
              </span>
              <NpubBadge pubkey={event.pubkey} />
            </div>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>
        </div>

        <h2 className="text-lg font-bold leading-snug mt-2 hover:text-primary transition-colors">
          {title}
        </h2>
      </CardHeader>

      <CardContent className="pb-2 px-4">
        {summary && (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
            {summary.replace(/#[^\s]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>`]/g, '').trim()}
          </p>
        )}
        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {hashtags.map(tag => (
              <Badge key={tag} variant="outline" className="text-xs px-2 py-0.5">#{tag}</Badge>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="px-4 pb-3 flex flex-col gap-0 p-0">
        <div className="flex items-center gap-1 w-full px-4 pb-3 pt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="sm"
                className={cn(
                  'h-8 px-2 text-muted-foreground hover:text-foreground gap-1.5 transition-colors',
                  showComments && 'text-primary bg-primary/10 hover:text-primary'
                )}
                onClick={() => setShowComments(v => !v)}
              >
                <MessageSquare className="h-4 w-4" />
                {commentCount > 0 && <span className="text-xs tabular-nums font-medium">{commentCount}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showComments ? 'Hide comments' : commentCount > 0 ? `${commentCount} comments` : 'Add comment'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-red-500 gap-1.5" onClick={handleLike}>
                <Heart className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Like</TooltipContent>
          </Tooltip>
          <ZapButton target={event as unknown as NostrToolsEvent} />
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
              <a href={`https://njump.me/${naddr}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />Read
              </a>
            </Button>
          </div>
        </div>
        <InlineCommentsPanel event={event} isOpen={showComments} />
      </CardFooter>
    </Card>
  );
}

// ─── Main NoteCard ────────────────────────────────────────────────────────────

export function NoteCard({ event, className, depth = 0 }: NoteCardProps) {
  if (event.kind === 30023) {
    return <ArticleCard event={event} className={className} />;
  }

  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const author = useAuthor(event.pubkey);
  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const [showActions, setShowActions] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const metadata = author.data?.metadata;
  const npub = nip19.npubEncode(event.pubkey);
  const displayName = metadata?.name ?? genUserName(event.pubkey);
  const noteId = nip19.noteEncode(event.id);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  const handleShare = () => {
    window.open(`https://njump.me/${noteId}`, '_blank', 'noopener,noreferrer');
  };

  const handleRepost = () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to repost.', variant: 'destructive' });
      return;
    }
    publishEvent(
      {
        kind: 6,
        content: JSON.stringify(event),
        tags: [['e', event.id, '', 'mention'], ['p', event.pubkey]],
        created_at: Math.floor(Date.now() / 1000),
      },
      {
        onSuccess: () => toast({ title: 'Reposted!' }),
        onError: () => toast({ title: 'Failed to repost', variant: 'destructive' }),
      }
    );
  };

  const handleLike = () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to like.', variant: 'destructive' });
      return;
    }
    publishEvent(
      {
        kind: 7,
        content: '+',
        tags: [['e', event.id], ['p', event.pubkey]],
        created_at: Math.floor(Date.now() / 1000),
      },
      {
        onSuccess: () => toast({ title: 'Liked!' }),
        onError: () => toast({ title: 'Failed to like', variant: 'destructive' }),
      }
    );
  };

  const handleExportJson = () => {
    const json = JSON.stringify(event, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `event-${event.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSaveMd = () => {
    const blob = new Blob([event.content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `note-${event.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const media = extractMediaUrls(event.content);
  const hasYoutube = media.youtube.length > 0;
  const hasVideo = media.videos.length > 0;
  const hasAudio = media.audio.length > 0;

  return (
    <Card className={cn('animate-fade-in hover:shadow-md transition-all duration-200 overflow-hidden', depth > 0 && 'border-l-2 border-l-primary/20', className)}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-3">
          <Avatar
            className="h-10 w-10 ring-2 ring-border cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => navigate(`/${npub}`)}
          >
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-xs font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-semibold text-sm truncate cursor-pointer hover:underline"
                onClick={() => navigate(`/${npub}`)}
              >
                {displayName}
              </span>
              {metadata?.display_name && metadata.display_name !== metadata.name && (
                <span className="text-xs text-muted-foreground truncate">@{metadata.display_name}</span>
              )}
              {/* Media type badges */}
              {hasYoutube && (
                <span title="Contains YouTube video" className="text-[10px] text-red-500 font-medium flex items-center gap-0.5">
                  <Film className="h-3 w-3" />YT
                </span>
              )}
              {hasVideo && !hasYoutube && (
                <Film className="h-3.5 w-3.5 text-blue-500" title="Contains video" />
              )}
              {hasAudio && (
                <Music className="h-3.5 w-3.5 text-purple-500" title="Contains audio" />
              )}
              {media.images.length > 1 && (
                <span title={`${media.images.length} images`} className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <ImageIcon className="h-3 w-3" />{media.images.length}
                </span>
              )}
            </div>
            {/* Identity row: timestamp + npub copy badge */}
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="text-xs text-muted-foreground" title={new Date(event.created_at * 1000).toLocaleString()}>
                {timeAgo}
              </span>
              <NpubBadge pubkey={event.pubkey} />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-2">
        <div className="text-sm leading-relaxed">
          <NoteContent event={event} />
        </div>
        <MediaAttachments event={event} />
      </CardContent>

      <CardFooter className="px-4 pb-0 pt-1 flex flex-col gap-0">
        {/* Engagement bar */}
        <div className="flex items-center w-full">
          <EngagementBar
            eventId={event.id}
            event={event}
            onRepost={handleRepost}
            onLike={handleLike}
            showComments={showComments}
            onToggleComments={() => setShowComments(v => !v)}
          />

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={handleShare}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open on njump.me</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                  onClick={() => setShowActions(!showActions)}
                >
                  {showActions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Extra actions */}
        {showActions && (
          <div className="flex flex-wrap gap-1 w-full animate-fade-in pb-2">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleCopy(noteId, 'Note ID')}>
              <Copy className="h-3 w-3" />note ID
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleCopy(event.content, 'Text')}>
              <Copy className="h-3 w-3" />text
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleCopy(`https://njump.me/${noteId}`, 'Link')}>
              <Share2 className="h-3 w-3" />link
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportJson}>
              <FileJson className="h-3 w-3" />JSON
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleSaveMd}>
              <Download className="h-3 w-3" />.md
            </Button>
          </div>
        )}
      </CardFooter>

      {/* Inline comments panel — slides open below the footer */}
      <InlineCommentsPanel event={event} isOpen={showComments} />
    </Card>
  );
}
