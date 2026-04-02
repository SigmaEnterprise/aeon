import { useState } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
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
} from 'lucide-react';

interface NoteCardProps {
  event: NostrEvent;
  className?: string;
}

export function NoteCard({ event, className }: NoteCardProps) {
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

// Render media attachments from event content
function MediaAttachments({ event }: { event: NostrEvent }) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = event.content.match(urlRegex) || [];

  const mediaUrls = urls.filter(url =>
    url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i) ||
    url.match(/\.(mp4|webm|mov|ogv)(\?.*)?$/i) ||
    url.match(/\.(mp3|ogg|wav|flac|aac)(\?.*)?$/i)
  );

  if (!mediaUrls.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {mediaUrls.map((url, i) => {
        if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
          return (
            <img
              key={i}
              src={url}
              alt="attachment"
              className="max-w-full rounded-lg border object-cover"
              style={{ maxHeight: '400px' }}
              loading="lazy"
            />
          );
        }
        if (url.match(/\.(mp4|webm|mov|ogv)(\?.*)?$/i)) {
          return (
            <video key={i} src={url} controls className="max-w-full rounded-lg border" style={{ maxHeight: '400px' }} />
          );
        }
        if (url.match(/\.(mp3|ogg|wav|flac|aac)(\?.*)?$/i)) {
          return <audio key={i} src={url} controls className="w-full rounded-lg" />;
        }
        return null;
      })}
    </div>
  );
}
