import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, Download, Check, Upload, X } from 'lucide-react';
import QRCode from 'qrcode';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { cn } from '@/lib/utils';

type FrameStyle = 'none' | 'border' | 'scan-bottom' | 'scan-top';
type LogoPreset = 'none' | 'scan-me' | '📱' | '🔗' | '📶' | 'custom';

// Internal canvas size (2× for retina); displayed at half size via CSS
const CANVAS_SIZE = 560;
const FRAME_PAD   = 40;
const LABEL_H     = 84;
const QUIET_ZONE  = 4; // modules of quiet zone around QR

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// Returns the bounding box (in canvas px) that the logo+background will occupy
function getLogoBounds(
  ctx: CanvasRenderingContext2D,
  preset: LogoPreset,
  customImage: HTMLImageElement | null,
  cx: number,
  cy: number,
): { x: number; y: number; w: number; h: number } {
  const PAD = 18;
  let w = 0, h = 0;

  if (preset === 'scan-me') {
    const fontSize = CANVAS_SIZE * 0.054;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = Math.max(ctx.measureText('SCAN').width, ctx.measureText('ME').width);
    const textH = fontSize * 2 + fontSize * 0.3;
    w = textW + PAD * 2;
    h = textH + PAD * 2;
  } else if (preset === 'custom' && customImage) {
    const maxSide = CANVAS_SIZE * 0.22;
    const iw = customImage.naturalWidth  || customImage.width;
    const ih = customImage.naturalHeight || customImage.height;
    const scale = Math.min(maxSide / iw, maxSide / ih);
    w = iw * scale + PAD * 2;
    h = ih * scale + PAD * 2;
  } else if (preset !== 'none') {
    // emoji
    const fontSize = CANVAS_SIZE * 0.13;
    w = h = fontSize + PAD * 2;
  }

  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

interface RenderOpts {
  text: string;
  darkColor: string;
  lightColor: string;
  transparent: boolean;
  frame: FrameStyle;
  logo: LogoPreset;
  customImage: HTMLImageElement | null;
}

async function renderToCanvas(opts: RenderOpts): Promise<HTMLCanvasElement | null> {
  if (!opts.text.trim()) return null;

  const hasLogo     = opts.logo !== 'none';
  const hasBorder   = opts.frame !== 'none';
  const labelBottom = opts.frame === 'scan-bottom';
  const labelTop    = opts.frame === 'scan-top';
  const framePad    = hasBorder ? FRAME_PAD : 0;
  const topH        = labelTop    ? LABEL_H : 0;
  const botH        = labelBottom ? LABEL_H : 0;

  // ── Step 1: get raw QR module matrix ──────────────────────────────────────
  const qr = QRCode.create(opts.text, {
    errorCorrectionLevel: hasLogo ? 'H' : 'M',
  });
  const moduleCount = qr.modules.size;
  const totalModules = moduleCount + QUIET_ZONE * 2;
  const modulePx = Math.floor(CANVAS_SIZE / totalModules);
  const qrPx = modulePx * totalModules; // actual rendered QR area

  // ── Step 2: build output canvas ───────────────────────────────────────────
  const totalW = qrPx + framePad * 2;
  const totalH = qrPx + framePad * 2 + topH + botH;

  const canvas = document.createElement('canvas');
  canvas.width  = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d')!;

  // `bgColor` backs the logo zone so a logo stays legible even on a transparent QR.
  // When transparent, leave the canvas unpainted so light modules are see-through.
  const bgColor = opts.transparent ? '#FFFFFF' : opts.lightColor;
  if (!opts.transparent) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, totalW, totalH);
  }

  // ── Step 3: measure logo zone ─────────────────────────────────────────────
  const qrOriginX = framePad;
  const qrOriginY = topH + framePad;
  const cx = qrOriginX + qrPx / 2;
  const cy = qrOriginY + qrPx / 2;

  let drawBox  = { x: 0, y: 0, w: 0, h: 0 }; // white bg / logo draw area
  let skipBox  = { x: 0, y: 0, w: 0, h: 0 }; // module skip area (slightly larger)
  const SKIP_MARGIN = modulePx;               // 1 extra module on every side

  if (hasLogo) {
    drawBox = getLogoBounds(ctx, opts.logo, opts.customImage, cx, cy);
    skipBox = {
      x: drawBox.x - SKIP_MARGIN,
      y: drawBox.y - SKIP_MARGIN,
      w: drawBox.w + SKIP_MARGIN * 2,
      h: drawBox.h + SKIP_MARGIN * 2,
    };
  }

  // ── Step 4: draw QR modules, skipping any inside the (larger) skip zone ───
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!qr.modules.data[row * moduleCount + col]) continue;

      const px = qrOriginX + (col + QUIET_ZONE) * modulePx;
      const py = qrOriginY + (row + QUIET_ZONE) * modulePx;

      if (hasLogo) {
        const mcx = px + modulePx / 2;
        const mcy = py + modulePx / 2;
        if (
          mcx >= skipBox.x && mcx <= skipBox.x + skipBox.w &&
          mcy >= skipBox.y && mcy <= skipBox.y + skipBox.h
        ) continue;
      }

      ctx.fillStyle = opts.darkColor;
      ctx.fillRect(px, py, modulePx, modulePx);
    }
  }

  // ── Step 5: draw logo clipped to its box ──────────────────────────────────
  if (hasLogo) {
    const PAD    = 18;
    const RADIUS = 20;
    const { x: bx, y: by, w: bw, h: bh } = drawBox;

    // White rounded background filling the skip zone (covers any gap between draw/skip boxes)
    ctx.fillStyle = bgColor;
    roundedRect(ctx, skipBox.x, skipBox.y, skipBox.w, skipBox.h, RADIUS + SKIP_MARGIN);
    ctx.fill();

    // Clip subsequent drawing to the exact logo draw box
    ctx.save();
    roundedRect(ctx, bx, by, bw, bh, RADIUS);
    ctx.clip();

    // White inside clip (clean base)
    ctx.fillStyle = bgColor;
    ctx.fillRect(bx, by, bw, bh);

    if (opts.logo === 'scan-me') {
      const fontSize = CANVAS_SIZE * 0.054;
      const lineGap  = fontSize * 0.3;
      ctx.font         = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle    = opts.darkColor;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('SCAN', cx, by + PAD);
      ctx.fillText('ME',   cx, by + PAD + fontSize + lineGap);

    } else if (opts.logo === 'custom' && opts.customImage) {
      const maxSide = CANVAS_SIZE * 0.22;
      const iw = opts.customImage.naturalWidth  || opts.customImage.width;
      const ih = opts.customImage.naturalHeight || opts.customImage.height;
      const scale = Math.min(maxSide / iw, maxSide / ih);
      ctx.drawImage(opts.customImage, cx - (iw * scale) / 2, cy - (ih * scale) / 2, iw * scale, ih * scale);

    } else {
      // emoji — draw at a size guaranteed to fit inside the clipped box
      const availSize = Math.min(bw, bh) - PAD * 2;
      ctx.font         = `${availSize}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.logo, cx, cy);
    }

    ctx.restore();
  }

  // ── Step 6: frame border ──────────────────────────────────────────────────
  if (hasBorder) {
    ctx.strokeStyle = opts.darkColor;
    ctx.lineWidth   = 4;
    ctx.strokeRect(framePad / 2, topH + framePad / 2, qrPx + framePad, qrPx + framePad);
  }

  // ── Step 7: label bands ───────────────────────────────────────────────────
  const drawLabel = (y: number) => {
    ctx.fillStyle    = opts.darkColor;
    ctx.fillRect(0, y, totalW, LABEL_H);
    ctx.fillStyle    = '#FFFFFF';
    ctx.font         = `bold ${CANVAS_SIZE * 0.048}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCAN ME', totalW / 2, y + LABEL_H / 2);
  };
  if (labelTop)    drawLabel(0);
  if (labelBottom) drawLabel(totalH - LABEL_H);

  return canvas;
}

// ── File & clipboard helpers ──────────────────────────────────────────────────

async function downloadPng(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL('image/png');
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { save }      = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ filters: [{ name: 'PNG Image', extensions: ['png'] }], defaultPath: 'qrcode.png' });
    if (!path) return;
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await writeFile(path, bytes);
  } else {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'qrcode.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

async function pickImageFile(): Promise<{ dataUrl: string; img: HTMLImageElement } | null> {
  let dataUrl = '';
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { open }      = await import('@tauri-apps/plugin-dialog');
    const { readFile }  = await import('@tauri-apps/plugin-fs');
    const selected = await open({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return null;
    const bytes  = await readFile(selected as string);
    const base64 = btoa(String.fromCharCode(...bytes));
    const ext    = (selected as string).split('.').pop()?.toLowerCase() ?? 'png';
    dataUrl = `data:image/${ext};base64,${base64}`;
  } else {
    dataUrl = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(''); return; }
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string) ?? '');
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
  if (!dataUrl) return null;
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = dataUrl; });
  return { dataUrl, img };
}

// ── UI constants ──────────────────────────────────────────────────────────────

const FRAME_OPTIONS: Array<{ value: FrameStyle; label: string }> = [
  { value: 'none',        label: 'None'        },
  { value: 'border',      label: 'Border'      },
  { value: 'scan-bottom', label: 'Label below' },
  { value: 'scan-top',    label: 'Label above' },
];

const LOGO_PRESETS: Array<{ value: LogoPreset; display: string }> = [
  { value: 'none',    display: '∅'       },
  { value: 'scan-me', display: 'SCAN\nME'},
  { value: '📱',      display: '📱'      },
  { value: '🔗',      display: '🔗'      },
  { value: '📶',      display: '📶'      },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function QRCodeTool() {
  const { config } = useAppConfig();
  const [text,        setText]        = usePersistentState('devtool:qrcode:text',        '');
  const [darkColor,   setDarkColor]   = usePersistentState('devtool:qrcode:dark',        '#000000');
  const [lightColor,  setLightColor]  = usePersistentState('devtool:qrcode:light',       '#FFFFFF');
  const [transparent, setTransparent] = usePersistentState('devtool:qrcode:transparent', false);
  const [frame,       setFrame]       = usePersistentState<FrameStyle>('devtool:qrcode:frame', 'none');
  const [logo,        setLogo]        = usePersistentState<LogoPreset>('devtool:qrcode:logo',  'none');

  const [customImageUrl, setCustomImageUrl] = useState('');
  const customImageRef = useRef<HTMLImageElement | null>(null);

  const [dataUrl, setDataUrl] = useState('');
  const [error,   setError]   = useState('');
  const [copied,  setCopied]  = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useQuickPaste(setText);
  useInputHistory(text, setText);

  useEffect(() => {
    let cancelled = false;
    renderToCanvas({ text, darkColor, lightColor, transparent, frame, logo, customImage: customImageRef.current })
      .then((c) => {
        if (cancelled) return;
        if (!c) { setDataUrl(''); setError(''); canvasRef.current = null; return; }
        canvasRef.current = c;
        setDataUrl(c.toDataURL('image/png'));
        setError('');
      })
      .catch(() => { if (!cancelled) { setError('Failed to generate QR code'); setDataUrl(''); } });
    return () => { cancelled = true; };
  }, [text, darkColor, lightColor, transparent, frame, logo, customImageUrl]);

  const handleUpload = async () => {
    try {
      const result = await pickImageFile();
      if (!result) return;
      customImageRef.current = result.img;
      setCustomImageUrl(result.dataUrl);
      setLogo('custom');
      setError('');
    } catch { setError('Failed to load image'); }
  };

  const clearCustomImage = () => {
    customImageRef.current = null;
    setCustomImageUrl('');
    setLogo('none');
  };

  const copyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej()), 'image/png')
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), config.editor.copyFeedbackMs);
    } catch { setError('Image clipboard not supported — use Download instead'); }
  };

  const chip = (active: boolean) =>
    cn('rounded border text-xs font-medium transition-colors cursor-pointer select-none',
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border bg-background hover:border-primary/60 hover:bg-muted/50');

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">

        <div className="space-y-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Enter text or URL — ${quickPasteHint}`}
            className="h-9"
          />
        </div>

        <div className="rounded-lg border divide-y text-sm">
          {/* Frame */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground font-medium">Frame</span>
            <div className="flex gap-1.5 flex-wrap">
              {FRAME_OPTIONS.map((f) => (
                <button key={f.value} onClick={() => setFrame(f.value)}
                  className={cn(chip(frame === f.value), 'px-2.5 py-1')}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logo */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground font-medium">Logo</span>
            <div className="flex gap-1.5 flex-wrap items-center">
              {LOGO_PRESETS.map((l) => (
                <button key={l.value}
                  onClick={() => { setLogo(l.value); if (l.value !== 'custom') { customImageRef.current = null; setCustomImageUrl(''); } }}
                  className={cn(chip(logo === l.value), 'px-2 py-1 leading-tight')}
                  style={{ minWidth: 38 }}>
                  {l.display.includes('\n')
                    ? <span className="flex flex-col items-center leading-none gap-px">
                        {l.display.split('\n').map((line, i) => <span key={i}>{line}</span>)}
                      </span>
                    : l.display}
                </button>
              ))}
              {customImageUrl
                ? <div className={cn(chip(logo === 'custom'), 'flex items-center gap-1 px-1.5 py-1')}>
                    <img src={customImageUrl} alt="logo" className="h-5 w-5 object-contain rounded" />
                    <button onClick={clearCustomImage} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                : <button onClick={handleUpload} className={cn(chip(false), 'flex items-center gap-1 px-2 py-1')}>
                    <Upload className="h-3 w-3" />
                    Upload
                  </button>
              }
            </div>
          </div>

          {/* Color */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="w-12 shrink-0 text-xs text-muted-foreground font-medium">Color</span>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="color" value={darkColor} onChange={(e) => setDarkColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0" />
                <span className="text-xs text-muted-foreground font-mono">{darkColor.toUpperCase()} QR</span>
              </label>
              <label className={cn('flex items-center gap-1.5 cursor-pointer', transparent && 'opacity-40')}>
                <input type="color" value={lightColor} disabled={transparent}
                  onChange={(e) => { setLightColor(e.target.value); setTransparent(false); }}
                  className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0 disabled:cursor-not-allowed" />
                <span className="text-xs text-muted-foreground font-mono">
                  {transparent ? 'Transparent' : `${lightColor.toUpperCase()} BG`}
                </span>
              </label>
              <button onClick={() => setTransparent((v) => !v)} className={cn(chip(transparent), 'px-2 py-1')}>
                Transparent BG
              </button>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {dataUrl && (
          <div className="space-y-3">
            <div className="flex justify-center p-6 rounded-xl border bg-background shadow-sm">
              <img src={dataUrl} alt="QR Code" className="max-w-full w-[280px]" />
            </div>
            <div className="flex gap-2">
              <Button onClick={copyImage} className="flex-1">
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copied!' : 'Copy Image'}
              </Button>
              <Button onClick={() => canvasRef.current && downloadPng(canvasRef.current)} variant="outline" className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Download PNG
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
