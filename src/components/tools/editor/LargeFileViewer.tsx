// Read-only viewer for files too large to edit (and for following logs).
// Nothing holds the file: the backend indexes line offsets in the background
// (editor_view.rs) and this component asks for the ~50 lines on screen, in
// blocks of 256, cached LRU. Scrolling is virtual; past a few million pixels
// the scrollbar maps proportionally onto line numbers, so a 100-million-line
// log scrolls like any other. Search, go-to-line and tail -f run on the
// backend over the whole file.
//
// The scroll position is a fractional line number (`first`). Where the
// browser's own scrolling can't move by pixels — the scrollbar is scaled, or
// lines wrap to different heights — the wheel and the arrow/page keys are
// handled here instead: a pixel delta walks through the lines' measured
// heights, so a wheel notch moves ~3 rows whatever the file size, and a
// wrapped line taller than the screen can be read to its end.
//
// Word wrap (Alt+Z / status bar) works here too; the bottom of the scroll
// range then puts the last line at the top, like VS Code's
// scrollBeyondLastLine. While following, the view is pinned to the bottom
// instead, so the newest (possibly wrapped) lines are always whole.
//
// Lines are cut at 8 KB (VIEW_LINE_BYTES); "show full line" fetches up to
// 4 MB of one line, and a search hit past the cut does so on its own.
//
// Font, size, line height, spacing and weight follow the editor's
// Appearance settings (status bar "Aa", ⌘= / ⌘−).

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CaseSensitive, ChevronLeft, ChevronRight, FilePen, Regex, ScrollText, Search } from 'lucide-react';
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
import { fontFamilyFor, type EditorAppearance } from './appearance';

/** Row height for an appearance: font size × line height, whole pixels. */
export function viewerLineHeight(a: Pick<EditorAppearance, 'fontSize' | 'lineHeight'>): number {
  return Math.max(12, Math.round(a.fontSize * a.lineHeight));
}

const hitMark = (h: SearchHit) => ({ line: h.line, column: h.lineColumn, length: h.length });
const BLOCK = 256;
const MAX_BLOCKS = 300;
/** Above this the scrollbar maps proportionally (browsers cap element height). */
const MAX_SPACER = 8_000_000;
/** Whole lines kept after "show full line" (each can be up to 4 MB). */
const MAX_EXPANDED = 16;
/** Measured row heights kept for wheel/keyboard scrolling. */
const MAX_HEIGHTS = 4096;

type Mark = { line: number; column?: number; length?: number };

interface Props {
  store: EditorStore;
  tab: Tab;
  /** Word wrap — the editor's setting, shared with the viewer. */
  wrap: boolean;
  appearance: EditorAppearance;
}

export function LargeFileViewer({ store, tab, wrap, appearance }: Props) {
  const m = useMessages(MESSAGES);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<number | null>(null);
  const [status, setStatus] = useState<ViewStatus | null>(null);
  const statusRef = useRef<ViewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewH, setViewH] = useState(400);
  const [viewW, setViewW] = useState(0);
  const [first, setFirstState] = useState(0); // fractional first visible line
  const firstRef = useRef(0);
  const [follow, setFollow] = useState(false);
  const [mark, setMark] = useState<Mark | null>(null);
  const cache = useRef(new Map<number, ViewLine[]>());
  const pending = useRef(new Set<number>());
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlyMap<number, ViewLine>>(() => new Map());
  const expanding = useRef(new Set<number>());
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const lineH = viewerLineHeight(appearance);
  const setFirst = useCallback((f: number) => { firstRef.current = f; setFirstState(f); }, []);

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
      setExpanded(new Map());
    } else if (prev && st.lines !== prev.lines && prev.lines > 0) {
      // The old last line may have been partial and has grown since.
      const last = prev.lines - 1;
      cache.current.delete(Math.floor(last / BLOCK));
      setExpanded((cur) => {
        if (!cur.has(last)) return cur;
        const next = new Map(cur);
        next.delete(last);
        return next;
      });
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
    const measure = () => { setViewH(el.clientHeight || 400); setViewW(el.clientWidth); };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // ── virtual scroll geometry ────────────────────────────────────────────
  const total = status?.lines ?? 0;
  const visible = Math.ceil(viewH / lineH) + 1;
  // Wrapped lines have no fixed height, so the end of the scroll range can't
  // be "the last screenful": it puts the last line at the top instead.
  const fullH = wrap ? Math.max(0, total - 1) * lineH + viewH : total * lineH;
  const scaled = fullH > MAX_SPACER;
  const spacerH = Math.max(viewH, Math.min(fullH, MAX_SPACER));
  const maxFirst = wrap ? Math.max(0, total - 1) : Math.max(0, total - visible + 1);
  const clampedFirst = Math.min(first, maxFirst);
  const topLine = Math.min(Math.floor(clampedFirst), Math.max(0, total - 1));
  // Following with wrap on: show the last lines bottom-aligned (a wrapped
  // tail can't be reached by scrolling to a line number).
  const pinBottom = wrap && follow;
  const startLine = pinBottom ? Math.max(0, total - visible) : topLine;
  /** The browser can't scroll by pixels here: wheel and keys are ours. */
  const ownScroll = scaled || wrap;

  // Measured row heights (wrap), dropped when anything that changes them does.
  const heights = useRef(new Map<number, number>());
  const heightsKey = `${wrap}|${lineH}|${viewW}|${appearance.font}|${appearance.fontSize}|${appearance.letterSpacing}|${appearance.weight}`;
  const heightsKeyRef = useRef(heightsKey);
  if (heightsKeyRef.current !== heightsKey) {
    heightsKeyRef.current = heightsKey;
    heights.current.clear();
  }
  const heightOf = useCallback((n: number) => (wrap && heights.current.get(n)) || lineH, [wrap, lineH]);

  /** The scrollTop we set ourselves; its scroll event must not overwrite
   *  the exact (fractional) `first` with a rounded one. */
  const expectedTop = useRef<number | null>(null);

  const lineFromScroll = (scrollTop: number) => (scaled
    ? (scrollTop / Math.max(1, spacerH - viewH)) * maxFirst
    : scrollTop / lineH);

  const scrollToLine = useCallback((line: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(line, maxFirst));
    el.scrollTop = scaled ? (target / Math.max(1, maxFirst)) * (spacerH - viewH) : target * lineH;
    expectedTop.current = el.scrollTop;
    setFirst(target);
  }, [maxFirst, scaled, spacerH, viewH, lineH, setFirst]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    if (expectedTop.current !== null && Math.abs(el.scrollTop - expectedTop.current) < 1) return;
    expectedTop.current = null;
    setFirst(lineFromScroll(el.scrollTop));
  };

  /** Moves the view by `px` pixels of content, through the rows' real heights. */
  const scrollByPx = (px: number) => {
    if (px < 0 && follow) {
      setFollow(false);
      // Leaving the bottom-pinned tail: start from the last screenful.
      if (pinBottom) { scrollToLine(Math.max(0, total - visible)); return; }
    }
    let f = Math.min(firstRef.current, maxFirst);
    if (!wrap) {
      scrollToLine(f + px / lineH);
      return;
    }
    while (px > 0 && f < maxFirst) {
      const line = Math.floor(f);
      const h = heightOf(line);
      const rest = (1 - (f - line)) * h;
      if (px < rest) { f += px / h; px = 0; } else { f = line + 1; px -= rest; }
    }
    while (px < 0 && f > 0) {
      let line = Math.floor(f);
      let frac = f - line;
      if (frac === 0) { line -= 1; frac = 1; }
      const h = heightOf(line);
      const within = frac * h;
      if (-px <= within) { f = line + (within + px) / h; px = 0; } else { f = line; px += within; }
    }
    // Float drift (3.9999999 for 4) would leave the previous line on top.
    if (Math.abs(f - Math.round(f)) < 1e-6) f = Math.round(f);
    scrollToLine(f);
  };
  const scrollByRef = useRef(scrollByPx);
  scrollByRef.current = scrollByPx;

  // Wheel: native listener, since React's is passive and can't preventDefault.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !ownScroll) return;
    const onWheel = (e: WheelEvent) => {
      // Pinch-zoom and horizontal scrolling stay the browser's.
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? lineH : e.deltaMode === 2 ? viewH : 1;
      scrollByRef.current(e.deltaY * unit);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ownScroll, lineH, viewH]);

  const onScrollerKeyDown = (e: React.KeyboardEvent) => {
    if (!ownScroll || e.target !== e.currentTarget || e.altKey || e.metaKey) return;
    const page = Math.max(lineH, viewH - lineH);
    const by: Record<string, number> = { ArrowDown: lineH, ArrowUp: -lineH, PageDown: page, PageUp: -page };
    if (e.key in by) {
      e.preventDefault();
      scrollByPx(by[e.key]);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (e.key === 'Home') setFollow(false);
      scrollToLine(e.key === 'Home' ? 0 : wrap ? Math.max(0, total - visible) : maxFirst);
    }
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
    const firstBlock = Math.floor(startLine / BLOCK);
    const lastBlock = Math.floor(Math.min(total - 1, startLine + visible) / BLOCK);
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
  }, [handle, total, startLine, visible, tick, store]);

  // ── whole lines ("show full line") ─────────────────────────────────────
  const expandLine = useCallback((n: number) => {
    if (handle === null || expanding.current.has(n)) return;
    expanding.current.add(n);
    store.fs.viewer.line(handle, n).then((line) => {
      expanding.current.delete(n);
      if (!line) return;
      setExpanded((cur) => {
        const next = new Map(cur);
        next.set(n, line);
        while (next.size > MAX_EXPANDED) next.delete(next.keys().next().value!);
        return next;
      });
    }, (e) => {
      expanding.current.delete(n);
      setError(toFsError(e).message);
    });
  }, [handle, store]);

  const collapseLine = (n: number) => setExpanded((cur) => {
    const next = new Map(cur);
    next.delete(n);
    return next;
  });

  const lineAt = (n: number): ViewLine | undefined => expanded.get(n) ?? cache.current.get(Math.floor(n / BLOCK))?.[n % BLOCK];

  // A search hit past the cut: fetch the whole line so it can be shown.
  const markLine = mark ? lineAt(mark.line) : undefined;
  useEffect(() => {
    if (!mark || mark.column === undefined || !markLine?.truncated || expanded.has(mark.line)) return;
    if (mark.column + (mark.length ?? 0) > markLine.text.length) expandLine(mark.line);
  }, [mark, markLine, expanded, expandLine]);

  const gutterCh = Math.max(4, String(total).length + 1);

  // Row heights, measured after each render. With wrap the top line can be
  // many rows tall: the fraction of `first` scrolls through it by its real
  // height, so a long line can be read past its first screenful.
  const usedTopH = useRef(lineH);
  useLayoutEffect(() => {
    const box = linesRef.current;
    if (!box || !wrap) return;
    if (heights.current.size > MAX_HEIGHTS) heights.current.clear();
    for (const child of Array.from(box.children) as HTMLElement[]) {
      const h = child.offsetHeight;
      if (h) heights.current.set(Number(child.dataset.line), h);
    }
    if (!pinBottom && heightOf(topLine) !== usedTopH.current) forceRender();
  });
  const topH = heightOf(topLine);
  usedTopH.current = topH;
  const frac = clampedFirst - topLine;
  const offsetPx = pinBottom ? 0 : wrap ? frac * topH : scaled ? 0 : frac * lineH;

  // Bring a jumped-to hit into view: sideways without wrap; with wrap, down
  // to it when it sits deep inside a tall line.
  const revealed = useRef<Mark | null>(null);
  useLayoutEffect(() => {
    if (!mark || mark.column === undefined || revealed.current === mark) return;
    const el = scrollerRef.current;
    const markEl = linesRef.current?.querySelector<HTMLElement>(`[data-line="${mark.line}"] mark`);
    if (!el || !markEl) return;
    revealed.current = mark;
    if (!wrap) {
      el.scrollLeft = Math.max(0, markEl.offsetLeft - el.clientWidth / 3);
      return;
    }
    const row = markEl.closest<HTMLElement>('[data-line]');
    if (!row || mark.line !== topLine) return;
    const depth = markEl.offsetTop - row.offsetTop;
    if (depth > viewH / 2) scrollToLine(mark.line + (depth - viewH / 3) / Math.max(1, row.offsetHeight));
  });

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

  const jumpTo = (hit: Mark) => {
    setFollow(false);
    setMark(hit);
    // Wrapped lines above could push the hit off screen: put it on top.
    scrollToLine(wrap ? hit.line : hit.line - Math.floor(visible / 3));
  };

  const onFollowChange = (on: boolean) => {
    setFollow(on);
    // Unpinning the wrapped tail: stay on the last screenful, not the last line.
    if (!on && wrap) scrollToLine(Math.max(0, total - visible));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); gotoRef.current?.focus(); }
  };

  const indexingPct = status && !status.done && status.size > 0 ? Math.floor((status.scanned / status.size) * 100) : null;
  const rows = useMemo(() => Array.from({ length: Math.min(visible, Math.max(0, total - startLine)) }, (_, i) => startLine + i), [visible, total, startLine]);

  const textStyle: React.CSSProperties = {
    fontFamily: fontFamilyFor(appearance.font),
    fontSize: appearance.fontSize,
    letterSpacing: `${appearance.letterSpacing}px`,
    fontWeight: appearance.weight,
    fontVariantLigatures: appearance.font === 'jetbrains-mono' ? 'none' : undefined,
    WebkitFontSmoothing: appearance.smoothing === 'thin' ? 'antialiased' : 'auto',
    MozOsxFontSmoothing: appearance.smoothing === 'thin' ? 'grayscale' : 'auto',
  };

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
        <ToggleChip pressed={follow} onPressedChange={onFollowChange} title={m('followHint')} className="gap-1.5">
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
        onKeyDown={onScrollerKeyDown}
        onWheel={(e) => { if (follow && e.deltaY < 0 && !ownScroll) setFollow(false); }}
        className={cn('relative min-h-0 flex-1 bg-bg', wrap ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto')}
        style={textStyle}
        tabIndex={0}
        role="region"
        aria-label={tab.name}
      >
        <div style={{ height: spacerH }}>
          <div className={cn('sticky top-0 overflow-hidden', wrap ? 'w-full' : 'w-max min-w-full')} style={{ height: viewH }}>
            <div
              ref={linesRef}
              data-testid="viewer-lines"
              className={cn(pinBottom && 'absolute inset-x-0 bottom-0')}
              style={{ transform: `translateY(${-offsetPx}px)` }}
            >
              {rows.map((n) => {
                const line = lineAt(n);
                const marked = mark?.line === n;
                const whole = expanded.has(n);
                return (
                  <div
                    key={n}
                    data-line={n}
                    className={cn('flex', marked && 'bg-acc/10')}
                    style={wrap ? { minHeight: lineH, lineHeight: `${lineH}px` } : { height: lineH, lineHeight: `${lineH}px` }}
                  >
                    <span
                      className="sticky left-0 shrink-0 select-none bg-bg pr-3 text-right tabular-nums text-fg-mute"
                      style={{ width: `${gutterCh + 1}ch` }}
                    >
                      {n + 1}
                    </span>
                    <span className={cn('pr-6 text-fg', wrap ? 'min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>
                      {line === undefined ? '' : marked && mark?.length !== undefined && mark.column !== undefined
                        ? (
                          <>
                            {line.text.slice(0, mark.column)}
                            <mark className="rounded-xs bg-warn/30 text-fg">{line.text.slice(mark.column, mark.column + mark.length)}</mark>
                            {line.text.slice(mark.column + mark.length)}
                          </>
                        )
                        : line.text}
                      {line?.truncated && !whole && (
                        <button
                          type="button"
                          onClick={() => expandLine(n)}
                          className="ml-2 rounded-xs px-1 text-fg-mute hover:bg-bg-2 hover:text-fg"
                          title={m('showFullLine')}
                          aria-label={m('showFullLine')}
                        >
                          <ChevronRight className="inline h-3 w-3" />…
                        </button>
                      )}
                      {line?.truncated && whole && (
                        <span className="ml-2 text-fg-mute" title={m('lineTooLong')}>…</span>
                      )}
                      {whole && (
                        <button
                          type="button"
                          onClick={() => collapseLine(n)}
                          className="ml-2 rounded-xs px-1 text-fg-mute hover:bg-bg-2 hover:text-fg"
                          title={m('collapseLine')}
                          aria-label={m('collapseLine')}
                        >
                          <ChevronLeft className="inline h-3 w-3" />
                        </button>
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
