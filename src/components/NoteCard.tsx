import { useState } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
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
} from 'lucide-react';

interface NoteCardProps {
  event: NostrEvent;
  className?: string;
}

// ─── YouTube helpers ──────────────────────────────────────────────────────────

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      // shorts
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
    // Blossom / CDN URLs without extension — try to detect by hostname patterns
    if (/(blossom\.|cdn\.|media\.|nostr\.build|void\.cat|nostpic\.com|nostrimg\.com|image\.nostr\.build)/i.test(clean)) {
      result.images.push(clean); continue;
    }
  }

  return result;
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
  const two = urls.length === 2;

  return (
    <>
      <div className={cn(
        'overflow-hidden rounded-xl border',
        single ? 'block' : 'grid gap-1',
        two && 'grid-cols-2',
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
              src={url}
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

  // Also check imeta tags for additional media
  const imetaUrls = event.tags
    .filter(t => t[0] === 'imeta')
    .map(t => {
      const urlPart = t.find((p, i) => i > 0 && p.startsWith('url '));
      return urlPart ? urlPart.replace('url ', '') : null;
    })
    .filter((u): u is string => !!u);

  // Merge imeta image URLs (avoid duplicates)
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

// ─── Kind 30023 Article card ──────────────────────────────────────────────────

function ArticleCard({ event, className }: NoteCardProps) {
  const { user } = useCurrentUser();
  const author = useAuthor(event.pubkey);
  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();

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
    if (!user) {
      toast({ title: 'Login required', variant: 'destructive' });
      return;
    }
    publishEvent({
      kind: 7, content: '+',
      tags: [['e', event.id], ['p', event.pubkey]],
      created_at: Math.floor(Date.now() / 1000),
    }, {
      onSuccess: () => toast({ title: 'Liked!' }),
      onError: () => toast({ title: 'Failed to like', variant: 'destructive' }),
    });
  };

  return (
    <Card className={cn('animate-fade-in hover:shadow-lg transition-all duration-200 overflow-hidden', className)}>
      {image && (
        <div className="relative w-full overflow-hidden" style={{ maxHeight: '240px' }}>
          <img
            src={image}
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
          <Avatar className="h-9 w-9 ring-2 ring-border shrink-0">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-xs font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm truncate block">{displayName}</span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{timeAgo}</span>
              <span>·</span>
              <span className="font-mono truncate max-w-[100px]">{npub.slice(0, 12)}…</span>
            </div>
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
              <Badge key={tag} variant="outline" className="text-xs px-2 py-0.5">
                #{tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="px-4 pb-3">
        <div className="flex items-center gap-1 w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-red-500" onClick={handleLike}>
                <Heart className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Like</TooltipContent>
          </Tooltip>

          <ZapButton target={event as unknown as NostrToolsEvent} />

          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
              <a href={`https://njump.me/${naddr}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Read
              </a>
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

// ─── Main NoteCard ────────────────────────────────────────────────────────────

export function NoteCard({ event, className }: NoteCardProps) {
  // Route kind 30023 to article card
  if (event.kind === 30023) {
    return <ArticleCard event={event} className={className} />;
  }

  const { user } = useCurrentUser();
  const author = useAuthor(event.pubkey);
  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const [showActions, setShowActions] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');

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
        tags: [
          ['e', event.id, '', 'mention'],
          ['p', event.pubkey],
        ],
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
        tags: [
          ['e', event.id],
          ['p', event.pubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      {
        onSuccess: () => toast({ title: 'Liked!' }),
        onError: () => toast({ title: 'Failed to like', variant: 'destructive' }),
      }
    );
  };

  const handleReply = () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to reply.', variant: 'destructive' });
      return;
    }
    if (!replyText.trim()) return;

    const rootTag = event.tags.find(t => t[0] === 'e' && t[3] === 'root');
    const rootId = rootTag ? rootTag[1] : event.id;

    publishEvent(
      {
        kind: 1,
        content: replyText,
        tags: [
          ['e', rootId, '', 'root'],
          ['e', event.id, '', 'reply'],
          ['p', event.pubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      {
        onSuccess: () => {
          toast({ title: 'Reply sent!' });
          setReplyText('');
          setIsReplying(false);
        },
        onError: () => toast({ title: 'Failed to reply', variant: 'destructive' }),
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

  // Detect media types present for icon hints in header
  const media = extractMediaUrls(event.content);
  const hasYoutube = media.youtube.length > 0;
  const hasVideo = media.videos.length > 0;
  const hasAudio = media.audio.length > 0;

  return (
    <Card className={cn("animate-fade-in hover:shadow-md transition-all duration-200", className)}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-border">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-xs font-bold">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{displayName}</span>
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span title={new Date(event.created_at * 1000).toLocaleString()}>{timeAgo}</span>
              <span>·</span>
              <span className="font-mono truncate max-w-[120px]">{npub.slice(0, 16)}…</span>
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

      <CardFooter className="px-4 pb-3 flex flex-col gap-2">
        {/* Primary actions */}
        <div className="flex items-center gap-1 w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-foreground gap-1.5" onClick={() => setIsReplying(!isReplying)}>
                <MessageSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reply</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-green-500 gap-1.5" onClick={handleRepost}>
                <Repeat2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Repost</TooltipContent>
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
          <div className="flex flex-wrap gap-1 w-full animate-fade-in">
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

        {/* Reply box */}
        {isReplying && (
          <div className="w-full animate-fade-in space-y-2 pt-1">
            <textarea
              className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              placeholder={`Reply to ${displayName}...`}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setIsReplying(false); setReplyText(''); }}>Cancel</Button>
              <Button size="sm" onClick={handleReply} disabled={!replyText.trim()}>Reply</Button>
            </div>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
