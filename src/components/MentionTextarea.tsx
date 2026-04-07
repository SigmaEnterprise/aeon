/**
 * MentionTextarea — a textarea that supports NIP-27 @-mention autocomplete.
 *
 * When the user types "@" followed by characters, a dropdown appears showing
 * matching Nostr profiles fetched from the network. Selecting a profile:
 *   1. Replaces the "@query" with "nostr:nprofile1..." in the .content (NIP-27)
 *   2. Notifies the parent of the selected pubkeys so it can add ["p", ...] tags
 *
 * Consumers pass `onMentionSelect` to collect mentioned pubkeys for event tags.
 * The textarea value is a controlled `value` / `onChange` pair like a normal input.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { nip19 } from 'nostr-tools';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useMentionSearch } from '@/hooks/useMentionSearch';
import { genUserName } from '@/lib/genUserName';
import { Loader2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  /** Called each time a mention is inserted; provides the mentioned pubkey */
  onMentionSelect?: (pubkey: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

// ─── Helper: find the current @query under the cursor ─────────────────────────

function getActiveMention(text: string, cursor: number): { query: string; start: number } | null {
  // Walk back from cursor to find an uninterrupted @word
  let i = cursor - 1;
  while (i >= 0 && !/\s/.test(text[i]) && text[i] !== '@') {
    i--;
  }
  if (i >= 0 && text[i] === '@') {
    const query = text.slice(i + 1, cursor);
    // Only trigger if the @ isn't part of a nostr: URI already
    const before = text.slice(Math.max(0, i - 6), i);
    if (before.includes('nostr:')) return null;
    return { query, start: i };
  }
  return null;
}

// ─── MentionTextarea ──────────────────────────────────────────────────────────

export function MentionTextarea({
  value,
  onChange,
  onMentionSelect,
  placeholder = 'Write something… type @ to mention someone',
  className,
  minHeight = '80px',
  disabled = false,
  onKeyDown,
  textareaRef: externalRef,
}: MentionTextareaProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = externalRef ?? internalRef;
  const containerRef = useRef<HTMLDivElement>(null);

  const [mentionState, setMentionState] = useState<{
    query: string;
    start: number;
    cursorPos: number;
  } | null>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const { data: results = [], isFetching } = useMentionSearch(
    mentionState?.query ?? '',
    mentionState !== null
  );

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  // ── Position the dropdown relative to the @ character ─────────────────────
  const updateDropdownPos = useCallback(() => {
    const ta = ref.current;
    if (!ta || !mentionState) return;

    // Use a hidden mirror div technique to measure caret position
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(ta);

    mirror.style.cssText = `
      position: absolute; visibility: hidden; white-space: pre-wrap;
      word-wrap: break-word; overflow-wrap: break-word;
      font: ${style.font}; padding: ${style.padding};
      border: ${style.border}; width: ${ta.offsetWidth}px;
      line-height: ${style.lineHeight}; letter-spacing: ${style.letterSpacing};
      box-sizing: border-box;
    `;

    const textBefore = ta.value.slice(0, mentionState.start);
    mirror.textContent = textBefore;
    const span = document.createElement('span');
    span.textContent = '@';
    mirror.appendChild(span);
    document.body.appendChild(mirror);

    const spanRect = span.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    document.body.removeChild(mirror);

    // Position below the @ sign, clamped to viewport
    const rawTop = spanRect.top - taRect.top + ta.scrollTop + 20;
    const rawLeft = Math.min(
      spanRect.left - taRect.left,
      ta.offsetWidth - 280
    );

    setDropdownPos({ top: Math.max(rawTop, 0), left: Math.max(rawLeft, 0) });
  }, [ref, mentionState]);

  useEffect(() => {
    if (mentionState) updateDropdownPos();
  }, [mentionState, updateDropdownPos]);

  // ── Handle textarea changes ────────────────────────────────────────────────
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart ?? newValue.length;
    onChange(newValue);

    const active = getActiveMention(newValue, cursor);
    if (active) {
      setMentionState({ query: active.query, start: active.start, cursorPos: cursor });
    } else {
      setMentionState(null);
    }
  };

  // ── Insert a mention ───────────────────────────────────────────────────────
  const insertMention = useCallback(
    (pubkey: string, displayName: string) => {
      const ta = ref.current;
      if (!mentionState || !ta) return;

      // Build NIP-27 nostr:nprofile1... URI
      const nprofile = nip19.nprofileEncode({ pubkey });
      const mentionText = `nostr:${nprofile}`;

      // Replace the @query with the mention URI
      const before = value.slice(0, mentionState.start);
      const after = value.slice(mentionState.cursorPos);
      const newValue = `${before}${mentionText} ${after}`;

      onChange(newValue);
      onMentionSelect?.(pubkey);
      setMentionState(null);

      // Restore focus and move cursor after inserted mention
      requestAnimationFrame(() => {
        ta.focus();
        const newCursor = before.length + mentionText.length + 1;
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [value, mentionState, onChange, onMentionSelect, ref]
  );

  // ── Keyboard navigation of dropdown ───────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionState && results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const profile = results[activeIndex];
        if (profile) {
          const dn = profile.metadata.name ?? genUserName(profile.pubkey);
          insertMention(profile.pubkey, dn);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionState(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showDropdown = mentionState !== null && (isFetching || results.length > 0);

  return (
    <div ref={containerRef} className="relative w-full">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{ minHeight }}
        className={cn(
          'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
          'ring-offset-background placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'resize-none',
          className
        )}
      />

      {/* ── Mention dropdown ── */}
      {showDropdown && (
        <div
          className="absolute z-50 w-72 rounded-lg border bg-popover shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Mention a person
            </span>
            {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>

          {isFetching && results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No profiles found for "<span className="font-mono">{mentionState?.query}</span>"
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto py-1">
              {results.map((profile, i) => {
                const dn = profile.metadata.name ?? genUserName(profile.pubkey);
                const displayName2 = profile.metadata.display_name;
                return (
                  <li key={profile.pubkey}>
                    <button
                      type="button"
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                        i === activeIndex
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-muted/60'
                      )}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={e => {
                        e.preventDefault(); // Don't blur textarea
                        insertMention(profile.pubkey, dn);
                      }}
                    >
                      <Avatar className="h-8 w-8 shrink-0 ring-1 ring-border">
                        <AvatarImage src={profile.metadata.picture} alt={dn} />
                        <AvatarFallback className="text-[10px] font-bold bg-primary/10 text-primary">
                          {dn.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate leading-tight">
                          {dn}
                        </p>
                        {displayName2 && displayName2 !== dn && (
                          <p className="text-[11px] text-muted-foreground truncate leading-tight">
                            {displayName2}
                          </p>
                        )}
                        {profile.metadata.nip05 && (
                          <p className="text-[10px] text-muted-foreground/70 truncate font-mono">
                            {profile.metadata.nip05}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t bg-muted/30 flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground">↑↓ navigate</span>
            <span className="text-[9px] text-muted-foreground">Enter to select · Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
