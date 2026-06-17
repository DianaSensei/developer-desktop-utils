import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Copy, RefreshCw } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';

type Mode = 'uuid' | 'number' | 'text';

const CHARSETS = {
  lower:   'abcdefghijklmnopqrstuvwxyz',
  upper:   'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits:  '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
} as const;

type CharsetKey = keyof typeof CHARSETS;

function randomText(length: number, charset: string): string {
  if (!charset) return '';
  let result = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) {
    result += charset[arr[i] % charset.length];
  }
  return result;
}

function randomNumber(min: number, max: number, decimals: number): string {
  const range = max - min;
  const val = min + Math.random() * range;
  return decimals === 0 ? Math.floor(val).toString() : val.toFixed(decimals);
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function ResultList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{items.length} result{items.length !== 1 ? 's' : ''}</span>
        {items.length > 1 && (
          <button
            onClick={() => copyToClipboard(items.join('\n'))}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="h-3 w-3" /> Copy all
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 group hover:bg-muted/40 transition-colors">
            <span className="flex-1 font-mono text-xs break-all">{v}</span>
            <button
              onClick={() => copyToClipboard(v)}
              className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GeneratorTool() {
  const { config } = useAppConfig();
  const { maxNumberCount, maxTextCount, maxTextLength } = config.generator;
  const [mode, setMode] = usePersistentState<Mode>('devtool:gen:mode', 'uuid');
  const [count, setCount] = usePersistentState('devtool:gen:count', 1);
  const [results, setResults] = useState<string[]>([]);

  // UUID
  const generateUuids = useCallback(() => {
    setResults(Array.from({ length: clamp(count, 1, 100) }, () => uuidv4()));
  }, [count]);

  // Number
  const [numMin, setNumMin] = usePersistentState('devtool:gen:numMin', 0);
  const [numMax, setNumMax] = usePersistentState('devtool:gen:numMax', 100);
  const [decimals, setDecimals] = usePersistentState('devtool:gen:decimals', 0);

  const generateNumbers = useCallback(() => {
    const min = Math.min(numMin, numMax);
    const max = Math.max(numMin, numMax);
    const dec = clamp(decimals, 0, 10);
    setResults(Array.from({ length: clamp(count, 1, maxNumberCount) }, () => randomNumber(min, max, dec)));
  }, [count, numMin, numMax, decimals, maxNumberCount]);

  // Text
  const [textLen, setTextLen] = usePersistentState('devtool:gen:textLen', 16);
  const [charsets, setCharsets] = usePersistentState<Record<CharsetKey, boolean>>('devtool:gen:charsets', {
    lower: true, upper: true, digits: true, symbols: false,
  });
  const [customChars, setCustomChars] = usePersistentState('devtool:gen:customChars', '');

  const toggleCharset = (key: CharsetKey) => setCharsets((prev) => ({ ...prev, [key]: !prev[key] }));

  const generateText = useCallback(() => {
    let charset = (Object.keys(CHARSETS) as CharsetKey[]).filter((k) => charsets[k]).map((k) => CHARSETS[k]).join('');
    if (customChars) charset += customChars;
    if (!charset) return;
    setResults(Array.from({ length: clamp(count, 1, maxTextCount) }, () => randomText(clamp(textLen, 1, maxTextLength), charset)));
  }, [count, charsets, customChars, textLen, maxTextCount, maxTextLength]);

  const handleGenerate = () => {
    if (mode === 'uuid') generateUuids();
    else if (mode === 'number') generateNumbers();
    else generateText();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 border-b bg-background px-4 py-2 flex items-center gap-3">
        <div className="flex rounded-md border p-0.5 gap-0.5">
          <ModeTab active={mode === 'uuid'}   onClick={() => setMode('uuid')}>UUID</ModeTab>
          <ModeTab active={mode === 'number'} onClick={() => setMode('number')}>Number</ModeTab>
          <ModeTab active={mode === 'text'}   onClick={() => setMode('text')}>Text</ModeTab>
        </div>

        {mode === 'uuid' && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Count</span>
            <Input type="number" min={1} max={100} value={count}
              onChange={(e) => setCount(clamp(parseInt(e.target.value) || 1, 1, 100))}
              className="h-7 text-xs w-20" />
          </div>
        )}

        {mode === 'number' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Min</span>
              <Input type="number" value={numMin} onChange={(e) => setNumMin(parseFloat(e.target.value) || 0)} className="h-7 text-xs w-20" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Max</span>
              <Input type="number" value={numMax} onChange={(e) => setNumMax(parseFloat(e.target.value) || 0)} className="h-7 text-xs w-20" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Decimals</span>
              <Input type="number" min={0} max={10} value={decimals} onChange={(e) => setDecimals(clamp(parseInt(e.target.value) || 0, 0, 10))} className="h-7 text-xs w-16" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Count</span>
              <Input type="number" min={1} max={maxNumberCount} value={count} onChange={(e) => setCount(clamp(parseInt(e.target.value) || 1, 1, maxNumberCount))} className="h-7 text-xs w-20" />
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Length</span>
              <Input type="number" min={1} max={maxTextLength} value={textLen} onChange={(e) => setTextLen(clamp(parseInt(e.target.value) || 1, 1, maxTextLength))} className="h-7 text-xs w-20" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Count</span>
              <Input type="number" min={1} max={maxTextCount} value={count} onChange={(e) => setCount(clamp(parseInt(e.target.value) || 1, 1, maxTextCount))} className="h-7 text-xs w-20" />
            </div>
            <div className="flex gap-1.5">
              {(Object.keys(CHARSETS) as CharsetKey[]).map((k) => (
                <button key={k} onClick={() => toggleCharset(k)}
                  className={cn('rounded border px-2 py-0.5 text-xs font-medium transition-colors',
                    charsets[k] ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>
                  {k === 'lower' ? 'a–z' : k === 'upper' ? 'A–Z' : k === 'digits' ? '0–9' : '!@#'}
                </button>
              ))}
            </div>
            <Input value={customChars} onChange={(e) => setCustomChars(e.target.value)} placeholder="Custom chars" className="h-7 text-xs w-28 font-mono" />
          </div>
        )}

        <button
          onClick={handleGenerate}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <RefreshCw className="h-3 w-3" />Generate
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <ResultList items={results} />
        {!results.length && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Configure options above and click Generate
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
