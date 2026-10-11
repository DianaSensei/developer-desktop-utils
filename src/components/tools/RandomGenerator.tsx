import { useState, useCallback } from 'react';
import { usePluginConfig, usePluginSdkFor, usePluginState } from '@/platform';
import { Input } from '@/components/ui/input';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
import { RefreshCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { randomInt, randomString, randomUnitFloat } from '@/lib/secureRandom';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/Generator.messages';
import COMMON from '@/components/tools/common.messages';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { Button } from '@/components/ui/button';

type Mode = 'uuid' | 'number' | 'text';

const CHARSETS = {
  lower:   'abcdefghijklmnopqrstuvwxyz',
  upper:   'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits:  '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?',
} as const;

type CharsetKey = keyof typeof CHARSETS;

function randomNumber(min: number, max: number, decimals: number): string {
  // Integers are drawn inclusively across [min, max] — a "Min 1 / Max 6" die
  // has to be able to roll a 6. Decimal draws stay half-open at the top, which
  // is what a continuous range means.
  if (decimals === 0) return randomInt(min, max).toString();
  return (min + randomUnitFloat() * (max - min)).toFixed(decimals);
}

function ResultList({ items }: { items: string[] }) {
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-mute">{m(items.length === 1 ? 'result' : 'results', { n: items.length })}</span>
        {items.length > 1 && (
          <CopyButton
            value={() => items.join('\n')}
            label={c('copyAll')}
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px] text-fg-mute hover:text-fg"
            iconClassName="h-3 w-3"
          />
        )}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-line divide-y">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 group hover:bg-bg-2/40 transition-colors">
            <span className="flex-1 font-mono text-xs break-all">{v}</span>
            <CopyButton
              value={v}
              variant="ghost"
              className="shrink-0 h-6 w-6 p-0 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-fg-mute"
              iconClassName="h-3 w-3"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function RandomGenerator() {
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  const sdk = usePluginSdkFor('generator');
  const config = usePluginConfig();
  const { maxNumberCount, maxTextCount, maxTextLength } = config.generator;
  const [mode, setMode] = usePluginState<Mode>(sdk, 'gen:mode', 'uuid', { legacyKey: 'devtool:gen:mode' });
  const [count, setCount] = usePluginState(sdk, 'gen:count', 1, { legacyKey: 'devtool:gen:count' });
  const [results, setResults] = useState<string[]>([]);

  // UUID
  const generateUuids = useCallback(() => {
    setResults(Array.from({ length: clamp(count, 1, 100) }, () => uuidv4()));
  }, [count]);

  // Number
  const [numMin, setNumMin] = usePluginState(sdk, 'gen:numMin', 0, { legacyKey: 'devtool:gen:numMin' });
  const [numMax, setNumMax] = usePluginState(sdk, 'gen:numMax', 100, { legacyKey: 'devtool:gen:numMax' });
  const [decimals, setDecimals] = usePluginState(sdk, 'gen:decimals', 0, { legacyKey: 'devtool:gen:decimals' });

  const generateNumbers = useCallback(() => {
    const min = Math.min(numMin, numMax);
    const max = Math.max(numMin, numMax);
    const dec = clamp(decimals, 0, 10);
    setResults(Array.from({ length: clamp(count, 1, maxNumberCount) }, () => randomNumber(min, max, dec)));
  }, [count, numMin, numMax, decimals, maxNumberCount]);

  // Text
  const [textLen, setTextLen] = usePluginState(sdk, 'gen:textLen', 16, { legacyKey: 'devtool:gen:textLen' });
  const [charsets, setCharsets] = usePluginState<Record<CharsetKey, boolean>>(sdk, 'gen:charsets', {
    lower: true, upper: true, digits: true, symbols: false,
  }, { legacyKey: 'devtool:gen:charsets' });
  const [customChars, setCustomChars] = usePluginState(sdk, 'gen:customChars', '', { legacyKey: 'devtool:gen:customChars' });

  const toggleCharset = (key: CharsetKey) => setCharsets((prev) => ({ ...prev, [key]: !prev[key] }));

  const generateText = useCallback(() => {
    let charset = (Object.keys(CHARSETS) as CharsetKey[]).filter((k) => charsets[k]).map((k) => CHARSETS[k]).join('');
    if (customChars) charset += customChars;
    if (!charset) return;
    setResults(Array.from({ length: clamp(count, 1, maxTextCount) }, () => randomString(clamp(textLen, 1, maxTextLength), charset)));
  }, [count, charsets, customChars, textLen, maxTextCount, maxTextLength]);

  const handleGenerate = () => {
    if (mode === 'uuid') generateUuids();
    else if (mode === 'number') generateNumbers();
    else generateText();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 header-chrome px-4 py-2.5 flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'uuid', label: 'UUID' },
            { value: 'number', label: m('number') },
            { value: 'text', label: m('text') },
          ]}
          aria-label={m('modeLabel')}
        />

        {mode === 'uuid' && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-fg-mute">{m('count')}</span>
            <Input type="number" min={1} max={100} value={count}
              onChange={(e) => setCount(clamp(parseInt(e.target.value) || 1, 1, 100))}
              className="h-ctl text-xs w-20 rounded-sm" />
          </div>
        )}

        {mode === 'number' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-mute">{m('min')}</span>
              <Input type="number" value={numMin} onChange={(e) => setNumMin(parseFloat(e.target.value) || 0)} className="h-ctl text-xs w-20 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-mute">{m('max')}</span>
              <Input type="number" value={numMax} onChange={(e) => setNumMax(parseFloat(e.target.value) || 0)} className="h-ctl text-xs w-20 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-mute">{m('decimals')}</span>
              <Input type="number" min={0} max={10} value={decimals} onChange={(e) => setDecimals(clamp(parseInt(e.target.value) || 0, 0, 10))} className="h-ctl text-xs w-16 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-mute">{m('count')}</span>
              <Input type="number" min={1} max={maxNumberCount} value={count} onChange={(e) => setCount(clamp(parseInt(e.target.value) || 1, 1, maxNumberCount))} className="h-ctl text-xs w-20 rounded-sm" />
            </div>
          </div>
        )}

        {mode === 'text' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-mute">{m('length')}</span>
              <Input type="number" min={1} max={maxTextLength} value={textLen} onChange={(e) => setTextLen(clamp(parseInt(e.target.value) || 1, 1, maxTextLength))} className="h-ctl text-xs w-20 rounded-sm" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-fg-mute">{m('count')}</span>
              <Input type="number" min={1} max={maxTextCount} value={count} onChange={(e) => setCount(clamp(parseInt(e.target.value) || 1, 1, maxTextCount))} className="h-ctl text-xs w-20 rounded-sm" />
            </div>
            <div className="flex gap-1.5">
              {(Object.keys(CHARSETS) as CharsetKey[]).map((k) => (
                <ToggleChip key={k} pressed={charsets[k]} onPressedChange={() => toggleCharset(k)} className="px-2 font-mono">
                  {k === 'lower' ? 'a–z' : k === 'upper' ? 'A–Z' : k === 'digits' ? '0–9' : '!@#'}
                </ToggleChip>
              ))}
            </div>
            <Input value={customChars} onChange={(e) => setCustomChars(e.target.value)} placeholder={m('customChars')} className="h-ctl text-xs w-28 font-mono rounded-sm" />
          </div>
        )}

        <Button size="sm" onClick={handleGenerate} className="ml-auto h-ctl shrink-0 gap-1.5 rounded-sm text-xs">
          <RefreshCw className="h-3 w-3" />{c('generate')}
        </Button>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <ResultList items={results} />
        {!results.length && (
          <div className="flex items-center justify-center h-full text-fg-mute text-sm">
            {m('configureHint')}
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
