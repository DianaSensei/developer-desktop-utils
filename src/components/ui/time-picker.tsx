import * as React from 'react';
import { Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Cross-platform time picker — replaces free-text / native <input type="time">.
// Value is an "HH:MM" (or "HH:MM:SS" when showSeconds) 24h string. The control
// never accepts free text: you set the time by picking from the hour/minute/
// second lists or nudging with the steppers, so an invalid time can't be entered.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

function parse(value: string): { h: number; m: number; s: number } {
  const [hs, ms, ss] = (value || '').split(':');
  const clamp = (v: number, max: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(0, Math.trunc(v))) : 0;
  return { h: clamp(Number(hs), 23), m: clamp(Number(ms), 59), s: clamp(Number(ss), 59) };
}

export interface TimePickerProps {
  /** "HH:MM" (or "HH:MM:SS" when showSeconds) 24-hour string. */
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  className?: string;
  /** Step (units) used by the ▲/▼ steppers. Default 1. */
  minuteStep?: number;
  /** Add a seconds column and emit "HH:MM:SS". */
  showSeconds?: boolean;
  /** Render the columns directly (no trigger button / popover). */
  inline?: boolean;
}

function Column({
  label, count, selected, onPick, onStep, selRef, listClass, fill,
}: {
  label: string;
  count: number;
  selected: number;
  onPick: (n: number) => void;
  onStep: (d: number) => void;
  selRef: React.RefObject<HTMLButtonElement>;
  listClass: string;
  fill?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center', fill && 'min-h-0 flex-1')} onWheel={(e) => { e.preventDefault(); onStep(e.deltaY > 0 ? 1 : -1); }}>
      <span className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <button type="button" onClick={() => onStep(-1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Previous ${label}`}>
        <ChevronUp className="h-4 w-4" />
      </button>
      <div className={cn('my-1 w-10 overflow-y-auto rounded-md border bg-muted/20 px-1 py-1 no-scrollbar', fill ? 'min-h-0 flex-1' : listClass)}>
        {Array.from({ length: count }, (_, n) => {
          const isSel = n === selected;
          return (
            <button
              key={n}
              type="button"
              ref={isSel ? selRef : undefined}
              onClick={() => onPick(n)}
              className={cn(
                'block w-full rounded-md py-1 text-center font-mono text-sm tabular-nums transition-colors',
                isSel ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {pad2(n)}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => onStep(1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Next ${label}`}>
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TimePicker({ value, onChange, disabled, className, minuteStep = 1, showSeconds = false, inline = false }: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const hourRef = React.useRef<HTMLButtonElement>(null);
  const minRef = React.useRef<HTMLButtonElement>(null);
  const secRef = React.useRef<HTMLButtonElement>(null);

  const pendingScroll = React.useRef(false);
  const { h, m, s } = parse(value);
  const emit = (nh: number, nm: number, ns: number) =>
    onChange(showSeconds ? `${pad2(nh)}:${pad2(nm)}:${pad2(ns)}` : `${pad2(nh)}:${pad2(nm)}`);

  const scrollSelected = React.useCallback(() => {
    requestAnimationFrame(() => {
      hourRef.current?.scrollIntoView({ block: 'center' });
      minRef.current?.scrollIntoView({ block: 'center' });
      secRef.current?.scrollIntoView({ block: 'center' });
    });
  }, []);

  // Close on outside click / Escape (popover mode only).
  React.useEffect(() => {
    if (inline || !open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, inline]);

  // Scroll the current values into view (when opening, or on mount if inline).
  React.useEffect(() => {
    if (!inline && !open) return;
    scrollSelected();
  }, [open, inline, scrollSelected]);

  // After "Now" (which changes value), bring the new values into view.
  React.useEffect(() => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    scrollSelected();
  }, [value, scrollSelected]);

  const stepHour = (d: number) => emit((h + 24 + d) % 24, m, s);
  const stepMin = (d: number) => emit(h, (m + 60 + d * minuteStep) % 60, s);
  const stepSec = (d: number) => emit(h, m, (s + 60 + d) % 60);

  const listClass = 'h-[132px]';
  const sep = <span className="self-center font-mono text-lg text-muted-foreground">:</span>;
  const columns = (
    <>
      <div className={cn('flex justify-center gap-1', inline ? 'min-h-0 flex-1 items-stretch' : 'items-start')}>
        <Column label="Hr" count={24} selected={h} onPick={(n) => emit(n, m, s)} onStep={stepHour} selRef={hourRef} listClass={listClass} fill={inline} />
        {sep}
        <Column label="Min" count={60} selected={m} onPick={(n) => emit(h, n, s)} onStep={stepMin} selRef={minRef} listClass={listClass} fill={inline} />
        {showSeconds && (
          <>
            {sep}
            <Column label="Sec" count={60} selected={s} onPick={(n) => emit(h, m, n)} onStep={stepSec} selRef={secRef} listClass={listClass} fill={inline} />
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => { const d = new Date(); pendingScroll.current = true; emit(d.getHours(), d.getMinutes(), d.getSeconds()); }}
        className="mt-2 w-full rounded-md border py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Now
      </button>
    </>
  );

  if (inline) {
    return <div ref={wrapRef} className={cn('flex h-full flex-col rounded-lg border bg-popover p-3', className)}>{columns}</div>;
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'flex h-9 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm tabular-nums',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/50',
          className,
        )}
      >
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono">{pad2(h)}:{pad2(m)}{showSeconds && `:${pad2(s)}`}</span>
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 rounded-lg border bg-popover p-3 shadow-xl">
          {columns}
        </div>
      )}
    </div>
  );
}
