import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ColorPicker as ColorField } from '@/components/ui/color-picker';
import {
  Copy, Check, Pipette, Image as ImageIcon, Download, SlidersHorizontal, HelpCircle, ArrowLeftRight,
} from 'lucide-react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useQuickPaste } from '@/hooks/useQuickPaste';
import { copyToClipboard } from '@/lib/clipboard';

// ---------------------------------------------------------------------------
// Color conversions
// ---------------------------------------------------------------------------

function hexToRgb(hex: string) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((x) => {
    const h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function rgbToHsl(r: number, g: number, b: number) {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN: h = ((gN - bN) / d + (gN < bN ? 6 : 0)) / 6; break;
      case gN: h = ((bN - rN) / d + 2) / 6; break;
      case bN: h = ((rN - gN) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function rgbToCmyk(r: number, g: number, b: number) {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const k = 1 - Math.max(rN, gN, bN);
  const f = (v: number) => (k === 1 ? 0 : Math.round(((1 - v - k) / (1 - k)) * 100));
  return { c: f(rN), m: f(gN), y: f(bN), k: Math.round(k * 100) };
}

// ---------------------------------------------------------------------------
// Palette extraction — median-cut quantization on a downsampled image
// ---------------------------------------------------------------------------

type Px = [number, number, number];

function quantize(pixels: Px[], count: number): string[] {
  if (pixels.length === 0) return [];
  interface Box { px: Px[]; score: number; }
  const makeBox = (px: Px[]): Box => {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const [r, g, b] of px) {
      rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
      gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
      bmin = Math.min(bmin, b); bmax = Math.max(bmax, b);
    }
    const range = Math.max(rmax - rmin, gmax - gmin, bmax - bmin);
    return { px, score: range * px.length };
  };
  let boxes = [makeBox(pixels)];
  while (boxes.length < count) {
    boxes.sort((a, b) => b.score - a.score);
    const box = boxes.shift();
    if (!box || box.px.length <= 1) { if (box) boxes.push(box); break; }
    // split along the channel with the greatest range
    const px = box.px;
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const [r, g, b] of px) {
      rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
      gmin = Math.min(gmin, g); gmax = Math.max(gmax, g);
      bmin = Math.min(bmin, b); bmax = Math.max(bmax, b);
    }
    const rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
    const ch = rr >= gr && rr >= br ? 0 : gr >= br ? 1 : 2;
    px.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(px.length / 2);
    boxes.push(makeBox(px.slice(0, mid)), makeBox(px.slice(mid)));
  }
  return boxes.map(({ px }) => {
    let r = 0, g = 0, b = 0;
    for (const p of px) { r += p[0]; g += p[1]; b += p[2]; }
    return rgbToHex(r / px.length, g / px.length, b / px.length);
  });
}

const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// A built-in sample image so the tool is usable before the user uploads one.
function makeSampleImage(): string {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 400;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 600, 400);
  g.addColorStop(0, '#1e3a8a'); g.addColorStop(0.4, '#0ea5e9');
  g.addColorStop(0.6, '#fcd34d'); g.addColorStop(1, '#b45309');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 600, 400);
  // a few accent blobs for palette variety
  const blobs: [number, number, number, string][] = [
    [120, 90, 60, '#ef4444'], [470, 110, 50, '#10b981'],
    [300, 300, 80, '#f3f4f6'], [510, 320, 45, '#111827'],
  ];
  for (const [x, y, r, col] of blobs) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LOUPE = 132;   // loupe canvas size (px)
const LOUPE_CELLS = 11; // source pixels shown across the loupe
const PALETTE_SIZE = 16; // number of colors extracted from the image (strip scrolls)

// Small hover "?" with a tooltip — replaces inline hint text.
function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground/50 transition-colors hover:text-foreground" />
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-56 rounded-lg border bg-popover p-2 text-[11px] font-normal leading-relaxed text-muted-foreground shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function ColorPicker() {
  const [color, setColor] = usePersistentState('devtool:colorPicker:color', '#2596be');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [palette, setPalette] = useState<string[]>([]);

  useQuickPaste((text) => {
    const trimmed = text.trim();
    if (/^#?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})$/i.test(trimmed)) {
      setColor(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
    }
  });
  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [eyeError, setEyeError] = useState('');

  const [paletteScrollable, setPaletteScrollable] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // Readouts for a given hex — `d` is the compact display, `c` is the full
  // CSS form that gets copied. Used for both color views.
  const fmt = useCallback((hex: string | null) => {
    if (!hex) return null;
    const { r, g, b } = hexToRgb(hex);
    const hsl = rgbToHsl(r, g, b);
    const cmyk = rgbToCmyk(r, g, b);
    const hexStr = hex.toLowerCase();
    const rgbStr = `rgb(${r}, ${g}, ${b})`;
    const hslStr = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    const cmykStr = `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`;
    return {
      hex: { d: hexStr, c: hexStr },
      rgb: { d: rgbStr, c: rgbStr },
      hsl: { d: hslStr, c: hslStr },
      cmyk: { d: cmykStr, c: cmykStr },
    };
  }, []);

  const selFmt = useMemo(() => fmt(color), [color, fmt]);
  const hovFmt = useMemo(() => fmt(hoverColor), [hoverColor, fmt]);

  // Load the sample image on first mount.
  useEffect(() => { setImageSrc(makeSampleImage()); }, []);

  // Track whether the palette overflows its bar (→ show a scroll hint).
  useEffect(() => {
    const el = paletteRef.current;
    if (!el) return;
    const check = () => setPaletteScrollable(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [palette]);

  // Draw the image into the canvas, then recompute the palette.
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const max = 1400;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      recomputePalette();
    };
    img.src = imageSrc;
  }, [imageSrc]); // eslint-disable-line

  const recomputePalette = useCallback(() => {
    const src = imgRef.current;
    if (!src) return;
    const c = document.createElement('canvas');
    const scale = Math.min(1, 120 / Math.max(src.width, src.height));
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const pixels: Px[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue; // skip transparent
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    setPalette(quantize(pixels, PALETTE_SIZE));
  }, []);

  /** Map a pointer event to integer canvas pixel coordinates.
   *  Accounts for object-contain letterboxing if the height cap kicks in. */
  const eventToPixel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const offX = (rect.width - canvas.width * scale) / 2;
    const offY = (rect.height - canvas.height * scale) / 2;
    const x = Math.floor((e.clientX - rect.left - offX) / scale);
    const y = Math.floor((e.clientY - rect.top - offY) / scale);
    return { x, y };
  };

  const sampleAt = (x: number, y: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d')!;
    const d = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1).data;
    return rgbToHex(d[0], d[1], d[2]);
  };

  const drawLoupe = (cx: number, cy: number) => {
    const canvas = canvasRef.current;
    const loupeCanvas = loupeRef.current;
    if (!canvas || !loupeCanvas) return;
    const ctx = loupeCanvas.getContext('2d')!;
    const cells = LOUPE_CELLS;
    const half = Math.floor(cells / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(canvas, cx - half, cy - half, cells, cells, 0, 0, LOUPE, LOUPE);
    // grid
    const step = LOUPE / cells;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i < cells; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, LOUPE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(LOUPE, i * step); ctx.stroke();
    }
    // center cell highlight
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(half * step, half * step, step, step);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = eventToPixel(e);
    const hx = sampleAt(x, y);
    if (hx) setHoverColor(hx);
    const rect = canvasRef.current!.getBoundingClientRect();
    setLoupe({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    drawLoupe(x, y);
  };

  const onPick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = eventToPixel(e);
    const hx = sampleAt(x, y);
    if (hx) setColor(hx);
  };

  const onUpload = () => fileRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const pickFromScreen = async () => {
    setEyeError('');
    if (!hasEyeDropper) {
      setEyeError(
        isTauri
          ? 'Screen picking needs the EyeDropper API, which the macOS app webview (WebKit) doesn’t support. Use it in the web build (Chrome/Edge), or upload a screenshot above and pick from it.'
          : 'Your browser doesn’t support the EyeDropper API. Try Chrome or Edge.'
      );
      return;
    }
    try {
      const ed = new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper();
      const res = await ed.open();
      setColor(res.sRGBHex);
    } catch {
      /* user cancelled — ignore */
    }
  };

  const copy = (label: string, value: string) => {
    copyToClipboard(value);
    setCopied(label);
    window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
  };

  const downloadPalette = () => {
    if (palette.length === 0) return;
    const w = 100, h = 100;
    const c = document.createElement('canvas');
    c.width = w * palette.length; c.height = h;
    const ctx = c.getContext('2d')!;
    palette.forEach((hex, i) => { ctx.fillStyle = hex; ctx.fillRect(i * w, 0, w, h); });
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'palette.png';
    a.click();
  };

  const savePalette = () => {
    if (palette.length === 0) return;
    copy('palette', palette.join('\n'));
  };

  const swatch = (hex: string, i: number) => (
    <button
      key={`${hex}-${i}`}
      onClick={() => setColor(hex)}
      title={`${hex} — click to select`}
      className="h-full min-w-8 flex-1 transition-transform hover:z-10 hover:scale-110"
      style={{ backgroundColor: hex }}
    />
  );

  // One value cell in the comparison grid — click to copy.
  const Cell = ({ id, value }: { id: string; value?: { d: string; c: string } }) => (
    value ? (
      <button
        onClick={() => copy(id, value.c)}
        title={`Click to copy ${value.c}`}
        className="group flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-1 text-left font-mono text-xs transition-colors hover:bg-muted"
      >
        <span className="min-w-0 flex-1 truncate">{value.d}</span>
        {copied === id
          ? <Check className="h-3 w-3 shrink-0 text-green-500" />
          : <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />}
      </button>
    ) : (
      <span className="px-1.5 py-1 text-xs text-muted-foreground">—</span>
    )
  );

  // A label + the two views' values for one color format.
  const CompareRow = ({ label, field }: { label: string; field: 'hex' | 'rgb' | 'hsl' | 'cmyk' }) => (
    <>
      <span className="self-center text-[10px] font-medium text-muted-foreground">{label}</span>
      <Cell id={`sel-${field}`} value={selFmt?.[field]} />
      <Cell id={`hov-${field}`} value={hovFmt?.[field]} />
    </>
  );

  return (
    <div className="h-full overflow-y-auto">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_30rem]">

        {/* ── Left: image ── */}
        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold">Image</h2>
              <Help text="Move over the image to magnify it, then click to pick the color under the crosshair." />
            </div>
            <div className="relative w-full overflow-hidden rounded-xl border bg-muted/30">
              <canvas
                ref={canvasRef}
                onPointerMove={onMove}
                onPointerLeave={() => { setLoupe(null); setHoverColor(null); }}
                onPointerDown={onPick}
                className="block w-full max-h-[80vh] object-contain cursor-crosshair touch-none select-none"
              />
              {/* Magnifier loupe */}
              {loupe && (
                <div
                  className="pointer-events-none absolute z-10 overflow-hidden rounded-xl border-2 border-white shadow-xl"
                  style={{
                    width: LOUPE, height: LOUPE,
                    left: Math.min(Math.max(loupe.x + 24, 0), (canvasRef.current?.clientWidth ?? 0) - LOUPE),
                    top: Math.min(Math.max(loupe.y - LOUPE / 2, 0), (canvasRef.current?.clientHeight ?? 0) - LOUPE),
                  }}
                >
                  <canvas ref={loupeRef} width={LOUPE} height={LOUPE} className="block" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: colors + palette + actions ── */}
        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold">Colors</h2>
              <Help text="Selected is your last pick (click the sliders to fine-tune it). Hovering tracks the cursor over the image. Click any value to copy it." />
            </div>

            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-lg border bg-card p-2.5">
              {/* Column headers */}
              <span />
              <div className="flex items-center justify-between gap-1 px-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Selected</span>
                <ColorField
                  value={color}
                  onChange={setColor}
                  className="relative h-5 w-5"
                  title="Adjust the selected color"
                >
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white mix-blend-difference">
                    <SlidersHorizontal className="h-2.5 w-2.5" />
                  </span>
                </ColorField>
              </div>
              <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hovering
              </span>

              {/* Swatch row */}
              <span />
              <div className="h-11 rounded-lg border shadow-sm" style={{ backgroundColor: color }} title={`Selected ${color}`} />
              <div
                className="h-11 rounded-lg border shadow-sm"
                style={hoverColor ? { backgroundColor: hoverColor } : undefined}
                title={hoverColor ? `Hovering ${hoverColor}` : 'Move over the image'}
              />

              {/* Format rows */}
              <CompareRow label="HEX" field="hex" />
              <CompareRow label="RGB" field="rgb" />
              <CompareRow label="HSL" field="hsl" />
              <CompareRow label="CMYK" field="cmyk" />
            </div>

          </div>

          {/* Color palette */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="text-sm font-semibold">Color Palette</h2>
                <Help text="Colors extracted from the image. Click a swatch to select it. When there are more than fit, the strip scrolls sideways." />
                {paletteScrollable && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <ArrowLeftRight className="h-3 w-3" /> scroll
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={downloadPalette}
                  className="flex h-8 w-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted"
                  title="Download palette as PNG">
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button onClick={savePalette}
                  className="flex h-8 w-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted"
                  title="Copy all hex codes">
                  {copied === 'palette' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div ref={paletteRef} className="flex h-10 w-full overflow-x-auto overflow-y-hidden no-scrollbar rounded-lg border">
              {palette.length > 0 ? palette.map((hex, i) => swatch(hex, i))
                : <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No colors</div>}
            </div>
          </div>

          {/* Use your own image */}
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <h3 className="text-sm font-semibold">Use your own image</h3>
            <Button onClick={onUpload} className="w-full gap-2">
              <ImageIcon className="h-4 w-4" /> Use your image
            </Button>
            <Button onClick={pickFromScreen} variant="outline" className="w-full gap-2">
              <Pipette className="h-4 w-4" /> Pick from Screen
            </Button>
            {eyeError && <p className="text-xs text-destructive">{eyeError}</p>}
          </div>
        </div>

      </div>
    </div>
  );
}
