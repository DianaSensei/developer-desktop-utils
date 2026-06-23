import { useState, useRef, useCallback } from 'react';
import { Upload, X, AlertCircle, ClipboardPaste } from 'lucide-react';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useImagePaste } from '@/hooks/useImagePaste';
import { copyImageToClipboard, readImageFromClipboard } from '@/lib/clipboard';
import { quickPasteHint } from '@/hooks/useQuickPaste';

type Mode = 'encode' | 'decode';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

function normalizeBase64(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('data:')) return s;
  // Try to detect image type from base64 magic bytes
  try {
    const header = atob(s.slice(0, 16));
    if (header.startsWith('\x89PNG')) return `data:image/png;base64,${s}`;
    if (header.startsWith('\xFF\xD8')) return `data:image/jpeg;base64,${s}`;
    if (header.startsWith('GIF')) return `data:image/gif;base64,${s}`;
    if (header.startsWith('RIFF')) return `data:image/webp;base64,${s}`;
  } catch { /* */ }
  return `data:image/png;base64,${s}`;
}

export function ImageBase64Tool() {
  const [mode, setMode] = usePersistentState<Mode>('devtool:imgbase64:mode', 'encode');

  // Encode side
  const [encodeDataUrl, setEncodeDataUrl] = useState<string | null>(null);
  const [encodeFile, setEncodeFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Decode side
  const [decodeInput, setDecodeInput] = usePersistentState('devtool:imgbase64:input', '');
  const [decodeError, setDecodeError] = useState(false);

  const processImageFile = useCallback((f: File) => {
    if (!f.type.startsWith('image/')) return;
    setEncodeFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setEncodeDataUrl(e.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  // Load an image straight from a data URL (clipboard paste) and synthesize a
  // File so the size/type info line still renders.
  const loadFromDataUrl = useCallback((dataUrl: string) => {
    setEncodeDataUrl(dataUrl);
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((b) => {
        const ext = (b.type.split('/')[1] || 'png').split('+')[0];
        setEncodeFile(new File([b], `pasted-image.${ext}`, { type: b.type || 'image/png' }));
      })
      .catch(() => setEncodeFile(null));
  }, []);

  // ⌘V / Ctrl+V captures an image from the clipboard while on the encode tab.
  useImagePaste(loadFromDataUrl, mode === 'encode' && !encodeDataUrl);

  const pasteFromClipboard = useCallback(async () => {
    const dataUrl = await readImageFromClipboard();
    if (dataUrl) loadFromDataUrl(dataUrl);
  }, [loadFromDataUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processImageFile(f);
  }, [processImageFile]);

  const clearEncode = () => {
    setEncodeFile(null);
    setEncodeDataUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const base64Only = encodeDataUrl ? encodeDataUrl.split(',')[1] : '';

  const decodeSrc = decodeInput.trim() ? normalizeBase64(decodeInput.trim()) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* Mode tabs */}
        <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
          {([['encode', 'Image → Base64'], ['decode', 'Base64 → Image']] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-3 text-xs font-medium transition-all duration-150',
                mode === m ? 'bg-card text-foreground shadow-sm-premium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'encode' ? (
          <div className="space-y-3">
            {/* Drop zone */}
            {!encodeDataUrl ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) processImageFile(f); }}
                />
                <Upload className="h-8 w-8 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="text-sm font-medium">Drop an image here</p>
                  <p className="text-xs text-muted-foreground mt-0.5">or click to browse · PNG, JPG, GIF, WebP…</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void pasteFromClipboard(); }}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Paste from clipboard · {quickPasteHint}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Preview */}
                <div className="relative rounded-lg border bg-muted/20 p-3 flex items-center justify-center min-h-[160px]">
                  <img src={encodeDataUrl} alt="preview" className="max-h-48 max-w-full rounded object-contain" />
                  <button
                    onClick={clearEncode}
                    className="absolute top-2 right-2 p-1 rounded-md bg-background/80 border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* File info */}
                {encodeFile && (
                  <p className="text-[10px] text-muted-foreground">
                    {encodeFile.name} · {formatBytes(encodeFile.size)} · {encodeFile.type}
                  </p>
                )}

                {/* Base64 output */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Base64 (raw, without data URL prefix)</span>
                    <div className="flex gap-1.5">
                      <CopyButton
                        value={base64Only}
                        label="Copy raw"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                        iconClassName="h-3 w-3"
                      />
                      <CopyButton
                        value={() => encodeDataUrl ?? ''}
                        label="Copy data URL"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                        iconClassName="h-3 w-3"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 max-h-36 overflow-y-auto">
                    <p className="font-mono text-[10px] break-all text-foreground/80 leading-relaxed">{base64Only}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Base64 length: {base64Only.length.toLocaleString()} chars · ~{formatBytes(Math.ceil(base64Only.length * 0.75))}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Input */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Paste base64 string or data URL</span>
              <textarea
                value={decodeInput}
                onChange={(e) => { setDecodeInput(e.target.value); setDecodeError(false); }}
                placeholder="data:image/png;base64,iVBORw0KGgo… or raw base64"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[10px] leading-relaxed resize-none h-24 outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Rendered image */}
            {decodeSrc && (
              <div className="relative rounded-lg border bg-muted/20 p-3 flex items-center justify-center min-h-[160px]">
                <img
                  src={decodeSrc}
                  alt="decoded"
                  className="max-h-64 max-w-full rounded object-contain"
                  onError={() => setDecodeError(true)}
                  onLoad={() => setDecodeError(false)}
                />
                {!decodeError && (
                  <CopyButton
                    copyAction={async () => {
                      try {
                        await copyImageToClipboard(decodeSrc);
                        return true;
                      } catch {
                        return false;
                      }
                    }}
                    label="Copy image"
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-7 bg-background/80 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                    iconClassName="h-3 w-3"
                  />
                )}
              </div>
            )}

            {decodeError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                <p className="text-xs text-destructive">Could not render image — invalid or unsupported base64.</p>
              </div>
            )}

            {!decodeInput.trim() && (
              <p className="text-xs text-muted-foreground">The image will appear here as you paste base64.</p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
