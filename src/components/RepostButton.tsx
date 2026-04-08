/**
 * RepostButton — NIP-18 repost & quote repost button.
 *
 * Click behaviour:
 *  • A dropdown opens with two options:
 *    1. "Repost" — publishes a kind:6 (for kind:1 notes) or kind:16 (for other kinds)
 *    2. "Quote Repost" — opens a compose dialog to write a kind:1 note with a
 *       nostr:note1… / nostr:nevent1… mention (NIP-27) + a `q` tag (NIP-18)
 *
 * Shows:
 *  • A green tint when the current user has already reposted
 *  • A combined repost+quote count badge
 */

import { useState } from 'react';
import { Repeat2, Quote, Check, Loader2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type NostrEvent } from '@nostrify/nostrify';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useReposts } from '@/hooks/useReposts';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { useQueryClient } from '@tanstack/react-query';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { NoteContent } from '@/components/NoteContent';

interface RepostButtonProps {
  event: NostrEvent;
  className?: string;
}

// ─── Mini preview of the note being quoted ────────────────────────────────────

function QuotePreview({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(event.pubkey);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });

  return (
    <div className="rounded-xl border bg-muted/40 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <Avatar className="h-5 w-5 shrink-0">
          <AvatarImage src={metadata?.picture} alt={displayName} />
          <AvatarFallback className="text-[8px] font-bold bg-primary/10 text-primary">
            {displayName.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="font-semibold text-xs">{displayName}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo}</span>
      </div>
      <div className="text-xs text-foreground/80 line-clamp-4 whitespace-pre-wrap break-words">
        <NoteContent event={event} className="text-xs" />
      </div>
    </div>
  );
}

// ─── Quote Repost Dialog ──────────────────────────────────────────────────────

interface QuoteDialogProps {
  event: NostrEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function QuoteRepostDialog({ event, open, onOpenChange, onSuccess }: QuoteDialogProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const { toast } = useToast();
  const [text, setText] = useState('');

  // Build the nostr: URI to embed in the quote
  const noteUri = event.kind === 1
    ? `nostr:${nip19.noteEncode(event.id)}`
    : `nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind })}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isPending) return;

    const fullContent = text.trim()
      ? `${text.trim()}\n\n${noteUri}`
      : noteUri;

    // Find a relay hint (use any relay from the config — we pass empty string as hint fallback)
    const relayHint = '';

    try {
      await publishEvent({
        kind: 1,
        content: fullContent,
        tags: [
          // e tag pointing to the quoted event (NIP-10 mention)
          ['e', event.id, relayHint, 'mention'],
          // q tag identifying this as a quote repost (NIP-18)
          ['q', event.id, relayHint],
          // p tag for the quoted author
          ['p', event.pubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      });

      toast({ title: 'Quote posted!' });
      setText('');
      onOpenChange(false);
      onSuccess();
    } catch {
      toast({ title: 'Failed to post quote', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Quote className="h-4 w-4 text-green-500" />
            Quote Repost
          </DialogTitle>
          <DialogDescription>
            Add your thoughts above the quoted note.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a comment… (optional)"
            className="resize-none min-h-[100px] text-sm"
            autoFocus
            disabled={isPending}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSubmit(e);
              }
            }}
          />

          {/* Preview of the quoted note */}
          <QuotePreview event={event} />

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Ctrl+Enter to post · The note will be embedded automatically
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Quote className="h-3.5 w-3.5" />
                )}
                {isPending ? 'Posting…' : 'Quote'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main RepostButton ────────────────────────────────────────────────────────

export function RepostButton({ event, className }: RepostButtonProps) {
  const { user } = useCurrentUser();
  const { mutate: publishEvent, isPending: isReposting } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  const { data: repostData } = useReposts(event);

  const totalCount = repostData?.totalCount ?? 0;
  const hasReposted = repostData?.hasReposted ?? false;

  const handleRepost = () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to repost.', variant: 'destructive' });
      return;
    }

    // NIP-18: kind:6 for kind:1 content, kind:16 for everything else
    const repostKind = event.kind === 1 ? 6 : 16;

    // Find a relay hint — we use empty string as fallback
    const relayHint = '';

    const tags: string[][] = [
      ['e', event.id, relayHint],
      ['p', event.pubkey],
    ];

    // kind:16 generic reposts SHOULD include a k tag with the kind number
    if (repostKind === 16) {
      tags.push(['k', String(event.kind)]);
    }

    publishEvent(
      {
        kind: repostKind,
        content: JSON.stringify(event),
        tags,
        created_at: Math.floor(Date.now() / 1000),
      },
      {
        onSuccess: () => {
          toast({ title: 'Reposted!' });
          queryClient.invalidateQueries({ queryKey: ['reposts', event.id] });
        },
        onError: () => toast({ title: 'Failed to repost', variant: 'destructive' }),
      }
    );

    setDropOpen(false);
  };

  const handleQuoteRepost = () => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to quote repost.', variant: 'destructive' });
      return;
    }
    setDropOpen(false);
    setQuoteOpen(true);
  };

  const handleQuoteSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['reposts', event.id] });
  };

  return (
    <>
      <DropdownMenu open={dropOpen} onOpenChange={setDropOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 px-2 gap-1.5 transition-colors',
                  hasReposted
                    ? 'text-green-500 hover:text-green-600'
                    : 'text-muted-foreground hover:text-green-500',
                  isReposting && 'opacity-70 pointer-events-none',
                  className
                )}
                disabled={isReposting}
                aria-label="Repost options"
              >
                {isReposting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : hasReposted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Repeat2 className="h-4 w-4" />
                )}
                {totalCount > 0 && (
                  <span className="text-xs tabular-nums font-medium">{totalCount}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {hasReposted
              ? `Reposted · ${totalCount} total`
              : totalCount > 0
              ? `${totalCount} reposts`
              : 'Repost'}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem
            onClick={handleRepost}
            disabled={isReposting || hasReposted}
            className="gap-2 cursor-pointer"
          >
            <Repeat2 className="h-4 w-4 text-green-500" />
            <div>
              <div className="font-medium text-sm">
                {hasReposted ? 'Already Reposted' : 'Repost'}
              </div>
              {hasReposted && (
                <div className="text-[10px] text-muted-foreground">You reposted this note</div>
              )}
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleQuoteRepost}
            className="gap-2 cursor-pointer"
          >
            <Quote className="h-4 w-4 text-blue-500" />
            <div>
              <div className="font-medium text-sm">Quote Repost</div>
              <div className="text-[10px] text-muted-foreground">Add your own comment</div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <QuoteRepostDialog
        event={event}
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        onSuccess={handleQuoteSuccess}
      />
    </>
  );
}
