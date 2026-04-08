/**
 * ArticleViewPage — NIP-23 Full Article Reader
 *
 * Route: /articles/:naddr
 *
 * Engagement bar (mirrors NoteCard exactly):
 *  - Comments (NIP-22 kind:1111, inline threaded panel)
 *  - Repost + Quote Repost (NIP-18 kind:16)
 *  - Like / reaction (kind:7)
 *  - Zap (NIP-57 via ZapButton/ZapDialog)
 *
 * Info panel (mirrors NoteCard "share" section):
 *  - Note ID (nevent bech32) — copy
 *  - Text (raw content) — copy
 *  - Link (current URL) — copy
 *  - JSON (raw event) — copy
 *  - .md (markdown download)
 */

import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import type { Event as NostrToolsEvent } from 'nostr-tools';
import { format, formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AppLayout } from '@/components/AppLayout';
import { useArticleByCoords, parseArticleMeta } from '@/hooks/useArticles';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useEventEngagement } from '@/hooks/useEventEngagement';
import { useComments } from '@/hooks/useComments';
import { usePostComment } from '@/hooks/usePostComment';
import { genUserName } from '@/lib/genUserName';
import { useToast } from '@/hooks/useToast';
import { ZapButton } from '@/components/ZapButton';
import { RepostButton } from '@/components/RepostButton';
import { NoteContent } from '@/components/NoteContent';
import { MentionTextarea } from '@/components/MentionTextarea';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  ArrowLeft, Edit3, Calendar, Clock, Tag, Copy, Share2,
  FileText, User, MessageSquare, Heart, Zap, Send, Loader2,
  CornerDownRight, ChevronDown, ChevronUp, Check, Download,
  Hash, Link as LinkIcon, FileJson, FileCode,
} from 'lucide-react';

import type { NostrEvent } from '@nostrify/nostrify';

// ─── NIP-27 / NIP-21 link renderer ───────────────────────────────────────────

function NostrLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <>{children}</>;

  if (href.startsWith('nostr:')) {
    const bech32 = href.replace(/^nostr:/, '');
    try {
      const decoded = nip19.decode(bech32);
      switch (decoded.type) {
        case 'npub':
        case 'nprofile': {
          const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
          const npub = nip19.npubEncode(pubkey);
          return (
            <Link
              to={`/${npub}`}
              className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
            >
              <User className="h-3 w-3 inline" />
              {String(children)}
            </Link>
          );
        }
        case 'note':
        case 'nevent': {
          const noteId = decoded.type === 'note'
            ? nip19.noteEncode(decoded.data)
            : nip19.neventEncode({ id: decoded.data.id });
          return (
            <Link to={`/${noteId}`} className="text-primary hover:underline">
              {String(children) || `note:${bech32.slice(0, 12)}…`}
            </Link>
          );
        }
        case 'naddr':
          return (
            <Link
              to={`/articles/${bech32}`}
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              <FileText className="h-3.5 w-3.5 inline shrink-0" />
              {String(children) || decoded.data.identifier}
            </Link>
          );
        default:
          return <a href={href} className="text-primary hover:underline">{children}</a>;
      }
    } catch {
      return <span>{children}</span>;
    }
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
      {children}
    </a>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ArticleSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Skeleton className="h-52 w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Separator />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className={`h-4 w-${i % 3 === 0 ? 'full' : i % 3 === 1 ? '5/6' : '4/5'}`} />
      ))}
    </div>
  );
}

// ─── Author card ──────────────────────────────────────────────────────────────

function AuthorCard({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);

  return (
    <Link to={`/${npub}`} className="flex items-center gap-3 group hover:opacity-80 transition-opacity">
      <Avatar className="h-10 w-10 ring-2 ring-border group-hover:ring-primary/30 transition-all">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">
          {displayName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="font-semibold text-sm leading-tight truncate">{displayName}</p>
        {metadata?.nip05 && (
          <p className="text-xs text-muted-foreground truncate">{metadata.nip05}</p>
        )}
        {!metadata?.nip05 && (
          <p className="text-xs text-muted-foreground font-mono truncate">{npub.slice(0, 20)}…</p>
        )}
      </div>
    </Link>
  );
}

// ─── Inline comment item (recursive, mirrors NoteCard exactly) ───────────────

interface InlineCommentItemProps {
  root: NostrEvent;
  comment: NostrEvent;
  depth?: number;
  allComments: NostrEvent[];
  onReply: (parent: NostrEvent, text: string, mentions?: Set<string>) => Promise<void>;
}

function InlineCommentItem({ root, comment, depth = 0, allComments, onReply }: InlineCommentItemProps) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const author = useAuthor(comment.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(comment.pubkey);
  const npub = nip19.npubEncode(comment.pubkey);
  const timeAgo = formatDistanceToNow(new Date(comment.created_at * 1000), { addSuffix: true });
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [showReplies, setShowReplies] = useState(depth < 1);
  const [replyText, setReplyText] = useState('');
  const [replyMentions, setReplyMentions] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !user || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onReply(comment, replyText.trim(), replyMentions);
      setReplyText('');
      setReplyMentions(new Set());
      setShowReplyForm(false);
      setShowReplies(true);
    } catch {
      toast({ title: 'Failed to post reply', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn('group', depth > 0 && 'ml-5 border-l-2 border-border/40 pl-3 mt-2')}>
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
          <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
            <span
              className="text-xs font-semibold cursor-pointer hover:underline"
              onClick={() => navigate(`/${npub}`)}
            >
              {displayName}
            </span>
            <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
          </div>

          <div className="text-sm leading-relaxed text-foreground/90">
            <NoteContent event={comment} className="text-sm" />
          </div>

          <div className="flex items-center gap-1 mt-1.5">
            <Button
              variant="ghost" size="sm"
              className={cn('h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1', showReplyForm && 'text-primary')}
              onClick={handleToggleReply}
            >
              <CornerDownRight className="h-3 w-3" />
              {showReplyForm ? 'Cancel' : 'Reply'}
            </Button>
            {hasReplies && (
              <Button
                variant="ghost" size="sm"
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

      {showReplyForm && (
        <div className="mt-2 ml-9">
          <form onSubmit={handleSubmitReply} className="space-y-1.5">
            <div className="flex gap-2 items-end">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                onMentionSelect={pk => setReplyMentions(prev => new Set([...prev, pk]))}
                placeholder={`Reply to ${displayName}… (@ to mention)`}
                minHeight="64px"
                disabled={isSubmitting}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmitReply(e); }}
              />
              <Button type="submit" size="sm" disabled={!replyText.trim() || isSubmitting} className="mb-0.5 shrink-0">
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Ctrl+Enter to send · @ to mention</p>
          </form>
        </div>
      )}

      {hasReplies && showReplies && (
        <div className="mt-2 space-y-2">
          {directReplies.map(reply => (
            <InlineCommentItem
              key={reply.id}
              root={root}
              comment={reply}
              depth={depth + 1}
              allComments={allComments}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Article comments panel (NIP-22 kind:1111) ────────────────────────────────

function ArticleCommentsPanel({ event, isOpen }: { event: NostrEvent; isOpen: boolean }) {
  const { user } = useCurrentUser();
  const { mutate: postComment, isPending: isPostingComment } = usePostComment();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [mentionedPubkeys, setMentionedPubkeys] = useState<Set<string>>(new Set());

  const { data: commentsData, isLoading } = useComments(event, 300);
  const topLevel = commentsData?.topLevelComments ?? [];
  const allComments = commentsData?.allComments ?? [];

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
          setMentionedPubkeys(new Set());
        },
        onError: () => toast({ title: 'Failed to post comment', variant: 'destructive' }),
      }
    );
  };

  const handleReplyToComment = async (parentComment: NostrEvent, replyText: string) => {
    await new Promise<void>((resolve, reject) => {
      postComment(
        { content: replyText, root: event, reply: parentComment },
        { onSuccess: () => resolve(), onError: reject }
      );
    });
  };

  return (
    <div className="border-t bg-muted/20 px-0 py-4 space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />
        Comments {!isLoading && `(${topLevel.length})`}
      </p>

      {user ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <MentionTextarea
            value={text}
            onChange={setText}
            onMentionSelect={pk => setMentionedPubkeys(prev => new Set([...prev, pk]))}
            placeholder="Write a comment… (@ to mention)"
            minHeight="80px"
            className="bg-background"
            disabled={isPostingComment}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit(e); }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Ctrl+Enter to send · @ to mention</span>
            <Button type="submit" size="sm" disabled={!text.trim() || isPostingComment} className="gap-1.5">
              {isPostingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {isPostingComment ? 'Posting…' : 'Comment'}
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
        <p className="text-xs text-muted-foreground text-center py-3">No comments yet — be the first!</p>
      ) : (
        <div className="space-y-4">
          {topLevel.map(comment => (
            <InlineCommentItem
              key={comment.id}
              root={event}
              comment={comment}
              depth={0}
              allComments={allComments}
              onReply={handleReplyToComment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Article info panel (note ID / text / link / JSON / .md) ─────────────────

function ArticleInfoPanel({ event, naddrParam }: { event: NostrEvent; naddrParam: string }) {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const nevent = nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind });

  const copy = (key: string, value: string, label: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      toast({ title: `${label} copied!` });
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const downloadMd = () => {
    const title = event.tags.find(([t]) => t === 'title')?.[1] ?? 'article';
    const filename = `${title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')}.md`;
    const blob = new Blob([event.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Markdown downloaded!' });
  };

  const items = [
    {
      key: 'noteid',
      icon: <Hash className="h-3.5 w-3.5" />,
      label: 'Note ID',
      value: `nostr:${nevent}`,
      display: `${nevent.slice(0, 20)}…`,
    },
    {
      key: 'text',
      icon: <FileCode className="h-3.5 w-3.5" />,
      label: 'Text',
      value: event.content,
      display: `${event.content.slice(0, 40).replace(/\n/g, ' ')}…`,
    },
    {
      key: 'link',
      icon: <LinkIcon className="h-3.5 w-3.5" />,
      label: 'Link',
      value: `${window.location.origin}/articles/${naddrParam}`,
      display: `/articles/${naddrParam.slice(0, 20)}…`,
    },
    {
      key: 'json',
      icon: <FileJson className="h-3.5 w-3.5" />,
      label: 'JSON',
      value: JSON.stringify(event, null, 2),
      display: `kind:${event.kind} · ${event.id.slice(0, 12)}…`,
    },
  ] as const;

  return (
    <div className="rounded-xl border bg-muted/20 overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Article Info
        </p>
      </div>
      <div className="divide-y divide-border/50">
        {items.map(item => (
          <div key={item.key} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors group">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0">{item.icon}</span>
              <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">{item.label}</span>
              <span className="text-xs font-mono text-foreground/70 truncate">{item.display}</span>
            </div>
            <Button
              variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => copy(item.key, item.value, item.label)}
            >
              {copiedKey === item.key
                ? <Check className="h-3 w-3 text-green-500" />
                : <Copy className="h-3 w-3" />
              }
            </Button>
          </div>
        ))}

        {/* .md download */}
        <div className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors group">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0"><Download className="h-3.5 w-3.5" /></span>
            <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">.md</span>
            <span className="text-xs font-mono text-foreground/70 truncate">Download Markdown file</span>
          </div>
          <Button
            variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={downloadMd}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Article engagement bar ───────────────────────────────────────────────────
// Mirrors NoteCard EngagementBar exactly:
//  💬 Comments · 🔁 Repost+Quote · ❤️ Like · ⚡ Zap

function ArticleEngagementBar({
  event,
  showComments,
  onToggleComments,
}: {
  event: NostrEvent;
  showComments: boolean;
  onToggleComments: () => void;
}) {
  const { user } = useCurrentUser();
  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const { data: commentsData } = useComments(event, 500);
  const commentCount = commentsData?.topLevelComments?.length ?? 0;
  const { data: engagement } = useEventEngagement(event.id);

  const handleLike = () => {
    if (!user) { toast({ title: 'Login required', variant: 'destructive' }); return; }
    publishEvent(
      { kind: 7, content: '+', tags: [['e', event.id], ['p', event.pubkey]], created_at: Math.floor(Date.now() / 1000) },
      {
        onSuccess: () => toast({ title: '❤️ Liked!' }),
        onError: () => toast({ title: 'Failed to like', variant: 'destructive' }),
      }
    );
  };

  return (
    <div className="flex items-center gap-0.5 w-full py-1">
      {/* Comments */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="sm"
            className={cn(
              'h-8 px-2 text-muted-foreground hover:text-foreground gap-1.5 transition-colors',
              showComments && 'text-primary bg-primary/10 hover:text-primary'
            )}
            onClick={onToggleComments}
          >
            <MessageSquare className="h-4 w-4" />
            {commentCount > 0 && <span className="text-xs tabular-nums font-medium">{commentCount}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {showComments ? 'Hide comments' : commentCount > 0 ? `${commentCount} comments` : 'Add comment'}
        </TooltipContent>
      </Tooltip>

      {/* Repost + Quote (NIP-18 kind:16 for non-kind:1) */}
      <RepostButton event={event} />

      {/* Like */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-red-500 gap-1.5"
            onClick={handleLike}
          >
            <Heart className="h-4 w-4" />
            {engagement && engagement.reactionCount > 0 && (
              <span className="text-xs tabular-nums">{engagement.reactionCount}</span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{engagement?.reactionCount ?? 0} likes</TooltipContent>
      </Tooltip>

      {/* Zap */}
      <div className="flex items-center">
        <ZapButton target={event as unknown as NostrToolsEvent} />
        {engagement && engagement.zapCount > 0 && (
          <span className="text-xs tabular-nums text-yellow-600 dark:text-yellow-400 -ml-1 flex items-center gap-0.5">
            <Zap className="h-3 w-3" />
            {engagement.zapTotal > 0 ? engagement.zapTotal.toLocaleString() : engagement.zapCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ArticleViewPage() {
  const { naddr: naddrParam } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [showComments, setShowComments] = useState(false);

  // Decode the naddr
  const coords = useMemo(() => {
    if (!naddrParam) return null;
    try {
      const decoded = nip19.decode(naddrParam);
      if (decoded.type === 'naddr') return decoded.data;
    } catch { /* ignore */ }
    return null;
  }, [naddrParam]);

  // Fetch the article — always author-filtered via coords.pubkey
  const { data: event, isLoading, error } = useArticleByCoords(
    coords?.pubkey,
    coords?.identifier,
    30023,
  );

  const meta = event ? parseArticleMeta(event) : null;

  const wordCount = event?.content.trim().split(/\s+/).length ?? 0;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 200));

  const isAuthor = user?.pubkey === coords?.pubkey;

  // Encode naddr for edit link
  const naddrForEdit = coords ? nip19.naddrEncode({
    kind: 30023,
    pubkey: coords.pubkey,
    identifier: coords.identifier,
    relays: [],
  }) : null;

  const publishedDate = meta?.publishedAt
    ? format(new Date(meta.publishedAt * 1000), 'MMMM d, yyyy')
    : event
    ? formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })
    : null;

  useSeoMeta({
    title: meta?.title ? `${meta.title} — Aeon` : 'Article — Aeon',
    description: meta?.summary,
    ogImage: meta?.image,
  });

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleCopyNaddr() {
    if (!naddrParam) return;
    navigator.clipboard.writeText(`nostr:${naddrParam}`).then(() => {
      toast({ title: 'Copied!', description: 'nostr: URI copied to clipboard.' });
    });
  }

  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: meta?.title, text: meta?.summary, url });
    } else {
      navigator.clipboard.writeText(url).then(() => {
        toast({ title: 'Link copied!' });
      });
    }
  }

  // ── Error / not found ────────────────────────────────────────────────────
  if (!coords) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="font-semibold">Invalid article link</p>
          <p className="text-sm text-muted-foreground">The naddr identifier could not be decoded.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/articles"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Articles</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (error || (!isLoading && !event)) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="font-semibold">Article not found</p>
          <p className="text-sm text-muted-foreground">
            This article could not be found on your connected relays.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/articles"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Articles</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-0">

        {/* ── Top navigation bar ──────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 mb-5">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 text-muted-foreground hover:text-foreground"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title="Copy nostr: URI"
              onClick={handleCopyNaddr}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              title="Share"
              onClick={handleShare}
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
            {isAuthor && naddrForEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => navigate(`/articles/edit/${naddrForEdit}`)}
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        </div>

        {/* ── Article content ──────────────────────────────────────────── */}
        {isLoading ? (
          <ArticleSkeleton />
        ) : event && meta ? (
          <article className="space-y-5">

            {/* Hero image */}
            {meta.image && (
              <div className="w-full h-56 sm:h-72 rounded-2xl overflow-hidden bg-muted shadow-sm">
                <img
                  src={meta.image}
                  alt={meta.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Title + summary */}
            <div className="space-y-2">
              {meta.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {meta.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px] px-2 h-5">
                      <Tag className="h-2.5 w-2.5 mr-0.5" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight text-foreground">
                {meta.title}
              </h1>

              {meta.summary && (
                <p className="text-base text-muted-foreground italic leading-relaxed border-l-2 border-primary/30 pl-3">
                  {meta.summary}
                </p>
              )}
            </div>

            {/* Author + meta row */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <AuthorCard pubkey={event.pubkey} />

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {publishedDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {publishedDate}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {readMinutes} min read
                </span>
                <span className="text-[11px] font-mono text-muted-foreground/50">
                  {wordCount} words
                </span>
              </div>
            </div>

            <Separator className="opacity-40" />

            {/* Markdown body */}
            <div
              className={[
                'prose prose-base max-w-none',
                // Theme-aware prose colors via CSS custom properties
                'prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight',
                'prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg',
                'prose-p:text-foreground prose-p:leading-relaxed prose-p:mb-4',
                'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
                'prose-strong:text-foreground prose-strong:font-semibold',
                'prose-em:text-foreground/80',
                'prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none',
                'prose-pre:bg-muted prose-pre:border prose-pre:rounded-xl prose-pre:shadow-sm',
                'prose-blockquote:border-l-4 prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:pl-4 prose-blockquote:not-italic',
                'prose-hr:border-border prose-hr:my-6',
                'prose-li:text-foreground prose-li:leading-relaxed',
                'prose-table:text-foreground',
                'prose-th:text-foreground prose-th:font-semibold prose-th:bg-muted/50',
                'prose-td:border-border',
                'prose-img:rounded-xl prose-img:shadow-sm prose-img:mx-auto',
                'prose-ul:list-disc prose-ol:list-decimal',
              ].join(' ')}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => <NostrLink href={href}>{children}</NostrLink>,
                  // Disable raw HTML per NIP-23
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  html: () => null,
                }}
              >
                {event.content}
              </ReactMarkdown>
            </div>

            {/* ── Engagement bar ──────────────────────────────────────── */}
            <Separator className="opacity-40 mt-4" />
            <ArticleEngagementBar
              event={event}
              showComments={showComments}
              onToggleComments={() => setShowComments(v => !v)}
            />

            {/* ── Inline comments panel ───────────────────────────────── */}
            <ArticleCommentsPanel event={event} isOpen={showComments} />

            {/* ── Info panel: note ID / text / link / JSON / .md ──────── */}
            <Separator className="opacity-40 mt-2" />
            <ArticleInfoPanel event={event} naddrParam={naddrParam!} />

            {/* ── Footer row: d-tag + edit ────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 flex-wrap pt-2 pb-4">
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="font-mono">d:{meta.d}</p>
                <p>
                  kind:30023 · Updated{' '}
                  {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleCopyNaddr}>
                  <Copy className="h-3 w-3" />
                  nostr: URI
                </Button>
                {isAuthor && naddrForEdit && (
                  <Button
                    variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                    onClick={() => navigate(`/articles/edit/${naddrForEdit}`)}
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit Article
                  </Button>
                )}
              </div>
            </div>
          </article>
        ) : null}
      </div>
    </AppLayout>
  );
}
