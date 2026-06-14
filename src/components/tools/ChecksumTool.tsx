import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, FileCheck, Upload, X } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import CryptoJS from 'crypto-js';

const ALGORITHMS = [
  { label: 'MD5',     id: 'md5' },
  { label: 'SHA-1',   id: 'sha1' },
  { label: 'SHA-256', id: 'sha256' },
  { label: 'SHA-512', id: 'sha512' },
] as const;

type AlgoId = (typeof ALGORITHMS)[number]['id'];

interface Result {
  [key: string]: string;
}

function computeChecksums(wordArray: CryptoJS.lib.WordArray): Result {
  return {
    md5:    CryptoJS.MD5(wordArray).toString(),
    sha1:   CryptoJS.SHA1(wordArray).toString(),
    sha256: CryptoJS.SHA256(wordArray).toString(),
    sha512: CryptoJS.SHA512(wordArray).toString(),
  };
}

function arrayBufferToWordArray(ab: ArrayBuffer): CryptoJS.lib.WordArray {
  const u8 = new Uint8Array(ab);
  const words: number[] = [];
  for (let i = 0; i < u8.length; i += 4) {
    words.push(
      ((u8[i] ?? 0) << 24) | ((u8[i + 1] ?? 0) << 16) | ((u8[i + 2] ?? 0) << 8) | (u8[i + 3] ?? 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words as unknown as number[], u8.length);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function ChecksumTool() {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((f: File) => {
    setFile(f);
    setResults(null);
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const ab = e.target?.result as ArrayBuffer;
      const wordArray = arrayBufferToWordArray(ab);
      setResults(computeChecksums(wordArray));
      setLoading(false);
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const clear = () => {
    setFile(null);
    setResults(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck className="h-4 w-4" />
          Checksum
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30'
          )}
        >
          <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
          <Upload className="h-8 w-8 text-muted-foreground/50" />
          <div className="text-center">
            <p className="text-sm font-medium">Drop a file here</p>
            <p className="text-xs text-muted-foreground mt-0.5">or click to browse</p>
          </div>
        </div>

        {/* File info */}
        {file && (
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{file.name}</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)} · {file.type || 'unknown type'}</p>
            </div>
            <button onClick={clear} className="ml-3 shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Computing checksums…
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="rounded-md border divide-y">
            {ALGORITHMS.map(({ label, id }) => (
              <div key={id} className="flex items-center gap-3 px-3 py-2.5 group">
                <span className="text-[10px] font-medium text-muted-foreground w-14 shrink-0">{label}</span>
                <span className="flex-1 font-mono text-xs break-all text-foreground">{results[id as AlgoId]}</span>
                <button
                  onClick={() => copyToClipboard(results[id as AlgoId])}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  );
}
