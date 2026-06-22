import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Loader2, Trophy, ArrowDown, ArrowUp, Eraser, Check, Repeat, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';

const SIZE = 460; // internal canvas size (device px handled via DPR)
const PULSE_MS = 1600;
const MAX_HISTORY = 200;
const SPIN_DURATIONS = [2, 3, 4, 6, 8] as const; // selectable spin lengths (seconds)
const AUTO_GAP_MS = 750; // pause between auto-spins so each winner is visible

interface SpinResult {
  choice: string;
  time: number; // epoch ms
}

// All non-empty, trimmed lines — duplicates are kept by default (more copies of
// a value = higher odds). The "unique only" toggle collapses them.
function parseLines(value: string): string[] {
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

// Collapse duplicates, preserving first-seen order.
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

// Evenly-spaced hues so any number of segments stays readable.
function segmentColor(i: number, n: number): string {
  const hue = Math.round((i * 360) / Math.max(n, 1));
  return `hsl(${hue} 65% 52%)`;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function drawWheel(
  ctx: CanvasRenderingContext2D,
  size: number,
  choices: string[],
  rotation: number,
  highlight: { index: number; intensity: number } | null,
) {
  const n = choices.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 6;

  ctx.clearRect(0, 0, size, size);

  if (n === 0) {
    ctx.fillStyle = 'rgba(120,120,120,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const seg = (Math.PI * 2) / n;

  for (let i = 0; i < n; i++) {
    const start = rotation + i * seg;
    const end = start + seg;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = segmentColor(i, n);
    ctx.fill();

    // Winning-segment glow (pulses after the wheel lands).
    if (highlight && highlight.index === i) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${0.12 + highlight.intensity * 0.28})`;
      ctx.fill();
      ctx.restore();
    }

    // Label
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const fontSize = Math.max(11, Math.min(18, 220 / Math.max(n, 6)));
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const label = choices[i];
    const maxChars = Math.max(6, Math.floor((radius - 28) / (fontSize * 0.55)));
    const text = label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
    ctx.fillText(text, radius - 16, 0);
    ctx.restore();
  }

  // Hub — proportional so it stays balanced at any rendered size
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.057, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.stroke();

  // Outer ring — stroke sits just inside the radius so it never gets clipped
  // at the bitmap edge (a clipped stroke is what made the rim look jagged).
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function LuckyWheel() {
  const [raw, setRaw] = usePersistentState('devtool:luckywheel:choices', 'Pizza\nSushi\nBurger\nSalad\nTacos\nNoodles');
  const [uniqueOnly, setUniqueOnly] = usePersistentState('devtool:luckywheel:uniqueOnly', false);
  const [removeOnWin, setRemoveOnWin] = usePersistentState('devtool:luckywheel:removeOnWin', false);
  const [history, setHistory] = usePersistentState<SpinResult[]>('devtool:luckywheel:history', []);
  const [spinSec, setSpinSec] = usePersistentState('devtool:luckywheel:spinSec', 4);
  const [autoCount, setAutoCount] = usePersistentState('devtool:luckywheel:autoCount', 3);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [spinning, setSpinning] = useState(false);
  const [autoLeft, setAutoLeft] = useState(0); // remaining spins in an auto run (0 = not auto)
  const [winner, setWinner] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef(SIZE); // logical (CSS) size the canvas is currently rendered at
  const rotationRef = useRef(0);
  const highlightRef = useRef<{ index: number; intensity: number } | null>(null);
  const spinRaf = useRef<number | null>(null);
  const pulseRaf = useRef<number | null>(null);
  const aliveRef = useRef(true); // false after unmount — stops an in-flight auto run

  useQuickPaste(setRaw);

  const choices = useMemo(() => {
    const lines = parseLines(raw);
    return uniqueOnly ? dedupe(lines) : lines;
  }, [raw, uniqueOnly]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    drawWheel(ctx, sizeRef.current, choices, rotationRef.current, highlightRef.current);
  }, [choices]);

  // Match the backing store to the canvas's actual on-screen size × DPR so the
  // circle is rasterized at native device resolution. Without this the fixed
  // bitmap got bitmap-scaled to fit, which re-aliased the rim (jagged edge).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sync = () => {
      const cssSize = Math.round(canvas.getBoundingClientRect().width);
      if (cssSize <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const next = Math.round(cssSize * dpr);
      if (canvas.width !== next || canvas.height !== next) {
        canvas.width = next;
        canvas.height = next;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = cssSize;
      render();
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [render]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (spinRaf.current) cancelAnimationFrame(spinRaf.current);
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
    };
  }, []);

  const startPulse = useCallback((index: number) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      const e = now - t0;
      if (e >= PULSE_MS) {
        highlightRef.current = null;
        render();
        return;
      }
      highlightRef.current = { index, intensity: Math.sin(e / 110) * 0.5 + 0.5 };
      render();
      pulseRaf.current = requestAnimationFrame(tick);
    };
    pulseRaf.current = requestAnimationFrame(tick);
  }, [render]);

  // Animate the wheel so a specific slice lands centered under the top pointer.
  // Resolves once the wheel stops and the winner is recorded.
  const spinTo = useCallback((index: number) => new Promise<void>((resolve) => {
    if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
    highlightRef.current = null;

    const n = choices.length;
    const seg = (Math.PI * 2) / n;
    const pointer = -Math.PI / 2;
    const start = rotationRef.current;
    // Rotation that puts slice `index` centered under the pointer …
    const base = pointer - index * seg - seg / 2;
    // … then add 5–7 extra full turns beyond the current angle.
    const turns = 5 + Math.floor(Math.random() * 3);
    const k = Math.ceil((start + turns * Math.PI * 2 - base) / (Math.PI * 2));
    const target = base + k * Math.PI * 2;
    const dur = Math.max(600, spinSec * 1000);
    const t0 = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      rotationRef.current = start + (target - start) * easeOutCubic(p);
      render();
      if (p < 1) {
        spinRaf.current = requestAnimationFrame(tick);
        return;
      }
      rotationRef.current = target;
      render();
      startPulse(index);
      const win = choices[index];
      setWinner(win);
      setHistory((h) => [...h, { choice: win, time: Date.now() }].slice(-MAX_HISTORY));
      resolve();
    };
    spinRaf.current = requestAnimationFrame(tick);
  }), [choices, spinSec, render, startPulse, setHistory]);

  const removeFromRaw = useCallback((win: string) => {
    // Unique mode: drop every copy. Otherwise drop just one winning slice so
    // remaining duplicates keep their odds.
    let dropped = false;
    const kept = raw.split('\n').filter((l) => {
      if (l.trim() !== win) return true;
      if (uniqueOnly) return false;
      if (dropped) return true;
      dropped = true;
      return false;
    });
    setRaw(kept.join('\n'));
  }, [raw, uniqueOnly, setRaw]);

  const spin = useCallback(async () => {
    if (spinning || choices.length < 2) return;
    setSpinning(true);
    setWinner(null);
    const idx = Math.floor(Math.random() * choices.length);
    await spinTo(idx);
    setSpinning(false);
    if (removeOnWin) removeFromRaw(choices[idx]);
  }, [spinning, choices, removeOnWin, spinTo, removeFromRaw]);

  // Auto-spin X times, drawing X distinct slices (X must be < candidate count).
  // Non-destructive: the choices list is left untouched.
  const autoSpin = useCallback(async () => {
    const n = choices.length;
    const count = Math.min(Math.floor(autoCount), n - 1);
    if (spinning || n < 2 || count < 1) return;

    aliveRef.current = true;
    setSpinning(true);
    setWinner(null);
    const drawn = new Set<number>();
    for (let s = 0; s < count; s++) {
      if (!aliveRef.current) break;
      setAutoLeft(count - s);
      let idx = Math.floor(Math.random() * n);
      while (drawn.has(idx)) idx = Math.floor(Math.random() * n);
      drawn.add(idx);
      await spinTo(idx);
      if (s < count - 1) await new Promise((r) => setTimeout(r, AUTO_GAP_MS));
    }
    setAutoLeft(0);
    setSpinning(false);
  }, [spinning, choices, autoCount, spinTo]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setWinner(null);
    if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
    highlightRef.current = null;
    render();
  }, [setHistory, render]);

  const maxAuto = Math.max(1, choices.length - 1);

  const sortedHistory = useMemo(() => {
    const rows = history.map((h, i) => ({ ...h, seq: i + 1 }));
    rows.sort((a, b) => (sortDir === 'desc' ? b.time - a.time : a.time - b.time));
    return rows;
  }, [history, sortDir]);

  return (
    <div className="grid h-full grid-cols-1 divide-y overflow-hidden lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      {/* Options + history */}
      <div className="flex min-h-0 flex-col gap-3 p-4">
        <div className="flex min-h-0 flex-[3] flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="text-xs">Choices <span className="text-muted-foreground/60">— one per line · {quickPasteHint}</span></Label>
            <span className="text-[11px] text-muted-foreground">{choices.length} {uniqueOnly ? 'unique' : 'slices'}</span>
          </div>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'Option 1\nOption 2\nOption 3'}
            className="min-h-0 flex-1 resize-none font-mono text-sm"
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setUniqueOnly((v) => !v)}
              title="Collapse duplicate lines so each value gets one slice"
              aria-pressed={uniqueOnly}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                uniqueOnly
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-b border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {uniqueOnly && <Check className="h-3 w-3" />}
              Unique only
            </button>
            <button
              type="button"
              onClick={() => setRemoveOnWin((v) => !v)}
              title="Remove the winning choice from the list after each spin"
              aria-pressed={removeOnWin}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                removeOnWin
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-b border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {removeOnWin && <Check className="h-3 w-3" />}
              Remove winner
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5" />
            <span>Spin time</span>
            <Select value={String(spinSec)} onValueChange={(v) => setSpinSec(Number(v))}>
              <SelectTrigger className="h-8 w-[4.5rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPIN_DURATIONS.map((s) => <SelectItem key={s} value={String(s)}>{s}s</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Winner history — fills the remaining space, kept shorter than the input above */}
        <div className="flex min-h-0 flex-[2] flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium">
              Spin history <span className="text-muted-foreground/60">{history.length}</span>
            </span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Eraser className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[2.5rem_1fr_6rem] gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              <span>#</span>
              <span>Winner</span>
              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                className="flex items-center gap-1 transition-colors hover:text-foreground"
                title="Sort by spin time"
              >
                Time {sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sortedHistory.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">No spins yet — spin the wheel to record a winner.</p>
              ) : (
                sortedHistory.map((row) => (
                  <div key={`${row.seq}-${row.time}`} className="grid grid-cols-[2.5rem_1fr_6rem] gap-2 border-b border-border px-3 py-1.5 text-xs last:border-0">
                    <span className="tabular-nums text-muted-foreground">{row.seq}</span>
                    <span className="truncate font-medium" title={row.choice}>{row.choice}</span>
                    <span className="tabular-nums text-muted-foreground">{formatTime(row.time)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Wheel */}
      <div className="flex min-h-0 flex-col gap-4 p-4">
        {/* Fixed-height slot so the wheel below never shifts when the banner toggles */}
        <div className="mx-auto h-[60px] w-full max-w-[420px] shrink-0">
          {winner && (
            <div
              key={`${winner}-${history.length}`}
              className="flex h-full items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 animate-in fade-in zoom-in-95 duration-300"
            >
              <Trophy className="h-5 w-5 shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Latest winner</p>
                <p className="truncate text-base font-semibold">{winner}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        <div className="relative" style={{ width: 'min(100%, 420px)' }}>
          {/* Pointer */}
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
            <div
              className="h-0 w-0"
              style={{
                borderLeft: '12px solid transparent',
                borderRight: '12px solid transparent',
                borderTop: '20px solid hsl(var(--foreground))',
              }}
            />
          </div>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: 'auto', aspectRatio: '1 / 1' }}
            className="drop-shadow-sm"
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={spin} disabled={spinning || choices.length < 2} size="lg" className="gap-2">
            {spinning && !autoLeft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {spinning && !autoLeft ? 'Spinning…' : 'Spin'}
          </Button>

          <div className="flex items-center gap-1.5 rounded-lg border bg-card p-1">
            <Input
              type="number"
              min={1}
              max={maxAuto}
              value={autoCount}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) setAutoCount(Math.min(Math.max(1, v), Math.max(1, maxAuto)));
              }}
              disabled={spinning}
              className="h-8 w-14 text-center text-sm"
              title="Number of winners to draw"
            />
            <Button
              onClick={autoSpin}
              disabled={spinning || choices.length < 2 || autoCount < 1}
              variant="outline"
              className="h-8 gap-1.5"
            >
              {spinning && autoLeft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
              {spinning && autoLeft ? `Auto ${autoLeft} left` : 'Auto-spin'}
            </Button>
          </div>
        </div>
        {choices.length < 2 ? (
          <p className="text-xs text-muted-foreground">Add at least two choices to spin.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Auto-spin draws up to {maxAuto} distinct winner{maxAuto === 1 ? '' : 's'}.</p>
        )}
        </div>
      </div>
    </div>
  );
}
