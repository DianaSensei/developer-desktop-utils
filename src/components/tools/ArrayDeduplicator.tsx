import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCheck, ChevronsDown, ChevronsUp, Copy, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { copyToClipboard } from '@/lib/clipboard';

type DedupeMode = 'preserve' | 'sort';

interface DedupeResult {
  output: string;
  original: number;
  unique: number;
  removed: number;
}

// Must match inline styles on both <textarea> elements.
const LINE_H = 21; // px — lineHeight
const AREA_PT = 8; // px — paddingTop

// Virtualized line-number gutter — pure DOM updates during scroll, no React re-renders.
function LineNumbers({
  textareaRef,
  lineCount,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lineCount: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const digits = String(Math.max(lineCount, 1)).length;
  const width = Math.max(digits * 9 + 24, 40);

  useEffect(() => {
    const ta = textareaRef.current;
    const container = containerRef.current;
    if (!ta || !container) return;

    const inner = document.createElement('div');
    container.appendChild(inner);

    const update = () => {
      const scrollTop = ta.scrollTop;
      const height = ta.clientHeight;
      const startLine = Math.max(0, Math.floor((scrollTop - AREA_PT) / LINE_H));
      const endLine = Math.min(lineCount, startLine + Math.ceil(height / LINE_H) + 2);
      const count = Math.max(0, endLine - startLine);

      inner.style.transform = `translateY(${AREA_PT + startLine * LINE_H - scrollTop}px)`;

      while (inner.children.length < count) {
        const d = document.createElement('div');
        d.style.height = `${LINE_H}px`;
        d.style.lineHeight = `${LINE_H}px`;
        d.style.textAlign = 'right';
        d.style.paddingRight = '10px';
        inner.appendChild(d);
      }
      while (inner.children.length > count) inner.removeChild(inner.lastChild!);
      for (let i = 0; i < count; i++) {
        (inner.children[i] as HTMLElement).textContent = String(startLine + i + 1);
      }
    };

    update();
    ta.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(ta);

    return () => {
      ta.removeEventListener('scroll', update);
      ro.disconnect();
      if (container.contains(inner)) container.removeChild(inner);
    };
  }, [textareaRef, lineCount]);

  return (
    <div
      ref={containerRef}
      className="shrink-0 overflow-hidden select-none font-mono text-xs text-muted-foreground bg-muted/40 border-r border-border"
      style={{ width }}
    />
  );
}

function Stat({ value, label, color }: { value: number | null; label: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={cn('text-base font-bold tabular-nums leading-none', color ?? 'text-foreground')}>
        {value === null ? '—' : value.toLocaleString()}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

const AREA_CLASS =
  'flex-1 min-w-0 h-full resize-none outline-none bg-transparent text-foreground text-sm font-mono px-2.5 pb-2 placeholder:text-muted-foreground/60';
const AREA_STYLE = { lineHeight: `${LINE_H}px`, paddingTop: `${AREA_PT}px` } as const;

export function ArrayDeduplicator() {
  const { config } = useAppConfig();
  const [mode, setMode] = usePersistentState<DedupeMode>('devtool:deduplicate:mode', 'preserve');
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const currentValueRef = useRef('');

  const [inputLineCount, setInputLineCount] = useState(0);
  const [hasInput, setHasInput] = useState(false);
  const [result, setResult] = useState<DedupeResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (outputRef.current) outputRef.current.value = result?.output ?? '';
  }, [result]);

  const workerRef = useRef<Worker | null>(null);
  const workerTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const histTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lineCountTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const historyRef = useRef<string[]>(['']);
  const histIdxRef = useRef(0);
  const isApplyingRef = useRef(false);

  // ── Sync-scroll state (preserve mode) ──────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const syncRatioRef = useRef(0);   // 0–1 scroll position ratio
  const isSyncingRef = useRef(false); // prevents cascading scroll events

  // Recomputes thumb height/position from current textarea scroll state.
  const updateScrollbar = useCallback(() => {
    const ta = inputRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!ta || !track || !thumb) return;

    const trackH = track.clientHeight;
    if (trackH === 0) return;

    const maxScroll = ta.scrollHeight - ta.clientHeight;
    if (maxScroll <= 0) {
      thumb.style.opacity = '0';
      return;
    }

    thumb.style.opacity = '1';
    const ratio = ta.scrollTop / maxScroll;
    const thumbH = Math.max(24, (ta.clientHeight / ta.scrollHeight) * trackH);
    thumb.style.height = `${thumbH}px`;
    thumb.style.top = `${ratio * (trackH - thumbH)}px`;
  }, []);

  // Applies a scroll ratio to both textareas and refreshes the scrollbar.
  const applyScrollRatio = useCallback((ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    syncRatioRef.current = clamped;

    const inputTA = inputRef.current;
    const outputTA = outputRef.current;
    if (!inputTA || !outputTA) return;

    const inputMax = Math.max(0, inputTA.scrollHeight - inputTA.clientHeight);
    const outputMax = Math.max(0, outputTA.scrollHeight - outputTA.clientHeight);

    isSyncingRef.current = true;
    inputTA.scrollTop = clamped * inputMax;
    outputTA.scrollTop = clamped * outputMax;
    // Clear sync flag after scroll events have had a chance to fire.
    requestAnimationFrame(() => { isSyncingRef.current = false; });

    updateScrollbar();
  }, [updateScrollbar]);

  // Preserve-mode: wheel interception + keyboard-scroll sync + resize tracking.
  useEffect(() => {
    if (mode !== 'preserve') return;

    const inputEl = inputRef.current;
    const outputEl = outputRef.current;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ta = e.currentTarget as HTMLTextAreaElement;
      const max = ta.scrollHeight - ta.clientHeight;
      if (max <= 0) return;
      applyScrollRatio(syncRatioRef.current + e.deltaY / max);
    };

    const syncFrom = (source: HTMLTextAreaElement, target: HTMLTextAreaElement) => {
      if (isSyncingRef.current) return;
      const max = source.scrollHeight - source.clientHeight;
      const ratio = max > 0 ? source.scrollTop / max : 0;
      syncRatioRef.current = ratio;
      const targetMax = target.scrollHeight - target.clientHeight;
      isSyncingRef.current = true;
      target.scrollTop = ratio * Math.max(0, targetMax);
      requestAnimationFrame(() => { isSyncingRef.current = false; });
      updateScrollbar();
    };

    const onInputScroll = () => {
      if (inputEl && outputEl) syncFrom(inputEl, outputEl);
    };
    const onOutputScroll = () => {
      if (outputEl && inputEl) syncFrom(outputEl, inputEl);
    };

    inputEl?.addEventListener('wheel', onWheel, { passive: false });
    outputEl?.addEventListener('wheel', onWheel, { passive: false });
    inputEl?.addEventListener('scroll', onInputScroll, { passive: true });
    outputEl?.addEventListener('scroll', onOutputScroll, { passive: true });

    // Keep scrollbar thumb accurate when content/size changes (new result, resize).
    const ro = new ResizeObserver(updateScrollbar);
    if (inputEl) ro.observe(inputEl);
    updateScrollbar();

    return () => {
      inputEl?.removeEventListener('wheel', onWheel);
      outputEl?.removeEventListener('wheel', onWheel);
      inputEl?.removeEventListener('scroll', onInputScroll);
      outputEl?.removeEventListener('scroll', onOutputScroll);
      ro.disconnect();
    };
  }, [mode, applyScrollRatio, updateScrollbar]);

  // Also refresh scrollbar when a new result arrives (output scrollHeight changes).
  useEffect(() => {
    if (mode === 'preserve') requestAnimationFrame(updateScrollbar);
  }, [result, mode, updateScrollbar]);

  // Custom thumb drag
  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const startY = e.clientY;
    const startRatio = syncRatioRef.current;
    const trackH = track.clientHeight;
    const thumbH = thumb.clientHeight;

    const onMouseMove = (me: MouseEvent) => {
      const delta = me.clientY - startY;
      applyScrollRatio(startRatio + delta / Math.max(1, trackH - thumbH));
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [applyScrollRatio]);

  // Click on track (not thumb) → jump to position
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement) === thumbRef.current) return;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;
    const rect = track.getBoundingClientRect();
    const thumbH = thumb.clientHeight;
    const ratio = (e.clientY - rect.top - thumbH / 2) / Math.max(1, track.clientHeight - thumbH);
    applyScrollRatio(ratio);
  }, [applyScrollRatio]);
  // ── End sync-scroll ─────────────────────────────────────────────────────────

  const scheduleWorker = useCallback((value: string) => {
    clearTimeout(workerTimerRef.current);
    if (!value) {
      setResult(null);
      setIsProcessing(false);
      return;
    }
    setIsProcessing(true);
    workerTimerRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ input: value, mode: modeRef.current });
    }, 200);
  }, []);

  const updateLineCount = useCallback((value: string) => {
    clearTimeout(lineCountTimerRef.current);
    lineCountTimerRef.current = setTimeout(() => {
      setInputLineCount(value ? value.split('\n').length : 0);
    }, 50);
  }, []);

  const onValueChange = useCallback((value: string) => {
    currentValueRef.current = value;
    setHasInput(value.length > 0);
    updateLineCount(value);

    if (!isApplyingRef.current) {
      clearTimeout(histTimerRef.current);
      histTimerRef.current = setTimeout(() => {
        const last = historyRef.current[histIdxRef.current];
        if (last !== value) {
          historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
          historyRef.current.push(value);
          histIdxRef.current = historyRef.current.length - 1;
        }
      }, 400);
    } else {
      isApplyingRef.current = false;
    }

    scheduleWorker(value);
  }, [scheduleWorker, updateLineCount]);

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/deduplicate.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }: MessageEvent<DedupeResult>) => {
      setResult(data);
      setIsProcessing(false);
    };
    workerRef.current = worker;

    const initial = currentValueRef.current;
    if (initial) scheduleWorker(initial);

    return () => {
      worker.terminate();
      clearTimeout(workerTimerRef.current);
      clearTimeout(histTimerRef.current);
      clearTimeout(lineCountTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const value = currentValueRef.current;
    if (value) scheduleWorker(value);
  }, [mode, scheduleWorker]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;

      e.preventDefault();
      clearTimeout(histTimerRef.current);

      const current = currentValueRef.current;
      const last = historyRef.current[histIdxRef.current];
      if (last !== current) {
        historyRef.current = historyRef.current.slice(0, histIdxRef.current + 1);
        historyRef.current.push(current);
        histIdxRef.current = historyRef.current.length - 1;
      }

      let nextIdx = histIdxRef.current;
      if (isUndo && nextIdx > 0) nextIdx--;
      else if (isRedo && nextIdx < historyRef.current.length - 1) nextIdx++;
      else return;

      histIdxRef.current = nextIdx;
      const nextVal = historyRef.current[nextIdx];
      isApplyingRef.current = true;
      currentValueRef.current = nextVal;

      if (inputRef.current) inputRef.current.value = nextVal;
      setHasInput(nextVal.length > 0);
      updateLineCount(nextVal);
      scheduleWorker(nextVal);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scheduleWorker, updateLineCount]);

  const handleQuickPaste = useCallback((text: string) => {
    if (inputRef.current) inputRef.current.value = text;
    onValueChange(text);
  }, [onValueChange]);
  useQuickPaste(handleQuickPaste);

  const handleClear = () => {
    if (inputRef.current) inputRef.current.value = '';
    onValueChange('');
  };

  const handleScrollTop = () => {
    if (mode === 'preserve') applyScrollRatio(0);
    else if (inputRef.current) inputRef.current.scrollTop = 0;
  };

  const handleScrollBottom = () => {
    if (mode === 'preserve') applyScrollRatio(1);
    else if (inputRef.current) inputRef.current.scrollTop = inputRef.current.scrollHeight;
  };

  const handleCopy = async () => {
    if (!result) return;
    await copyToClipboard(result.output);
    setCopied(true);
    setTimeout(() => setCopied(false), config.editor.copyFeedbackMs);
  };

  const stats = hasInput && !isProcessing ? result : null;
  // Hide native scrollbars in preserve mode — the center scrollbar takes over.
  const areaClass = cn(AREA_CLASS, mode === 'preserve' && 'dedup-noscroll');

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Inject once: hides native scrollbars for elements with .dedup-noscroll */}
      <style>{`.dedup-noscroll::-webkit-scrollbar{display:none}.dedup-noscroll{scrollbar-width:none;-ms-overflow-style:none}`}</style>

      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border">
        <div className="flex items-center p-0.5 rounded-md bg-muted gap-0.5">
          <Button
            variant={mode === 'preserve' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setMode('preserve')}
          >
            Preserve Order
          </Button>
          <Button
            variant={mode === 'sort' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setMode('sort')}
          >
            Sort
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-5">
          {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Stat value={stats?.original ?? null} label="original" />
          <div className="w-px h-4 bg-border" />
          <Stat value={stats?.unique ?? null} label="unique" color="text-green-600 dark:text-green-400" />
          <div className="w-px h-4 bg-border" />
          <Stat value={stats?.removed ?? null} label="removed" color="text-red-500 dark:text-red-400" />
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 min-h-0 flex">

        {/* Input pane */}
        <div className={cn('flex-1 min-w-0 flex flex-col', mode === 'sort' && 'border-r border-border')}>
          <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Input · one item per line</span>
            <div className="flex items-center gap-0.5">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Jump to top" disabled={!hasInput} onClick={handleScrollTop}>
                <ChevronsUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Jump to bottom" disabled={!hasInput} onClick={handleScrollBottom}>
                <ChevronsDown className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 hover:text-red-500" title="Clear input" disabled={!hasInput} onClick={handleClear}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex">
            <LineNumbers textareaRef={inputRef} lineCount={inputLineCount} />
            <textarea
              ref={inputRef}
              defaultValue={currentValueRef.current}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder={`apple\nbanana\napple\norange — ${quickPasteHint}`}
              spellCheck={false}
              className={areaClass}
              style={AREA_STYLE}
            />
          </div>
        </div>

        {/* ── Centre sync scrollbar (preserve mode only) ── */}
        {mode === 'preserve' && (
          <div
            ref={trackRef}
            className="w-3 shrink-0 relative bg-muted/20 border-x border-border cursor-pointer select-none"
            onClick={handleTrackClick}
          >
            <div
              ref={thumbRef}
              className="absolute left-0.5 right-0.5 top-0 rounded-sm bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors cursor-grab"
              style={{ opacity: 0 }}
              onMouseDown={handleThumbMouseDown}
            />
          </div>
        )}

        {/* Output pane */}
        <div
          className="flex-1 min-w-0 flex flex-col transition-opacity duration-150"
          style={{ opacity: isProcessing ? 0.55 : 1 }}
        >
          <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Output</span>
            <Button
              onClick={handleCopy}
              size="sm"
              variant="ghost"
              disabled={isProcessing || !result?.output}
              className="h-6 px-2 text-xs gap-1.5 -mr-1"
            >
              {copied
                ? <><CheckCheck className="h-3.5 w-3.5 text-green-500" />Copied</>
                : <><Copy className="h-3.5 w-3.5" />Copy</>}
            </Button>
          </div>
          <div className="flex-1 min-h-0 flex">
            <LineNumbers textareaRef={outputRef} lineCount={result?.unique ?? 0} />
            <textarea
              ref={outputRef}
              readOnly
              spellCheck={false}
              className={areaClass + ' cursor-default'}
              style={AREA_STYLE}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
