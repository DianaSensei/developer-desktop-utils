import { useState, useCallback } from 'react';
import { Upload, X, AlertCircle, ClipboardPaste } from 'lucide-react';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
import { DropZone } from '@/components/ui/drop-zone';
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

  // Load an image straight from a data URL (clipboard paste, or an OS file drop
  // read through Tauri) and synthesize a File so the size/type info line still
  // renders. `name` is used when known (dropped files); paste falls back to a
  // generic name.
  const loadFromDataUrl = useCallback((dataUrl: string, name?: string) => {
    setEncodeDataUrl(dataUrl);
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((b) => {
        const ext = (b.type.split('/')[1] || 'png').split('+')[0];
        setEncodeFile(new File([b], name ?? `pasted-image.${ext}`, { type: b.type || 'image/png' }));
      })
      .catch(() => setEncodeFile(null));
  }, []);

  // OS file drop (Finder / Explorer) under Tauri: read the dropped path into a
  // data URL via the backend, then load it like any other image.
  const loadFromPath = useCallback(async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const file = await invoke<{ name: string; mime: string; dataUrl: string }>(
        'read_file_data_url',
        { path },
      );
      if (!file.mime.startsWith('image/')) return; // ignore non-images
      loadFromDataUrl(file.dataUrl, file.name);
    } catch {
      /* unreadable / too large — ignore */
    }
  }, [loadFromDataUrl]);

  // ⌘V / Ctrl+V captures an image from the clipboard while on the encode tab.
  useImagePaste(loadFromDataUrl, mode === 'encode' && !encodeDataUrl);

  const pasteFromClipboard = useCallback(async () => {
    const dataUrl = await readImageFromClipboard();
    if (dataUrl) loadFromDataUrl(dataUrl);
  }, [loadFromDataUrl]);

  const clearEncode = () => {
    setEncodeFile(null);
    setEncodeDataUrl(null);
  };

  const base64Only = encodeDataUrl ? encodeDataUrl.split(',')[1] : '';

  const decodeSrc = decodeInput.trim() ? normalizeBase64(decodeInput.trim()) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* Mode tabs */}
        <Segmented
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'encode', label: 'Image → Base64' },
            { value: 'decode', label: 'Base64 → Image' },
          ]}
          aria-label="Image/Base64 mode"
        />

        {mode === 'encode' ? (
          <div className="space-y-3">
            {/* Drop zone */}
            {!encodeDataUrl ? (
              <DropZone
                icon={Upload}
                title="Drop an image here"
                hint="or click to browse · PNG, JPG, GIF, WebP…"
                accept="image/*"
                onFiles={(files) => { const f = files[0]; if (f) processImageFile(f); }}
                onPaths={(paths) => { if (paths[0]) void loadFromPath(paths[0]); }}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void pasteFromClipboard(); }}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Paste from clipboard · {quickPasteHint}
                </button>
              </DropZone>
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
