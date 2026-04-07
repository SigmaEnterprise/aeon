/**
 * NoteContent — renders the .content of any text-readable Nostr event.
 *
 * Implements NIP-27 (Text Note References):
 *  • nostr:npub1…      → @Name mention pill (with avatar)
 *  • nostr:nprofile1…  → @Name mention pill (with avatar + relay hints)
 *  • nostr:note1…      → inline quoted note card
 *  • nostr:nevent1…    → inline quoted event card
 *  • nostr:naddr1…     → link to addressable event
 *  • #hashtag          → hashtag link
 *  • https://…         → URL link (images/videos already handled by MediaAttachments)
 */

import { useMemo } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { FileText } from 'lucide-react';

interface NoteContentProps {
  event: NostrEvent;
  className?: string;
}

/** Parses content of text note events so that URLs, mentions, and hashtags are rendered. */
export function NoteContent({ event, className }: NoteContentProps) {
  const content = useMemo(() => {
    const text = event.content;

    // Match: URLs | nostr: URIs (with full bech32 charset) | #hashtags
    const regex =
      /(https?:\/\/[^\s<>"')\]]+)|(nostr:(?:npub1|note1|nprofile1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+)|(#\w+)/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(text)) !== null) {
      const [fullMatch, url, nostrUri, hashtag] = match;
      const index = match.index;

      // Literal text before this match
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }

      if (url) {
        // Plain URL — media renderer handles images/videos separately; just linkify
        parts.push(
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline break-all"
          >
            {url}
          </a>
        );
      } else if (nostrUri) {
        // Strip the "nostr:" prefix to get the bech32 id
        const bech32 = nostrUri.replace(/^nostr:/, '');
        try {
          const decoded = nip19.decode(bech32);

          switch (decoded.type) {
            case 'npub':
              parts.push(<MentionPill key={key++} pubkey={decoded.data} />);
              break;

            case 'nprofile':
              parts.push(<MentionPill key={key++} pubkey={decoded.data.pubkey} />);
              break;

            case 'note':
              parts.push(<QuotedNote key={key++} eventId={decoded.data} />);
              break;

            case 'nevent':
              parts.push(
                <QuotedNote key={key++} eventId={decoded.data.id} authorHint={decoded.data.author} />
              );
              break;

            case 'naddr':
              parts.push(
                <Link
                  key={key++}
                  to={`/${bech32}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm font-medium"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  {decoded.data.identifier || 'article'}
                </Link>
              );
              break;

            default:
              parts.push(
                <Link key={key++} to={`/${bech32}`} className="text-primary hover:underline break-all">
                  {fullMatch}
                </Link>
              );
          }
        } catch {
          // Malformed bech32 — render as plain text
          parts.push(fullMatch);
        }
      } else if (hashtag) {
        const tag = hashtag.slice(1);
        parts.push(
          <Link
            key={key++}
            to={`/t/${tag}`}
            className="text-primary hover:underline font-medium"
          >
            {hashtag}
          </Link>
        );
      }

      lastIndex = index + fullMatch.length;
    }

    // Remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  }, [event]);

  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {content}
    </div>
  );
}

// ─── @Mention pill ────────────────────────────────────────────────────────────

function MentionPill({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(pubkey);
  const isLoaded = !!metadata;

  return (
    <Link
      to={`/${npub}`}
      className={cn(
        'inline-flex items-center gap-1 align-baseline',
        'rounded-full px-1.5 py-0.5 mx-0.5',
        'text-sm font-semibold leading-none no-underline',
        'bg-primary/10 text-primary hover:bg-primary/20 transition-colors',
        'ring-1 ring-primary/20 hover:ring-primary/40',
      )}
    >
      {isLoaded && (
        <Avatar className="h-4 w-4 shrink-0">
          <AvatarImage src={metadata?.picture} alt={displayName} />
          <AvatarFallback className="text-[8px] font-bold">
            {displayName.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span>@{displayName}</span>
    </Link>
  );
}

// ─── Inline quoted note ───────────────────────────────────────────────────────

function useEvent(eventId: string, authorHint?: string) {
  const { nostr } = useNostr();
  return useQuery({
    queryKey: ['nostr', 'event', eventId],
    queryFn: async () => {
      const filters = authorHint
        ? [{ ids: [eventId], authors: [authorHint], limit: 1 }, { ids: [eventId], limit: 1 }]
        : [{ ids: [eventId], limit: 1 }];
      const [event] = await nostr.query(filters, { signal: AbortSignal.timeout(5000) });
      return event ?? null;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

function QuotedNote({ eventId, authorHint }: { eventId: string; authorHint?: string }) {
  const { data: event, isLoading } = useEvent(eventId, authorHint);
  const author = useAuthor(event?.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? (event ? genUserName(event.pubkey) : '…');
  const npub = event ? nip19.npubEncode(event.pubkey) : '';
  const noteId = event ? nip19.noteEncode(event.id) : '';
  const timeAgo = event
    ? formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })
    : '';

  // Truncate long note content for preview
  const preview = useMemo(() => {
    if (!event) return '';
    // Strip nostr: URIs and URLs to keep preview clean
    const cleaned = event.content
      .replace(/nostr:[a-z0-9]+/gi, '[…]')
      .replace(/https?:\/\/\S+/g, '[link]')
      .trim();
    return cleaned.length > 240 ? cleaned.slice(0, 240) + '…' : cleaned;
  }, [event]);

  if (isLoading) {
    return (
      <span className="inline-block my-1 w-full">
        <span className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-3 rounded-full bg-muted animate-pulse" />
          Loading quote…
        </span>
      </span>
    );
  }

  if (!event) {
    return (
      <span className="inline-block my-1">
        <span className="text-xs text-muted-foreground italic">[referenced note not found]</span>
      </span>
    );
  }

  return (
    <Link
      to={`/${noteId}`}
      className="block my-2 rounded-xl border bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden no-underline group"
    >
      {/* Author row */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <Avatar className="h-5 w-5 shrink-0">
          <AvatarImage src={metadata?.picture} alt={displayName} />
          <AvatarFallback className="text-[8px] font-bold bg-primary/10 text-primary">
            {displayName.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <Link
          to={`/${npub}`}
          className="text-xs font-semibold hover:underline text-foreground"
          onClick={e => e.stopPropagation()}
        >
          @{displayName}
        </Link>
        <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo}</span>
      </div>

      {/* Content preview */}
      <p className="px-3 pb-2.5 text-sm text-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
        {preview}
      </p>

      {/* Footer */}
      <div className="px-3 py-1 border-t bg-muted/20 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[160px]">
          {noteId.slice(0, 16)}…
        </span>
        <span className="text-[10px] text-primary group-hover:underline">View note →</span>
      </div>
    </Link>
  );
}
