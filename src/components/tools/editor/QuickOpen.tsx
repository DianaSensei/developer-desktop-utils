// ⌘P "Go to File" across every open folder. Same palette chrome as the API
// Client's request palette (RequestQuickOpen.tsx) so the two feel like one
// mechanism; ranking lives in fileRanking.ts. The file list is walked once and
// cached by the store until something in the tree changes.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Keycap } from '@/components/ui/keycap';
import { LoadingRow } from '@/components/ui/spinner';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorStore } from './store';
import type { WalkEntry } from './fs';
import { fileIcon } from './fileIcons';
import { basename } from './paths';
import { rankFiles } from './fileRanking';

type Row = WalkEntry & { root: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: EditorStore;
  folderCount: number;
  openPaths: string[];
}

export function QuickOpen({ open, onOpenChange, store, folderCount, openPaths }: Props) {
  const m = useMessages(MESSAGES);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [files, setFiles] = useState<Row[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setFiles(null);
    let cancelled = false;
    void store.allFiles().then((r) => {
      if (cancelled) return;
      setFiles(r.files);
      setTruncated(r.truncated);
    });
    return () => { cancelled = true; };
  }, [open, store]);

  // With several folders open, show which one a file belongs to.
  const multiRoot = folderCount > 1;
  const openSet = useMemo(() => new Set(openPaths), [openPaths]);
  const hits = useMemo(() => {
    if (!files) return [];
    // Empty query: open files first, then the rest in path order.
    if (!query.trim()) {
      const opened = files.filter((f) => openSet.has(f.path));
      const rest = files.filter((f) => !openSet.has(f.path));
      return [...opened, ...rest].slice(0, 50);
    }
    return rankFiles(files, query);
  }, [files, query, openSet]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const pick = (row: Row) => {
    onOpenChange(false);
    void store.openFile(row.path).then(() => store.focusEditor());
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
      const row = hits[selected];
      if (row) pick(row);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs duration-fast ease-out-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className={cn(
            'fixed left-1/2 top-[14%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden',
            'rounded-lg border border-line glass-strong glass-sheen shadow-lift duration-base ease-out-soft',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{m('quickOpenTitle')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{m('quickOpenPlaceholder')}</DialogPrimitive.Description>

          <div className="flex items-center gap-2 border-b border-line px-3.5">
            <Search className="h-4 w-4 shrink-0 text-fg-mute/60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={onKeyDown}
              placeholder={m('quickOpenPlaceholder')}
              aria-label={m('quickOpenTitle')}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="h-ctl-lg w-full bg-transparent text-sm text-fg outline-hidden placeholder:text-fg-mute/60"
            />
          </div>

          <div className="max-h-[380px] overflow-y-auto p-1.5" role="listbox" aria-label={m('quickOpenTitle')}>
            {folderCount === 0 && (
              <p className="px-2.5 py-8 text-center text-dense text-fg-mute">{m('quickOpenNoFolder')}</p>
            )}
            {folderCount > 0 && files === null && <LoadingRow size="sm" label={m('quickOpenIndexing')} className="justify-center py-6" />}
            {files !== null && hits.length === 0 && folderCount > 0 && (
              <p className="px-2.5 py-8 text-center text-dense text-fg-mute">{m('quickOpenEmpty')}</p>
            )}
            {hits.map((row, i) => {
              const active = i === selected;
              const Icon = fileIcon(row.path);
              const folder = row.rel.includes('/') ? row.rel.slice(0, row.rel.lastIndexOf('/')) : '';
              return (
                <button
                  key={row.path}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => pick(row)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                    active ? 'bg-acc-tint text-acc-ink' : 'text-fg hover:bg-bg-2/60',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  <span className="shrink-0 font-medium">{basename(row.rel)}</span>
                  <span className={cn('min-w-0 truncate text-[11px]', active ? 'text-acc-ink/80' : 'text-fg-mute')}>
                    {multiRoot ? [basename(row.root), folder].filter(Boolean).join('/') : folder}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
            <span className="flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>↑</Keycap><Keycap>↓</Keycap>
            </span>
            <span className="flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>⏎</Keycap> {m('open')}
            </span>
            {truncated && <span className="min-w-0 truncate text-[11px] text-warn">{m('quickOpenTruncated')}</span>}
            <span className="ml-auto flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>Esc</Keycap>
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
