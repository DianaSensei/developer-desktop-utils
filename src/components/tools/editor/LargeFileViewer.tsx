// Read-only viewer for files too large to edit (and for following logs).
// Nothing holds the file: the backend indexes line offsets in the background
// (editor_view.rs) and this component asks for the ~50 lines on screen, in
// blocks of 256, cached LRU. Scrolling is virtual; past a few million pixels
// the scrollbar maps proportionally onto line numbers, so a 100-million-line
// log scrolls like any other. Search, go-to-line and tail -f run on the
// backend over the whole file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, ChevronRight, FilePen, Regex, ScrollText, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorStore, Tab } from './store';
import { toFsError, type SearchHit, type ViewLine, type ViewStatus } from './fs';
import { formatSize } from './Timeline';

export const LINE_H = 20;

const hitMark = (h: SearchHit) => ({ line: h.line, column: h.lineColumn, length: h.length });
const BLOCK = 256;
const MAX_BLOCKS = 300;
/** Above this the scrollbar maps proportionally (browsers cap element height). */
const MAX_SPACER = 8_000_000;

interface Props {
  store: EditorStore;
  tab: Tab;
}

export function LargeFileViewer({ store, tab }: Props) {
  const m = useMessages(MESSAGES);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<number | null>(null);
  const [status, setStatus] = useState<ViewStatus | null>(null);
  const statusRef = useRef<ViewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewH, setViewH] = useState(400);
  const [first, setFirst] = useState(0); // fractional first visible line
  const [follow, setFollow] = useState(false);
  const [mark, setMark] = useState<{ line: number; column?: number; length?: number } | null>(null);
  const cache = useRef(new Map<number, ViewLine[]>());
  const pending = useRef(new Set<number>());
  const [tick, setTick] = useState(0);

  // ── open + status polling ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    store.viewerHandle(tab.id).then(
      (h) => { if (!cancelled) setHandle(h); },
      (e) => { if (!cancelled) setError(toFsError(e).message); },
    );
    return () => { cancelled = true; };
  }, [store, tab.id]);

  const applyStatus = useCallback((st: ViewStatus) => {
    const prev = statusRef.current;
    if (prev && st.generation !== prev.generation) {
      cache.current.clear();
    } else if (prev && st.lines !== prev.lines && prev.lines > 0) {
      // The old last line may have been partial and has grown since.
      cache.current.delete(Math.floor((prev.lines - 1) / BLOCK));
    }
    statusRef.current = st;
    setStatus(st);
  }, []);

  useEffect(() => {
    if (handle === null) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let st: ViewStatus | null = null;
      try {
        // A refresh scans appended bytes; only once the first pass is done.
        st = follow && statusRef.current?.done
          ? await store.fs.viewer.refresh(handle)
          : await store.fs.viewer.status(handle);
        if (!stop) applyStatus(st);
      } catch (e) {
        if (!stop) setError(toFsError(e).message);
      }
      if (!stop && st && (!st.done || follow)) timer = setTimeout(() => void tick(), st.done ? 1000 : 250);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [handle, follow, store, applyStatus]);

  // Coming back to the window: pick up whatever was appended meanwhile.
  useEffect(() => {
    if (handle === null) return;
    const onFocus = () => {
      if (statusRef.current?.done) void store.fs.viewer.refresh(handle).then(applyStatus, () => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [handle, store, applyStatus]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight || 400));
    ro.observe(el);
    setViewH(el.clientHeight || 400);
    return () => ro.disconnect();
  }, []);

  // ── virtual scroll geometry ────────────────────────────────────────────
  const total = status?.lines ?? 0;
  const visible = Math.ceil(viewH / LINE_H) + 1;
  const fullH = total * LINE_H;
  const scaled = fullH > MAX_SPACER;
  const spacerH = Math.max(viewH, Math.min(fullH, MAX_SPACER));
  const maxFirst = Math.max(0, total - visible + 1);
  const topLine = Math.min(Math.floor(first), Math.max(0, total - 1));

  const lineFromScroll = (scrollTop: number) => (scaled
    ? (scrollTop / Math.max(1, spacerH - viewH)) * maxFirst
    : scrollTop / LINE_H);

  const scrollToLine = useCallback((line: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(line, maxFirst));
    el.scrollTop = scaled ? (target / Math.max(1, maxFirst)) * (spacerH - viewH) : target * LINE_H;
    setFirst(target);
  }, [maxFirst, scaled, spacerH, viewH]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) setFirst(lineFromScroll(el.scrollTop));
  };

  // Restore the place once the line count is known; remember it after.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !status) return;
    restored.current = true;
    const saved = store.viewerTopLine.get(tab.id);
    if (saved) requestAnimationFrame(() => scrollToLine(saved));
  }, [status, store, tab.id, scrollToLine]);
  useEffect(() => { store.viewerTopLine.set(tab.id, topLine); }, [store, tab.id, topLine]);

  // tail -f: stay at the end as lines arrive.
  useEffect(() => {
    if (follow && total > 0) scrollToLine(maxFirst);
  }, [follow, total, maxFirst, scrollToLine]);

  // ── fetch the blocks on screen ─────────────────────────────────────────
  useEffect(() => {
    if (handle === null || total === 0) return;
    const firstBlock = Math.floor(topLine / BLOCK);
    const lastBlock = Math.floor(Math.min(total - 1, topLine + visible) / BLOCK);
    for (let b = firstBlock; b <= lastBlock + 1; b++) {
      if (b * BLOCK >= total || cache.current.has(b) || pending.current.has(b)) continue;
      pending.current.add(b);
      store.fs.viewer.lines(handle, b * BLOCK, BLOCK).then((lines) => {
        pending.current.delete(b);
        cache.current.set(b, lines);
        while (cache.current.size > MAX_BLOCKS) cache.current.delete(cache.current.keys().next().value!);
        setTick((t) => t + 1);
      }, (e) => {
        pending.current.delete(b);
        setError(toFsError(e).message);
      });
    }
  }, [handle, total, topLine, visible, tick, store]);

  const lineAt = (n: number): ViewLine | undefined => cache.current.get(Math.floor(n / BLOCK))?.[n % BLOCK];
  const gutterCh = Math.max(4, String(total).length + 1);
  const offsetPx = scaled ? 0 : (first - topLine) * LINE_H;

  // ── search ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [nextLine, setNextLine] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gotoRef = useRef<HTMLInputElement>(null);

  const runSearch = async (from: number, append: boolean) => {
    if (handle === null || !query) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await store.fs.viewer.search(handle, { query, regex, caseSensitive: matchCase, fromLine: from, maxHits: 200 });
      setHits((prev) => (append && prev ? [...prev, ...r.hits] : r.hits));
      setNextLine(r.nextLine);
      if (!append && r.hits[0]) jumpTo(hitMark(r.hits[0]));
    } catch (e) {
      const err = toFsError(e);
      setSearchError(err.code === 'invalid_regex' ? m('err.invalid_regex') : err.message);
    } finally {
      setSearching(false);
    }
  };

  const jumpTo = (hit: { line: number; column?: number; length?: number }) => {
    setFollow(false);
    setMark(hit);
    scrollToLine(hit.line - Math.floor(visible / 3));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); gotoRef.current?.focus(); }
  };

  const indexingPct = status && !status.done && status.size > 0 ? Math.floor((status.scanned / status.size) * 100) : null;
  const rows = useMemo(() => Array.from({ length: Math.min(visible, Math.max(0, total - topLine)) }, (_, i) => topLine + i), [visible, total, topLine]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-chrome px-2 py-1.5 text-xs">
        <Badge tone="info" uppercase title={m('viewerHint')}>{m('viewerReadOnly')}</Badge>
        <span className="tabular-nums text-fg-mute">
          {status ? formatSize(status.size) : ''}
          {status && ` · ${m('viewerLines', { n: status.lines.toLocaleString() })}`}
        </span>
        {indexingPct !== null && (
          <span className="flex items-center gap-1 text-fg-mute"><Spinner size="xs" />{m('viewerIndexing', { pct: indexingPct })}</span>
        )}
        <span className="flex-1" />
        <form
          className="flex items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number.parseInt(gotoRef.current?.value ?? '', 10);
            if (Number.isFinite(n) && n > 0) jumpTo({ line: Math.min(n, total) - 1 });
          }}
        >
          <Input ref={gotoRef} inputMode="numeric" placeholder={m('goToLinePlaceholder')} aria-label={m('goToLine')} className="w-28 text-xs" />
        </form>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => { e.preventDefault(); void runSearch(0, false); }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-mute" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m('findPlaceholder')}
              aria-label={m('find')}
              className="w-48 pl-8 text-xs"
            />
          </div>
          <IconButton active={matchCase} aria-pressed={matchCase} title={m('matchCase')} aria-label={m('matchCase')} onClick={() => setMatchCase((v) => !v)}>
            <CaseSensitive className="h-4 w-4" />
          </IconButton>
          <IconButton active={regex} aria-pressed={regex} title={m('useRegex')} aria-label={m('useRegex')} onClick={() => setRegex((v) => !v)}>
            <Regex className="h-4 w-4" />
          </IconButton>
          <Button type="submit" size="sm" variant="outline" disabled={!query || handle === null || searching}>
            {searching ? <Spinner size="xs" /> : m('find')}
          </Button>
        </form>
        <ToggleChip pressed={follow} onPressedChange={setFollow} title={m('followHint')} className="gap-1.5">
          <ScrollText className="h-3.5 w-3.5" />{m('follow')}
        </ToggleChip>
        {status && status.size <= store.limits.maxEdit && (
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void store.openInEditor(tab.id)}>
            <FilePen className="h-3.5 w-3.5" />{m('openInEditor')}
          </Button>
        )}
      </div>

      {status?.binary && <Callout tone="warning" size="sm" className="m-2 mb-0">{m('viewerBinary')}</Callout>}
      {error && <Callout tone="error" size="sm" className="m-2 mb-0">{error}</Callout>}

      {(hits !== null || searchError) && (
        <div className="max-h-[35%] shrink-0 overflow-y-auto border-b border-line bg-bg px-1 py-1 text-xs">
          {searchError && <p className="px-2 py-1 text-bad">{searchError}</p>}
          {hits !== null && (
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-fg-mute">
              <span>{hits.length === 0 ? m('noHits') : m('hitsCount', { n: hits.length })}</span>
              {nextLine !== null && (
                <>
                  <span>· {m('searchedTo', { line: nextLine.toLocaleString() })}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void runSearch(nextLine, true)} disabled={searching}>
                    {m('moreHits')}
                  </Button>
                </>
              )}
            </div>
          )}
          {hits?.map((h) => (
            <button
              key={`${h.line}:${h.column}`}
              type="button"
              onClick={() => jumpTo(hitMark(h))}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-xs px-2 py-0.5 text-left font-mono hover:bg-bg-2/60',
                mark?.line === h.line && 'bg-acc/10',
              )}
            >
              <span className="w-16 shrink-0 text-right tabular-nums text-fg-mute">{(h.line + 1).toLocaleString()}</span>
              <span className="min-w-0 truncate whitespace-pre">
                {h.preview.slice(0, h.column)}
                <mark className="rounded-xs bg-warn/30 text-fg">{h.preview.slice(h.column, h.column + h.length)}</mark>
                {h.preview.slice(h.column + h.length)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        onWheel={(e) => { if (follow && e.deltaY < 0) setFollow(false); }}
        className="relative min-h-0 flex-1 overflow-auto bg-bg font-mono text-dense"
        tabIndex={0}
        role="region"
        aria-label={tab.name}
      >
        <div style={{ height: spacerH }}>
          <div className="sticky top-0 w-max min-w-full overflow-hidden" style={{ height: viewH }}>
            <div style={{ transform: `translateY(${-offsetPx}px)` }}>
              {rows.map((n) => {
                const line = lineAt(n);
                const marked = mark?.line === n;
                return (
                  <div key={n} className={cn('flex', marked && 'bg-acc/10')} style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>
                    <span
                      className="sticky left-0 shrink-0 select-none bg-bg pr-3 text-right tabular-nums text-fg-mute"
                      style={{ width: `${gutterCh + 1}ch` }}
                    >
                      {n + 1}
                    </span>
                    <span className="whitespace-pre pr-6 text-fg">
                      {line === undefined ? '' : marked && mark?.length !== undefined && mark.column !== undefined
                        ? (
                          <>
                            {line.text.slice(0, mark.column)}
                            <mark className="rounded-xs bg-warn/30 text-fg">{line.text.slice(mark.column, mark.column + mark.length)}</mark>
                            {line.text.slice(mark.column + mark.length)}
                          </>
                        )
                        : line.text}
                      {line?.truncated && (
                        <span className="ml-2 text-fg-mute" title={m('lineTruncated')}>
                          <ChevronRight className="inline h-3 w-3" />…
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
