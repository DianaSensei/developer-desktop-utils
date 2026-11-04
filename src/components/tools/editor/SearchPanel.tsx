// The Search view (⌘⇧F), VS Code's layout: query with Match Case / Whole
// Word / Regex toggles, an optional Replace field, optional files to
// include / exclude, then results grouped by file. Click a line to jump to
// it (Enter also focuses the editor); ↑/↓ walk the results.

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  CaseSensitive, ChevronRight, ListChevronsDownUp, ListChevronsUpDown, MoreHorizontal, RefreshCw, Regex, Replace,
  ReplaceAll, SearchX, WholeWord, X, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SectionLabel } from '@/components/ui/section-label';
import { IS_MAC } from '@/components/ui/keycap';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorStore } from './store';
import type { SearchSession } from './search';
import { fileIcon } from './fileIcons';
import { basename } from './paths';
import { replacedMatch, type FileMatches, type LineMatch } from './textSearch';

interface Props {
  store: EditorStore;
  search: SearchSession;
  folderCount: number;
}

/** Characters shown before a match in a result line. */
const LEAD_CHARS = 14;

const FIELD = cn(
  'h-ctl w-full min-w-0 rounded-sm border border-line bg-card pl-2 text-dense text-fg placeholder:text-fg-mute/75',
  'transition-[border-color,box-shadow] duration-fast ease-out-soft hover:border-line-strong',
  'focus-visible:outline-hidden focus-visible:border-acc/60 focus-visible:ring-[3px] focus-visible:ring-focus',
);

export function SearchPanel({ store, search, folderCount }: Props) {
  const m = useMessages(MESSAGES);
  const snap = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const { options: o, result } = snap;
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!snap.focusTick) return;
    requestAnimationFrame(() => { queryRef.current?.focus(); queryRef.current?.select(); });
  }, [snap.focusTick]);
  // A changed search invalidates a pending "Replace all?".
  useEffect(() => { setConfirming(false); }, [result, snap.replace]);

  const files = result?.files ?? [];
  const showReplace = o.replaceOpen && snap.replace !== '';
  const mod = IS_MAC ? '⌥' : 'Alt+';

  const open = (f: FileMatches, hit: LineMatch, focus: boolean) => {
    setActive(`${f.path}:${hit.line}:${hit.column}`);
    void store.openAt(f.path, hit.line, hit.column, hit.length, focus);
  };

  /** ↑/↓ between rows, ←/→ fold a file, Enter opens. */
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-search-row]') ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i <= 0) { queryRef.current?.focus(); return; }
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    // Moving onto a line previews it, like VS Code's results tree.
    if (next?.dataset.searchRow === 'match') next.click();
  };

  const runReplace = async (paths?: string[]) => {
    setBusy(true);
    setConfirming(false);
    try {
      const s = await search.replace(paths);
      if (s.failed.length) store.notify(m('replaceFailed', { n: s.failed.length, name: basename(s.failed[0]) }));
      else store.notify(m('replacedNotice', { n: s.occurrences, files: s.files }), 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-chrome"
      onKeyDown={(e) => {
        // ⌥C / ⌥W / ⌥R toggle the options while focus is in the view
        // (e.code: ⌥ changes e.key on macOS).
        if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
        const key = ({ KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyR: 'regex' } as const)[e.code as 'KeyC' | 'KeyW' | 'KeyR'];
        if (!key) return;
        e.preventDefault();
        search.setOptions({ [key]: !o[key] });
      }}
    >
      <div className="flex h-ctl shrink-0 items-center gap-0.5 border-b border-line pl-3 pr-1">
        <SectionLabel className="mr-auto">{m('searchTitle')}</SectionLabel>
        <IconButton size="xs" title={m('searchRefresh')} aria-label={m('searchRefresh')} disabled={!snap.query} onClick={() => void search.run()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton size="xs" title={m('searchClear')} aria-label={m('searchClear')} disabled={!snap.query && !result} onClick={() => search.clear()}>
          <SearchX className="h-3.5 w-3.5" />
        </IconButton>
        {files.length > 0 && (Object.keys(snap.collapsed).length >= files.length ? (
          <IconButton size="xs" title={m('expandAll')} aria-label={m('expandAll')} onClick={() => search.setAllCollapsed(false)}>
            <ListChevronsUpDown className="h-3.5 w-3.5" />
          </IconButton>
        ) : (
          <IconButton size="xs" title={m('collapseAll')} aria-label={m('collapseAll')} onClick={() => search.setAllCollapsed(true)}>
            <ListChevronsDownUp className="h-3.5 w-3.5" />
          </IconButton>
        ))}
      </div>

      <div className="flex shrink-0 gap-1 p-2 pb-1">
        <button
          type="button"
          onClick={() => search.setOptions({ replaceOpen: !o.replaceOpen })}
          title={m('toggleReplace')}
          aria-label={m('toggleReplace')}
          aria-expanded={o.replaceOpen}
          className="flex w-4 shrink-0 items-start justify-center rounded-xs pt-1.5 text-fg-mute hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-fast', o.replaceOpen && 'rotate-90')} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative">
            <input
              ref={queryRef}
              value={snap.query}
              onChange={(e) => search.setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void search.run(); }
                else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  listRef.current?.querySelector<HTMLElement>('[data-search-row]')?.focus();
                } else if (e.key === 'Escape' && snap.query) { e.stopPropagation(); search.clear(); }
              }}
              placeholder={m('searchPlaceholder')}
              aria-label={m('searchPlaceholder')}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className={cn(FIELD, 'pr-[4.75rem]', snap.status === 'error' && 'border-bad/70')}
            />
            <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
              <Toggle on={o.caseSensitive} label={`${m('matchCase')} (${mod}C)`} onClick={() => search.setOptions({ caseSensitive: !o.caseSensitive })}>
                <CaseSensitive className="h-3.5 w-3.5" />
              </Toggle>
              <Toggle on={o.wholeWord} label={`${m('wholeWord')} (${mod}W)`} onClick={() => search.setOptions({ wholeWord: !o.wholeWord })}>
                <WholeWord className="h-3.5 w-3.5" />
              </Toggle>
              <Toggle on={o.regex} label={`${m('useRegex')} (${mod}R)`} onClick={() => search.setOptions({ regex: !o.regex })}>
                <Regex className="h-3.5 w-3.5" />
              </Toggle>
            </div>
          </div>
          {o.replaceOpen && (
            <div className="flex items-center gap-1">
              <input
                value={snap.replace}
                onChange={(e) => search.setReplace(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && files.length) { e.preventDefault(); setConfirming(true); } }}
                placeholder={m('replacePlaceholder')}
                aria-label={m('replacePlaceholder')}
                spellCheck={false}
                className={FIELD}
              />
              <IconButton
                size="xs"
                title={m('replaceAll')}
                aria-label={m('replaceAll')}
                disabled={!files.length || busy || snap.status === 'running'}
                onClick={() => setConfirming(true)}
              >
                <ReplaceAll className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1 px-2">
        <button
          type="button"
          onClick={() => search.setOptions({ details: !o.details })}
          aria-expanded={o.details}
          title={m('toggleDetails')}
          className={cn(
            'inline-flex h-5 items-center gap-1 rounded-xs px-1 text-[11px] text-fg-mute hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
            o.details && 'text-acc-ink',
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
          <span>{m('toggleDetails')}</span>
        </button>
      </div>
      {o.details && (
        <div className="flex shrink-0 flex-col gap-1 px-2 pb-1 pl-7">
          <label className="text-[11px] text-fg-mute">
            {m('filesToInclude')}
            <input
              value={o.include}
              onChange={(e) => search.setOptions({ include: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void search.run(); }}
              placeholder={m('includePlaceholder')}
              spellCheck={false}
              className={cn(FIELD, 'mt-0.5')}
            />
          </label>
          <label className="text-[11px] text-fg-mute">
            {m('filesToExclude')}
            <div className="relative mt-0.5">
              <input
                value={o.exclude}
                onChange={(e) => search.setOptions({ exclude: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void search.run(); }}
                placeholder={m('excludePlaceholder')}
                spellCheck={false}
                className={cn(FIELD, 'pr-7')}
              />
              <div className="absolute inset-y-0 right-1 flex items-center">
                <Toggle on={o.useIgnoreFiles} label={m('useIgnoreFiles')} onClick={() => search.setOptions({ useIgnoreFiles: !o.useIgnoreFiles })}>
                  <EyeOff className="h-3.5 w-3.5" />
                </Toggle>
              </div>
            </div>
          </label>
        </div>
      )}

      <StatusLine>
        {snap.status === 'running' && <span className="flex items-center gap-1.5"><Spinner size="xs" />{m('searching')}</span>}
        {snap.status === 'error' && <span className="text-bad">{snap.error}</span>}
        {snap.status !== 'running' && snap.status !== 'error' && folderCount === 0 && <span>{m('searchNoFolder')}</span>}
        {snap.status === 'done' && result && folderCount > 0 && (
          confirming ? (
            <span className="flex flex-wrap items-center gap-1.5 text-fg">
              {m('replaceConfirm', { n: result.matchCount, files: files.length, text: snap.replace })}
              <Button size="sm" variant="destructive" className="h-6 px-2 text-[11px]" onClick={() => void runReplace()} autoFocus>
                {m('replaceAll')}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setConfirming(false)}>{m('cancel')}</Button>
            </span>
          ) : result.matchCount === 0 ? (
            <span>{m('noResults')}</span>
          ) : (
            <span>
              {m('resultsSummary', { n: result.matchCount, files: files.length })}
              {result.truncated && <span className="text-warn"> · {m('resultsTruncated')}</span>}
            </span>
          )
        )}
        {busy && <span className="flex items-center gap-1.5"><Spinner size="xs" />{m('replacing')}</span>}
      </StatusLine>

      <div ref={listRef} role="tree" aria-label={m('searchResults')} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {files.map((f) => {
          const collapsed = !!snap.collapsed[f.path];
          const Icon = fileIcon(f.path);
          const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
          return (
            <div key={f.path} role="none">
              <div
                role="treeitem"
                aria-expanded={!collapsed}
                tabIndex={-1}
                data-search-row="file"
                title={f.path}
                onClick={() => search.toggleCollapsed(f.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); search.toggleCollapsed(f.path); }
                  if (e.key === 'ArrowLeft' && !collapsed) search.toggleCollapsed(f.path);
                  if (e.key === 'ArrowRight' && collapsed) search.toggleCollapsed(f.path);
                }}
                className="group flex h-6 cursor-pointer select-none items-center gap-1 pl-1.5 pr-1 text-dense outline-hidden hover:bg-bg-2/60 focus-visible:bg-acc/10"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-fg-mute transition-transform duration-fast', !collapsed && 'rotate-90')} />
                <Icon className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                <span className="shrink-0 font-medium text-fg">{basename(f.path)}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-mute">{dir}</span>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex group-focus-within:flex">
                  {showReplace && (
                    <RowAction label={m('replaceInFile')} onClick={() => void runReplace([f.path])}>
                      <Replace className="h-3 w-3" />
                    </RowAction>
                  )}
                  <RowAction label={m('dismiss')} onClick={() => search.dismiss(f.path)}>
                    <X className="h-3 w-3" />
                  </RowAction>
                </span>
                <span className="shrink-0 rounded-full bg-bg-2 px-1.5 text-[11px] tabular-nums text-fg-mute">{f.matches.length}</span>
              </div>
              {!collapsed && f.matches.map((hit) => {
                const id = `${f.path}:${hit.line}:${hit.column}`;
                // The side bar is narrow: keep the match in view by showing
                // only the last few characters before it.
                const lead = hit.preview.slice(0, hit.previewColumn);
                const before = lead.length > LEAD_CHARS ? `…${lead.slice(-LEAD_CHARS + 1).trimStart()}` : lead;
                const matched = hit.preview.slice(hit.previewColumn, hit.previewColumn + hit.length);
                const after = hit.preview.slice(hit.previewColumn + hit.length);
                return (
                  <div
                    key={id}
                    role="treeitem"
                    tabIndex={-1}
                    data-search-row="match"
                    aria-selected={active === id}
                    title={`${f.rel}:${hit.line}`}
                    onClick={() => open(f, hit, false)}
                    onDoubleClick={() => open(f, hit, true)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); open(f, hit, true); } }}
                    className={cn(
                      'group flex h-6 cursor-pointer select-none items-center gap-2 pl-9 pr-1 font-mono text-xs outline-hidden hover:bg-bg-2/60 focus-visible:bg-acc/10',
                      active === id && 'bg-acc/15 hover:bg-acc/15',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate whitespace-pre text-fg-mute">
                      {before}
                      {showReplace ? (
                        <>
                          <span className="rounded-xs bg-bad/20 text-fg line-through decoration-bad/70">{matched}</span>
                          <span className="rounded-xs bg-ok/20 text-fg">{replacedMatch(search.query(), matched, snap.replace)}</span>
                        </>
                      ) : (
                        <span className="rounded-xs bg-acc/25 text-fg ring-1 ring-acc/30">{matched}</span>
                      )}
                      {after}
                    </span>
                    <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                      <RowAction label={m('dismiss')} onClick={() => search.dismiss(f.path, hit.line, hit.column)}>
                        <X className="h-3 w-3" />
                      </RowAction>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-fg-mute/70">{hit.line}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return <div className="flex min-h-6 shrink-0 items-center gap-2 px-3 py-1 text-[11px] text-fg-mute" aria-live="polite">{children}</div>;
}

function Toggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded-xs transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        on ? 'bg-acc/20 text-acc-ink ring-1 ring-inset ring-acc/50' : 'text-fg-mute hover:bg-bg-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex h-5 w-5 items-center justify-center rounded-xs text-fg-mute hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
    >
      {children}
    </button>
  );
}
