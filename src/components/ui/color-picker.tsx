import * as React from 'react';
import { cn } from '@/lib/utils';
import { useDismissable } from '@/hooks/useDismissable';

// ---------------------------------------------------------------------------
// Cross-platform color picker — replaces the native <input type="color">.
// A swatch trigger opens a popover with a saturation/value field, a hue
// slider, and a hex input. Looks identical on macOS / Windows / Linux.
// ---------------------------------------------------------------------------

interface RGB { r: number; g: number; b: number; }
interface HSV { h: number; s: number; v: number; }

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalizeHex(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return '#' + h.toLowerCase();
}

function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex) ?? '#000000';
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

/** Track a pointer drag inside an element, reporting fractional (x, y) in [0,1]. */
function useDragTrack(onChange: (x: number, y: number) => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const handle = React.useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((clientY - rect.top) / rect.height, 0, 1);
    onChangeRef.current(x, y);
  }, []);

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    handle(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => handle(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [handle]);

  return { ref, onPointerDown };
}

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** Extra classes for the swatch trigger button (control its size here). */
  className?: string;
  /** Extra classes for the wrapper (e.g. "flex-1" to fill a flex cell). */
  wrapClassName?: string;
  title?: string;
  children?: React.ReactNode;
}

export function ColorPicker({ value, onChange, disabled, className, wrapClassName, title, children }: ColorPickerProps) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  // Local hue keeps the slider stable when saturation/value hit 0 (where hue
  // is otherwise undefined and would snap back to red).
  const hsv = React.useMemo(() => rgbToHsv(hexToRgb(value)), [value]);
  const [hue, setHue] = React.useState(hsv.h);
  React.useEffect(() => { if (hsv.s > 0 && hsv.v > 0) setHue(hsv.h); }, [hsv.h, hsv.s, hsv.v]);

  const [hexDraft, setHexDraft] = React.useState(value);
  React.useEffect(() => { setHexDraft(value); }, [value]);

  const emit = (next: HSV) => onChange(rgbToHex(hsvToRgb(next)));

  const sv = useDragTrack((x, y) => emit({ h: hue, s: x, v: 1 - y }));
  const hueTrack = useDragTrack((x) => {
    const h = x * 360;
    setHue(h);
    emit({ h, s: hsv.s || 1, v: hsv.v || 1 });
  });

  const commitHex = () => {
    const norm = normalizeHex(hexDraft);
    if (norm) onChange(norm);
    else setHexDraft(value);
  };

  return (
    <div ref={wrapRef} className={cn('relative inline-block', wrapClassName)}>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label="Pick a color"
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ backgroundColor: value }}
        className={cn(
          'rounded-md border border-border shadow-sm transition-shadow',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:shadow',
          'h-6 w-6',
          className,
        )}
      >
        {children}
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1.5 w-56 rounded-lg border bg-popover p-3 shadow-xl">
          {/* Saturation / Value field */}
          <div
            ref={sv.ref}
            onPointerDown={sv.onPointerDown}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-md"
            style={{
              backgroundColor: `hsl(${hue} 100% 50%)`,
              backgroundImage:
                'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
            }}
          >
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                backgroundColor: value,
              }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hueTrack.ref}
            onPointerDown={hueTrack.onPointerDown}
            className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full"
            style={{
              backgroundImage:
                'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
            }}
          >
            <span
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${(hue / 360) * 100}%`, backgroundColor: `hsl(${hue} 100% 50%)` }}
            />
          </div>

          {/* Hex input */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-7 w-7 shrink-0 rounded-md border" style={{ backgroundColor: value }} />
            <input
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => { if (e.key === 'Enter') { commitHex(); (e.target as HTMLInputElement).blur(); } }}
              spellCheck={false}
              className="h-7 w-full rounded-md border bg-card px-2 font-mono text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
