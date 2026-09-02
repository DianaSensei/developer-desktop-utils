// ⌘P — jump to any request in any collection by name / URL / method, the
// VS Code "Go to File" gesture. The sidebar search filters the tree in
// place, which is right for browsing a collection but slow for the thing a
// long session does most: getting back to one specific request among
// hundreds, across several collections, without scrolling or expanding
// folders. This is the one-keystroke version of that. Ranking lives in
// quickOpen.ts; this file is only the palette chrome and keyboard handling.
//
// Mirrors CommandPalette.tsx's shell (same overlay, position, footer) so ⌘K
// and ⌘P feel like two views of one mechanism rather than two dialogs —
// single column though: a request row already carries everything a
// preview pane would repeat.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Keycap } from '@/components/ui/keycap';
import { methodColor, methodShort } from './method-color';
import { searchRequests, type QuickOpenHit } from './quickOpen';
import type { Collection } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Collection[];
  // Ids currently open as tabs — marked in the list so "is this already
  // open?" is answered without closing the palette to look at the strip.
  openIds: string[];
  onPick: (requestId: string) => void;
}

export function RequestQuickOpen({ open, onOpenChange, collections, openIds, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Fresh query each time it opens — the previous search is rarely the next.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
  }, [open]);

  const hits = useMemo(() => (open ? searchRequests(collections, query) : []), [open, collections, query]);
  const openSet = useMemo(() => new Set(openIds), [openIds]);
  const active = hits[selected] ?? null;

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const pick = (hit: QuickOpenHit) => {
    onPick(hit.request.id);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, Math.max(0, hits.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) pick(active);
    }
  };

  const total = useMemo(() => searchRequests(collections, '', Number.MAX_SAFE_INTEGER).length, [collections]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs duration-fast ease-out-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className={cn(
            'fixed left-1/2 top-[14%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden',
            'rounded-lg border border-line/70 glass-strong glass-sheen shadow-lift duration-base ease-out-soft',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Go to request</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search every collection by request name, URL, or method.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2 border-b border-line px-3.5">
            <Search className="h-4 w-4 shrink-0 text-fg-mute/60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={onKeyDown}
              placeholder="Go to request — name, URL, or method"
              aria-label="Go to request"
              spellCheck={false}
              className="h-ctl-lg w-full bg-transparent text-sm text-fg outline-hidden placeholder:text-fg-mute/60"
            />
          </div>

          <div className="max-h-[380px] overflow-y-auto p-1.5" role="listbox" aria-label="Matching requests">
            {hits.length === 0 && (
              <p className="px-2.5 py-8 text-center text-[13px] text-fg-mute">
                {total === 0
                  ? 'No requests yet — create one in the sidebar first.'
                  : <>Nothing matches &ldquo;{query}&rdquo;.</>}
              </p>
            )}
            {hits.map((hit, i) => {
              const isActive = i === selected;
              const isOpen = openSet.has(hit.request.id);
              return (
                <button
                  key={hit.request.id}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => pick(hit)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                    isActive ? 'bg-acc-tint text-acc-ink' : 'text-fg hover:bg-bg-2/60',
                  )}
                >
                  <span className={cn('w-[2.25rem] shrink-0 text-[11px] font-bold uppercase', methodColor(hit.request.method))}>
                    {methodShort(hit.request.method)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{hit.request.name}</span>
                      {isOpen && (
                        <span className={cn('shrink-0 rounded-xs px-1 text-[11px] font-medium uppercase tracking-wide', isActive ? 'bg-acc/15 text-acc-ink' : 'bg-bg-2 text-fg-mute')}>
                          open
                        </span>
                      )}
                    </span>
                    <span className={cn('flex min-w-0 items-center gap-1 text-[11px]', isActive ? 'text-acc-ink/80' : 'text-fg-mute')}>
                      {hit.path.map((seg, j) => (
                        <span key={j} className="flex min-w-0 shrink items-center gap-1">
                          {j > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />}
                          <span className="truncate">{seg}</span>
                        </span>
                      ))}
                      {hit.request.url && (
                        <span className="ml-1 min-w-0 flex-1 truncate font-mono opacity-80">{hit.request.url}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
            <span className="flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>↑</Keycap>
              <Keycap>↓</Keycap> navigate
            </span>
            <span className="flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>⏎</Keycap> open
            </span>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>Esc</Keycap> close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
