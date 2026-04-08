/**
 * ArticleViewPage — NIP-23 Full Article Reader
 *
 * Route: /articles/:naddr
 *
 * Features:
 *  - Decodes naddr (NIP-19) to get kind, pubkey, identifier
 *  - Always author-filters the query (security: naddr contains pubkey)
 *  - Renders Markdown with Tailwind Typography (theme-aware via CSS vars)
 *  - Handles nostr: URIs per NIP-27 / NIP-21 with inline enrichment
 *  - Author card with avatar, name, relay hint
 *  - Edit button shown only to the author
 *  - Copy naddr / Share button
 *  - Back navigation
 */

import { useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { format, formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AppLayout } from '@/components/AppLayout';
import { useArticleByCoords, parseArticleMeta } from '@/hooks/useArticles';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { genUserName } from '@/lib/genUserName';
import { useToast } from '@/hooks/useToast';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import {
  ArrowLeft, Edit3, Calendar, Clock, Tag, Copy, Share2,
  FileText, User,
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

// ─── Main page ────────────────────────────────────────────────────────────────

export function ArticleViewPage() {
  const { naddr: naddrParam } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { toast } = useToast();

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

            {/* Bottom metadata */}
            <Separator className="opacity-40 mt-6" />
            <div className="flex items-center justify-between gap-3 flex-wrap pb-4">
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-mono">
                  d:{meta.d}
                </p>
                <p>
                  kind:30023 · Updated{' '}
                  {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleCopyNaddr}>
                  <Copy className="h-3 w-3" />
                  Copy nostr: URI
                </Button>
                {isAuthor && naddrForEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
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
