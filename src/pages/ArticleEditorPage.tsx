/**
 * ArticleEditorPage — NIP-23 Long-form Content Editor
 *
 * Features:
 *  - Metadata fields: title, summary, image URL, hashtags
 *  - Image field supports drag-and-drop → auto-upload via useUploadFile (Blossom)
 *  - Distraction-free markdown editor (raw textarea, monospaced)
 *  - Split live-preview pane with Tailwind Typography
 *  - Save draft (kind:30024) — publishes to relay immediately for global backup
 *  - Publish article (kind:30023) — sets published_at on first publish
 *  - Editing existing articles: naddr passed via route param preserves d tag
 *
 * NIP-23 compliance:
 *  - MUST NOT hard line-break paragraphs
 *  - MUST NOT include HTML in markdown
 *  - d tag = slugified title (preserved on edits)
 *  - published_at = unix timestamp of first publish (preserved on re-edits)
 *
 * NIP-27 / NIP-21:
 *  - nostr:... links in content are rendered via react-markdown custom renderer
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AppLayout } from '@/components/AppLayout';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useArticleByCoords, parseArticleMeta, slugify } from '@/hooks/useArticles';
import { useToast } from '@/hooks/useToast';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  Save, Eye, Edit3, ArrowLeft, Upload, X, Tag, Loader2,
  Image as ImageIcon, FileText, Info, FilePen, Globe, PenSquare,
} from 'lucide-react';

// ─── Nostr URI renderer for react-markdown (NIP-27) ──────────────────────────

function NostrUriLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <>{children}</>;

  // Handle nostr: URI scheme per NIP-21
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
            <Link to={`/${npub}`} className="text-primary hover:underline font-medium">
              @{String(children)}
            </Link>
          );
        }
        case 'note':
        case 'nevent': {
          const noteId = decoded.type === 'note' ? nip19.noteEncode(decoded.data) : nip19.neventEncode({ id: decoded.data.id });
          return (
            <Link to={`/${noteId}`} className="text-primary hover:underline">
              {String(children) || `note:${bech32.slice(0, 12)}…`}
            </Link>
          );
        }
        case 'naddr':
          return (
            <Link to={`/articles/${bech32}`} className="text-primary hover:underline inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5 inline" />
              {String(children) || decoded.data.identifier}
            </Link>
          );
        default:
          return <a href={href} className="text-primary hover:underline">{children}</a>;
      }
    } catch {
      return <span className="text-muted-foreground">{children}</span>;
    }
  }

  // Regular http links
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
      {children}
    </a>
  );
}

// ─── Markdown preview renderer ────────────────────────────────────────────────

function MarkdownPreview({ content, title, image, summary }: {
  content: string;
  title: string;
  image: string;
  summary: string;
}) {
  return (
    <div className="min-h-full">
      {/* Article hero */}
      {image && (
        <div className="w-full h-52 rounded-xl overflow-hidden mb-5 bg-muted">
          <img src={image} alt={title} className="w-full h-full object-cover" />
        </div>
      )}
      {title && (
        <h1 className="text-2xl font-extrabold leading-tight tracking-tight mb-2 text-foreground">
          {title}
        </h1>
      )}
      {summary && (
        <p className="text-base text-muted-foreground italic leading-relaxed mb-4 border-l-2 border-primary/30 pl-3">
          {summary}
        </p>
      )}
      {(title || summary) && <Separator className="mb-4 opacity-30" />}

      {content.trim() ? (
        <div
          className={[
            'prose prose-sm max-w-none',
            // Map Tailwind CSS vars onto the prose palette so all themes work
            'prose-headings:text-foreground',
            'prose-p:text-foreground prose-p:leading-relaxed',
            'prose-a:text-primary hover:prose-a:underline',
            'prose-strong:text-foreground',
            'prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:rounded',
            'prose-pre:bg-muted prose-pre:border prose-pre:rounded-lg',
            'prose-blockquote:border-l-primary/50 prose-blockquote:text-muted-foreground',
            'prose-hr:border-border',
            'prose-li:text-foreground',
            'prose-table:text-foreground',
            'prose-img:rounded-lg',
          ].join(' ')}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => <NostrUriLink href={href}>{children}</NostrUriLink>,
              // Disable raw HTML per NIP-23
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              html: () => null,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/40 gap-2">
          <FileText className="h-8 w-8" />
          <span className="text-sm">Start writing to see preview…</span>
        </div>
      )}
    </div>
  );
}

// ─── Image drop zone ──────────────────────────────────────────────────────────

function ImageDropZone({
  value,
  onChange,
  onUploading,
}: {
  value: string;
  onChange: (url: string) => void;
  onUploading: (v: boolean) => void;
}) {
  const { mutateAsync: uploadFile } = useUploadFile();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to upload images.', variant: 'destructive' });
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Images only', description: 'Please drop an image file.', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    onUploading(true);
    try {
      const tags = await uploadFile(file);
      const urlTag = tags.find(([t]) => t === 'url');
      if (urlTag?.[1]) {
        onChange(urlTag[1]);
        toast({ title: 'Image uploaded!', description: 'Header image set.' });
      }
    } catch (err) {
      toast({ title: 'Upload failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
      onUploading(false);
    }
  }, [uploadFile, user, toast, onChange, onUploading]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        <ImageIcon className="h-3 w-3" />
        Article Header Image
      </Label>
      <div
        className={[
          'relative border-2 border-dashed rounded-lg transition-colors cursor-pointer',
          isDragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
          isUploading ? 'opacity-70 pointer-events-none' : '',
        ].join(' ')}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {value ? (
          <div className="relative h-28 rounded-lg overflow-hidden">
            <img src={value} alt="Header" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-xs font-medium">Click or drop to replace</span>
            </div>
            <button
              type="button"
              className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full p-0.5 transition-colors"
              onClick={e => { e.stopPropagation(); onChange(''); }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="h-24 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
            {isUploading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-xs">Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span className="text-xs font-medium">Drop image or click to upload</span>
                <span className="text-[10px]">Blossom CDN · JPG / PNG / WebP</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Also allow manual URL paste */}
      <Input
        placeholder="…or paste an image URL"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs h-8"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Main editor page ─────────────────────────────────────────────────────────

export function ArticleEditorPage() {
  const { naddr: naddrParam } = useParams<{ naddr?: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending: isPublishing } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Decode naddr if editing an existing article ──────────────────────────
  const existingCoords = useMemo(() => {
    if (!naddrParam) return null;
    try {
      const decoded = nip19.decode(naddrParam);
      if (decoded.type === 'naddr') return decoded.data;
    } catch { /* ignore */ }
    return null;
  }, [naddrParam]);

  const isEditing = !!existingCoords;

  // ── Fetch existing article for editing ────────────────────────────────────
  const { data: existingEvent, isLoading: isLoadingArticle } = useArticleByCoords(
    existingCoords?.pubkey,
    existingCoords?.identifier,
    (existingCoords?.kind as 30023 | 30024 | undefined) === 30024 ? 30024 : 30023,
  );

  // ── Form state ───────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [image, setImage] = useState('');
  const [tags, setTags] = useState('');
  const [content, setContent] = useState('');
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Track the original d tag and published_at so they are preserved on edit
  const [dTag, setDTag] = useState('');
  const [publishedAt, setPublishedAt] = useState<number | null>(null);
  const [editorPane, setEditorPane] = useState<'write' | 'preview' | 'split'>('write');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useSeoMeta({
    title: isEditing ? `Edit Article — Aeon` : 'New Article — Aeon',
  });

  // ── Populate form from existing event ────────────────────────────────────
  useEffect(() => {
    if (existingEvent) {
      const meta = parseArticleMeta(existingEvent);
      setTitle(meta.title);
      setSummary(meta.summary);
      setImage(meta.image);
      setTags(meta.tags.join(', '));
      setContent(existingEvent.content);
      setDTag(meta.d);
      setPublishedAt(meta.publishedAt);
    }
  }, [existingEvent]);

  // Mark dirty on any form change
  const markDirty = () => setHasUnsavedChanges(true);

  // ── Build NIP-23 event tags ───────────────────────────────────────────────
  function buildEventTags(kind: 30023 | 30024, slug: string): string[][] {
    const now = Math.floor(Date.now() / 1000);
    const eventTags: string[][] = [['d', slug]];

    if (title) eventTags.push(['title', title.trim()]);
    if (summary.trim()) eventTags.push(['summary', summary.trim()]);
    if (image.trim()) eventTags.push(['image', image.trim()]);

    // published_at: set on first publish, preserve on edits
    if (kind === 30023) {
      const pubAt = publishedAt ?? now;
      eventTags.push(['published_at', String(pubAt)]);
    }

    // Hashtag t tags
    const tagList = tags.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
    for (const t of tagList) eventTags.push(['t', t]);

    return eventTags;
  }

  // ── Save draft (kind:30024) ───────────────────────────────────────────────
  async function handleSaveDraft() {
    if (!user) {
      toast({ title: 'Login required', variant: 'destructive' });
      return;
    }
    if (!title.trim() && !content.trim()) {
      toast({ title: 'Nothing to save', description: 'Add a title or content first.', variant: 'destructive' });
      return;
    }

    // Preserve existing d tag or generate from title
    const slug = dTag || slugify(title || `draft-${Date.now()}`);
    if (!dTag) setDTag(slug);

    setIsSavingDraft(true);
    try {
      await publishEvent({
        kind: 30024,
        content,
        tags: buildEventTags(30024, slug),
        created_at: Math.floor(Date.now() / 1000),
      });
      toast({
        title: '📝 Draft saved to relay',
        description: 'Your draft is backed up on your connected relays.',
      });
      setHasUnsavedChanges(false);
      // Invalidate drafts query
      queryClient.invalidateQueries({ queryKey: ['articles', 'drafts'] });
    } catch (err) {
      toast({ title: 'Failed to save draft', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsSavingDraft(false);
    }
  }

  // ── Publish article (kind:30023) ──────────────────────────────────────────
  async function handlePublish() {
    if (!user) {
      toast({ title: 'Login required', variant: 'destructive' });
      return;
    }
    if (!title.trim()) {
      toast({ title: 'Title required', description: 'Add a title before publishing.', variant: 'destructive' });
      return;
    }
    if (!content.trim()) {
      toast({ title: 'Content required', description: 'Write some content before publishing.', variant: 'destructive' });
      return;
    }

    const slug = dTag || slugify(title);
    if (!dTag) setDTag(slug);

    try {
      const event = await publishEvent({
        kind: 30023,
        content,
        tags: buildEventTags(30023, slug),
        created_at: Math.floor(Date.now() / 1000),
      });

      // Set publishedAt so subsequent edits preserve it
      const pAt = parseInt(event.tags.find(([t]) => t === 'published_at')?.[1] ?? '0', 10) || Math.floor(Date.now() / 1000);
      setPublishedAt(pAt);

      toast({ title: '🚀 Article published!', description: 'Your article is live on Nostr.' });
      setHasUnsavedChanges(false);

      // Invalidate queries and navigate to article
      queryClient.invalidateQueries({ queryKey: ['articles'] });

      const naddr = nip19.naddrEncode({
        kind: 30023,
        pubkey: user.pubkey,
        identifier: slug,
        relays: [],
      });
      navigate(`/articles/${naddr}`);
    } catch (err) {
      toast({ title: 'Failed to publish', description: (err as Error).message, variant: 'destructive' });
    }
  }

  // ── Guard: must be logged in ─────────────────────────────────────────────
  if (!user) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="font-semibold">Login required</p>
          <p className="text-sm text-muted-foreground">Please log in to write articles.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/articles"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to Articles</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (isEditing && isLoadingArticle) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Loading article…</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Link to="/articles">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-base font-bold flex items-center gap-2">
                {isEditing ? (
                  <><Edit3 className="h-4 w-4 text-primary" />Editing Article</>
                ) : (
                  <><PenSquare className="h-4 w-4 text-primary" />New Article</>
                )}
              </h1>
              {dTag && (
                <p className="text-[11px] text-muted-foreground font-mono">d:{dTag}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {hasUnsavedChanges && (
              <Badge variant="outline" className="text-[10px] h-6 border-amber-500/50 text-amber-600 dark:text-amber-400">
                Unsaved changes
              </Badge>
            )}

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8"
              onClick={handleSaveDraft}
              disabled={isSavingDraft || isPublishing || isImageUploading}
            >
              {isSavingDraft
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <FilePen className="h-3.5 w-3.5" />}
              Save Draft
            </Button>

            <Button
              size="sm"
              className="gap-1.5 h-8"
              onClick={handlePublish}
              disabled={isPublishing || isSavingDraft || isImageUploading}
            >
              {isPublishing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Globe className="h-3.5 w-3.5" />}
              {isEditing ? 'Update Article' : 'Publish'}
            </Button>
          </div>
        </div>

        {/* ── Layout: metadata sidebar + editor/preview ──────────────── */}
        <div className="flex gap-4 items-start">

          {/* ── Metadata sidebar ──────────────────────────────────────── */}
          <aside className="w-64 shrink-0 space-y-4">

            {/* Title */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Your article title"
                value={title}
                onChange={e => { setTitle(e.target.value); markDirty(); }}
                className="text-sm"
              />
            </div>

            {/* Summary */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Summary
              </Label>
              <textarea
                className="w-full min-h-[72px] text-sm bg-background border border-input rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 placeholder:text-muted-foreground"
                placeholder="A short description of your article…"
                value={summary}
                onChange={e => { setSummary(e.target.value); markDirty(); }}
              />
            </div>

            {/* Image drag-drop */}
            <ImageDropZone
              value={image}
              onChange={url => { setImage(url); markDirty(); }}
              onUploading={setIsImageUploading}
            />

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" />
                Hashtags (comma-separated)
              </Label>
              <Input
                placeholder="bitcoin, nostr, privacy"
                value={tags}
                onChange={e => { setTags(e.target.value); markDirty(); }}
                className="text-sm"
              />
              {tags && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean).map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 h-4">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* NIP-23 reminder */}
            <div className="rounded-lg bg-muted/40 border p-2.5 space-y-1.5 text-[11px] text-muted-foreground">
              <p className="font-semibold text-foreground/70">NIP-23 Rules</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Write in Markdown</li>
                <li>No hard line-breaks in paragraphs</li>
                <li>No raw HTML</li>
                <li>Use <code className="bg-muted px-0.5 rounded">nostr:npub1…</code> for @mentions</li>
                <li>Use <code className="bg-muted px-0.5 rounded">nostr:naddr1…</code> for article links</li>
              </ul>
            </div>

            {/* Save shortcuts */}
            <div className="rounded-lg bg-muted/20 border p-2.5 text-[11px] text-muted-foreground space-y-1">
              <p className="font-medium text-foreground/60">Quick actions</p>
              <p><kbd className="px-1 bg-muted rounded text-[10px]">Draft</kbd> → saves kind:30024 to relay</p>
              <p><kbd className="px-1 bg-muted rounded text-[10px]">Publish</kbd> → publishes kind:30023</p>
            </div>
          </aside>

          {/* ── Editor + Preview panel ────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-2">
            <Tabs value={editorPane} onValueChange={v => setEditorPane(v as typeof editorPane)}>
              <TabsList className="h-8 w-auto gap-0.5">
                <TabsTrigger value="write" className="h-7 text-xs gap-1.5">
                  <Edit3 className="h-3 w-3" />Write
                </TabsTrigger>
                <TabsTrigger value="preview" className="h-7 text-xs gap-1.5">
                  <Eye className="h-3 w-3" />Preview
                </TabsTrigger>
                <TabsTrigger value="split" className="h-7 text-xs gap-1.5">
                  <Save className="h-3 w-3" />Split
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Editor area */}
            <div className={`flex gap-3 ${editorPane === 'split' ? 'h-[calc(100vh-280px)]' : 'h-[calc(100vh-240px)]'}`}>

              {/* Write pane */}
              {(editorPane === 'write' || editorPane === 'split') && (
                <div className={`flex flex-col ${editorPane === 'split' ? 'w-1/2' : 'w-full'} min-w-0`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                      <Edit3 className="h-3 w-3" />
                      Markdown Editor
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {content.trim().split(/\s+/).filter(Boolean).length} words
                    </span>
                  </div>
                  <textarea
                    className={[
                      'flex-1 w-full rounded-lg border bg-background px-4 py-3 text-sm font-mono',
                      'resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                      'placeholder:text-muted-foreground/50 leading-relaxed',
                      'min-h-[400px]',
                    ].join(' ')}
                    placeholder={`Write your article in Markdown...\n\n## Introduction\n\nYour story starts here.\n\n> Use nostr:npub1... to mention people\n> Use nostr:naddr1... to link other articles`}
                    value={content}
                    onChange={e => { setContent(e.target.value); markDirty(); }}
                    spellCheck
                  />
                </div>
              )}

              {/* Preview pane */}
              {(editorPane === 'preview' || editorPane === 'split') && (
                <div className={`flex flex-col ${editorPane === 'split' ? 'w-1/2' : 'w-full'} min-w-0`}>
                  <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1 mb-1.5">
                    <Eye className="h-3 w-3" />
                    Live Preview
                  </span>
                  <div className="flex-1 overflow-auto rounded-lg border bg-card px-5 py-4 min-h-[400px]">
                    <MarkdownPreview
                      content={content}
                      title={title}
                      image={image}
                      summary={summary}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}


