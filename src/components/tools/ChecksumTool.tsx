import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Copy, Upload, X, CheckCircle, XCircle } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

const ALGORITHMS = [
  { label: 'MD5',     id: 'md5'    },
  { label: 'SHA-1',   id: 'sha1'   },
  { label: 'SHA-256', id: 'sha256' },
  { label: 'SHA-512', id: 'sha512' },
] as const;

type AlgoId = (typeof ALGORITHMS)[number]['id'];
type Status  = 'idle' | 'hashing' | 'done' | 'error';

interface FileInfo { name: string; size: number }

const isTauri = '__TAURI_INTERNALS__' in window;

function formatBytes(n: number) {
  if (n === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${parseFloat((n / k ** i).toFixed(2))} ${s[i]}`;
}

export function ChecksumTool() {
  const [algo,     setAlgo]     = useState<AlgoId>('sha256');
  const [status,   setStatus]   = useState<Status>('idle');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [hash,     setHash]     = useState('');
  const [verify,   setVerify]   = useState('');
  const [dragging, setDragging] = useState(false);

  const inputRef     = useRef<HTMLInputElement>(null);
  const workerRef    = useRef<Worker | null>(null);   // web mode
  const jobRef       = useRef(0);                     // Tauri mode: stale-event guard
  const algoRef      = useRef<AlgoId>(algo);          // always current, safe for closures
  const fileRef      = useRef<File | null>(null);     // web mode re-hash
  const filePathRef  = useRef<string | null>(null);   // Tauri mode re-hash

  useEffect(() => { algoRef.current = algo; }, [algo]);

  // ─── Tauri: listen for window-level file drop events ────────────────────────
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === 'enter' || type === 'over') {
          setDragging(true);
        } else if (type === 'drop') {
          setDragging(false);
          const paths = (event.payload as { type: 'drop'; paths: string[] }).paths;
          if (paths?.[0]) startTauriHash(paths[0], algoRef.current);
        } else {
          setDragging(false);
        }
      });
    })();

    return () => unlisten?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Tauri: invoke Rust command, listen for progress events ─────────────────
  const startTauriHash = useCallback(async (path: string, algoId: AlgoId) => {
    filePathRef.current = path;
    const jobId = ++jobRef.current;

    setHash('');
    setVerify('');
    setProgress(0);
    setStatus('hashing');
    setFileInfo(null);

    const { listen }  = await import('@tauri-apps/api/event');
    const { invoke }  = await import('@tauri-apps/api/core');

    const unlistenInfo = await listen<FileInfo>('checksum:file-info', (e) => {
      if (jobRef.current !== jobId) return;
      setFileInfo(e.payload);
    });

    const unlistenProg = await listen<{ percent: number }>('checksum:progress', (e) => {
      if (jobRef.current !== jobId) return;
      setProgress(e.payload.percent);
    });

    try {
      const result = await invoke<string>('hash_file', { path, algo: algoId });
      if (jobRef.current !== jobId) return;
      setHash(result);
      setStatus('done');
    } catch {
      if (jobRef.current !== jobId) return;
      setStatus('error');
    } finally {
      unlistenInfo();
      unlistenProg();
    }
  }, []);

  // ─── Web mode: CryptoJS Worker with chunked reading ─────────────────────────
  const startWebHash = useCallback((f: File, algoId: AlgoId) => {
    fileRef.current = f;
    workerRef.current?.terminate();

    setFileInfo({ name: f.name, size: f.size });
    setHash('');
    setVerify('');
    setProgress(0);
    setStatus('hashing');

    const worker = new Worker(
      new URL('../../workers/checksum.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { type, percent, hash: h } = e.data;
      if (type === 'progress') {
        setProgress(percent);
      } else if (type === 'result') {
        setHash(h);
        setStatus('done');
        worker.terminate();
        workerRef.current = null;
      } else if (type === 'error') {
        setStatus('error');
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = () => {
      setStatus('error');
      workerRef.current = null;
    };

    worker.postMessage({ file: f, algo: algoId });
  }, []);

  // ─── Shared handlers ─────────────────────────────────────────────────────────
  const handleAlgoChange = (a: AlgoId) => {
    setAlgo(a);
    algoRef.current = a;
    // Re-hash the current file with the new algorithm
    if (isTauri && filePathRef.current) {
      startTauriHash(filePathRef.current, a);
    } else if (!isTauri && fileRef.current) {
      startWebHash(fileRef.current, a);
    }
  };

  const handleBrowse = useCallback(async () => {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const path = await open({ multiple: false, title: 'Select file to hash' }) as string | null;
      if (path) startTauriHash(path, algoRef.current);
    } else {
      inputRef.current?.click();
    }
  }, [startTauriHash]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (isTauri) return; // handled by Tauri window event
    const f = e.dataTransfer.files[0];
    if (f) startWebHash(f, algoRef.current);
  }, [startWebHash]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) startWebHash(f, algoRef.current);
  };

  const clear = () => {
    jobRef.current++;            // invalidates any in-flight Tauri job
    workerRef.current?.terminate();
    workerRef.current = null;
    fileRef.current     = null;
    filePathRef.current = null;
    setFileInfo(null);
    setHash('');
    setVerify('');
    setStatus('idle');
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  };

  const verifyNorm = verify.trim().toLowerCase();
  const hashMatch  = verifyNorm ? hash.toLowerCase() === verifyNorm : null;
  const algoLabel  = ALGORITHMS.find((a) => a.id === algo)!.label;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* Algorithm */}
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground font-medium">Algorithm</div>
          <div className="flex rounded-md border border-input overflow-hidden w-fit">
            {ALGORITHMS.map(({ label, id }) => (
              <button
                key={id}
                onClick={() => handleAlgoChange(id)}
                className={cn(
                  'px-3 py-1.5 text-xs font-mono transition-colors',
                  algo === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 — drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={handleBrowse}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30',
          )}
        >
          {/* hidden input only used in web mode */}
          {!isTauri && (
            <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
          )}
          <Upload className="h-8 w-8 text-muted-foreground/50" />
          <div className="text-center">
            <p className="text-sm font-medium">Drop a file here</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              or click to browse · <span className="font-mono">{algoLabel}</span> will be computed
            </p>
          </div>
        </div>

        {/* File info */}
        {fileInfo && (
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{fileInfo.name}</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(fileInfo.size)}</p>
            </div>
            <button
              onClick={clear}
              className="ml-3 shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Progress */}
        {status === 'hashing' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Computing {algoLabel}…
              </span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Result */}
        {status === 'done' && hash && (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/40 border-b">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {algoLabel}
                </span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1 font-mono text-xs break-all">{hash}</span>
                <button
                  onClick={() => copyToClipboard(hash)}
                  className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Verify */}
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                Verify — paste an expected hash to compare
              </div>
              <div className="relative">
                <Input
                  value={verify}
                  onChange={(e) => setVerify(e.target.value)}
                  placeholder="Paste a known hash…"
                  className="h-8 text-xs font-mono pr-8"
                />
                {verifyNorm && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {hashMatch
                      ? <CheckCircle className="h-4 w-4 text-green-500" />
                      : <XCircle   className="h-4 w-4 text-destructive" />}
                  </span>
                )}
              </div>
              {verifyNorm && (
                <p className={cn('text-xs', hashMatch
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-destructive')}>
                  {hashMatch ? 'Hashes match ✓' : 'Hashes do not match ✗'}
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'error' && (
          <p className="text-xs text-destructive">
            Failed to compute checksum. The file may be inaccessible.
          </p>
        )}

      </div>
    </div>
  );
}
