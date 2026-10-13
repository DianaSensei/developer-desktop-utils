import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Input } from '@/components/ui/input';
import { PaneHeader, ToolToolbar } from '@/components/ui/tool-layout';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Layers } from 'lucide-react';
import { DataTable, Thead, Tbody, Tr, Th, Td, DataTableStatus } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';
import MESSAGES from '@/components/tools/RegexTester.messages';

type ResultView = 'matches' | 'highlight' | 'extract' | 'replace';

/** Error produced by the tool itself; translated for display. */
const TOO_SLOW = '\u0000tooSlow';

interface Preset {
  label: string;
  pattern: string;
  sampleText: string;
  description: string;
}

const FLAG_DEFS = [
  { flag: 'g', title: 'Global — find all matches' },
  { flag: 'i', title: 'Case insensitive' },
  { flag: 'm', title: 'Multiline — ^ and $ match line boundaries' },
  { flag: 's', title: 'DotAll — . matches newlines' },
  { flag: 'u', title: 'Unicode mode' },
  { flag: 'y', title: 'Sticky — match from lastIndex only' },
];

const PRESETS: Preset[] = [
  {
    label: 'Email',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    sampleText: 'Reach us at hello@example.com or support@company.org\nBilling questions: billing@shop.io',
    description: 'Finds email addresses like hello@example.com',
  },
  {
    label: 'URL',
    pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)',
    sampleText: 'Docs: https://docs.example.com/guide#intro\nAlso see http://www.example.org and https://api.service.io/v2/data',
    description: 'Finds web links starting with http:// or https://',
  },
  {
    label: 'Phone (US)',
    pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}',
    sampleText: 'Call us: (555) 867-5309  or  800-555-1234  or  415.555.7890',
    description: 'Finds US phone numbers like (555) 867-5309',
  },
  {
    label: 'IP Address',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    sampleText: 'App server: 192.168.1.100  Gateway: 10.0.0.1  Public DNS: 8.8.8.8  Blocked: 203.0.113.42',
    description: 'Finds IPv4 addresses like 192.168.1.1',
  },
  {
    label: 'Hex Color',
    pattern: '#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})',
    sampleText: 'Primary: #3498DB  Accent: #E74C3C  Light: #fff  Dark background: #1a1a2e  Muted: #a0aec0',
    description: 'Finds CSS hex color codes like #3498DB or #fff',
  },
  {
    label: 'UUID',
    pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    sampleText: 'User: 550e8400-e29b-41d4-a716-446655440000\nOrder: f47ac10b-58cc-4372-a567-0e02b2c3d479\nSession: 6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    description: 'Finds UUIDs (universally unique identifiers)',
  },
  {
    label: 'ISO Date',
    pattern: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])',
    sampleText: 'Created: 2024-01-15  Updated: 2024-12-31  Expires: 2025-06-30  Invalid: 2024-13-01',
    description: 'Finds dates in YYYY-MM-DD format (ISO 8601)',
  },
  {
    label: 'HTML Tag',
    pattern: '<\\/?([a-zA-Z][a-zA-Z0-9]*)(?:\\s[^>]*)?>',
    sampleText: '<div class="card"><h2>Hello World</h2><p>Some <strong>bold</strong> text.</p><img src="photo.jpg" /></div>',
    description: 'Finds HTML tags like <div>, </div>, <img src="...">',
  },
  {
    label: 'MD Link',
    pattern: '\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)',
    sampleText: 'Check out [Google](https://www.google.com) and [GitHub](https://github.com) for resources.\nAlso see [MDN Docs](https://developer.mozilla.org).',
    description: 'Finds Markdown hyperlinks like [text](https://url.com)',
  },
  {
    label: 'JWT',
    pattern: 'ey[A-Za-z0-9_-]+\\.ey[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
    sampleText: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIiwiaWF0IjoxNzAwMDAwMH0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Finds JSON Web Tokens (used in API authentication headers)',
  },
];

// Rotate colors so adjacent matches differ and their boundary shows.
// Categorical encoding from the kit's --cat-* palette; text stays
// text-fg so contrast does not depend on the hue.
const MATCH_COLORS = [
  'bg-[hsl(var(--cat-1-c)/0.30)] text-fg',
  'bg-[hsl(var(--cat-2-c)/0.30)] text-fg',
  'bg-[hsl(var(--cat-3-c)/0.30)] text-fg',
  'bg-[hsl(var(--cat-4-c)/0.30)] text-fg',
  'bg-[hsl(var(--cat-5-c)/0.30)] text-fg',
];

const RESULT_VIEWS: { id: ResultView; label: string }[] = [
  { id: 'matches', label: 'Matches' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'extract', label: 'Extract' },
  { id: 'replace', label: 'Replace' },
];

interface MatchSegment {
  text: string;
  isMatch: boolean;
  matchIndex: number;
}

// Parse the pattern string to find the name of each capturing group in order.
// Returns an array where index i gives the name of capture group (i+1), or null if unnamed.
function parseGroupNames(pattern: string): (string | null)[] {
  const names: (string | null)[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '\\') { i += 2; continue; }
    if (pattern[i] === '[') {
      i++;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 2; else i++;
      }
      i++;
      continue;
    }
    if (pattern[i] === '(') {
      if (pattern[i + 1] === '?') {
        const rest = pattern.slice(i + 2);
        if (rest[0] === ':' || rest[0] === '=' || rest[0] === '!') { i += 2; continue; }
        if (rest[0] === '<' && (rest[1] === '=' || rest[1] === '!')) { i += 2; continue; }
        if (rest[0] === '<' && rest.length > 1 && /\w/.test(rest[1])) {
          const end = rest.indexOf('>', 1);
          if (end > 0) { names.push(rest.slice(1, end)); i += 3 + end; continue; }
        }
        i += 2; continue;
      }
      names.push(null);
    }
    i++;
  }
  return names;
}

export function RegexTester() {
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  const quickPasteHint = useQuickPasteHint();
  const sdk = usePluginSdkFor('regex');
  const [pattern, setPattern] = usePluginState(sdk, 'regex:pattern', '', { legacyKey: 'devtool:regex:pattern' });
  const [flags, setFlags] = usePluginState(sdk, 'regex:flags', 'g', { legacyKey: 'devtool:regex:flags' });
  const [testString, setTestString] = usePluginState(sdk, 'regex:testString', '', { legacyKey: 'devtool:regex:testString' });
  const [replacement, setReplacement] = usePluginState(sdk, 'regex:replacement', '', { legacyKey: 'devtool:regex:replacement' });
  const [resultView, setResultView] = usePluginState<ResultView>(sdk, 'regex:view', 'matches', { legacyKey: 'devtool:regex:view' });

  useQuickPaste(setTestString);
  useInputHistory(testString, setTestString);

  const toggleFlag = (flag: string) =>
    setFlags((prev: string) => (prev.includes(flag) ? prev.replace(flag, '') : prev + flag));

  const loadPreset = (p: Preset) => {
    setPattern(p.pattern);
    setTestString(p.sampleText);
    setResultView('matches');
  };

  const deferredTest = useDeferredValue(testString);

  const groupNames = useMemo(() => parseGroupNames(pattern), [pattern]);

  const activePreset = useMemo(
    () => PRESETS.find((p) => p.pattern === pattern) ?? null,
    [pattern]
  );

  // Regex evaluation runs in a Web Worker so a pathological pattern (ReDoS /
  // catastrophic backtracking) can't freeze the UI: a watchdog terminates the
  // worker if it doesn't answer in time. Matches come back serialized and are
  // rebuilt into array-with-`index` objects compatible with RegExpExecArray
  // access (`m[0]`, `m.slice(1)`, `m.index`, `m.length`).
  type EvalMatch = string[] & { index: number };
  const [result, setResult] = useState<{ matches: EvalMatch[]; error: string }>({ matches: [], error: '' });
  const [replaceResult, setReplaceResult] = useState<{ output: string; error: string }>({ output: '', error: '' });

  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const makeWorker = useCallback(() => {
    const w = new Worker(new URL('../../workers/regex.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }: MessageEvent<{ id: number; matches: { index: number; groups: (string | undefined)[] }[]; replaceOutput: string; error: string }>) => {
      if (data.id !== reqIdRef.current) return; // a newer request superseded this one
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      const matches = data.matches.map((m) => {
        // Unmatched optional groups come back as undefined; coerce to '' so the
        // shape matches RegExpExecArray's string element access used in render.
        const a = m.groups.map((g) => g ?? '') as EvalMatch;
        a.index = m.index;
        return a;
      });
      setResult({ matches, error: data.error });
      setReplaceResult({ output: data.error ? '' : data.replaceOutput, error: data.error });
    };
    workerRef.current = w;
    return w;
  }, []);

  useEffect(() => {
    makeWorker();
    return () => {
      workerRef.current?.terminate();
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  }, [makeWorker]);

  useEffect(() => {
    if (!pattern) {
      reqIdRef.current++;
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setResult({ matches: [], error: '' });
      setReplaceResult({ output: '', error: '' });
      return;
    }
    const id = ++reqIdRef.current;
    const worker = workerRef.current;
    if (!worker) return;
    worker.postMessage({ id, pattern, flags, input: deferredTest, replacement, doReplace: resultView === 'replace' });
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      worker.terminate();
      makeWorker();
      if (id === reqIdRef.current) {
        const msg = TOO_SLOW;
        setResult({ matches: [], error: msg });
        setReplaceResult({ output: '', error: msg });
      }
    }, 1500);
  }, [pattern, flags, deferredTest, replacement, resultView, makeWorker]);

  const stats = useMemo(() => {
    if (!result.matches.length || !deferredTest) return null;
    const chars = result.matches.reduce((sum, m) => sum + m[0].length, 0);
    const pct = deferredTest.length > 0
      ? ((chars / deferredTest.length) * 100).toFixed(1)
      : '0';
    return { chars, pct };
  }, [result.matches, deferredTest]);

  const highlightSegments = useMemo((): MatchSegment[] => {
    if (!deferredTest) return [];
    if (!result.matches.length) return [{ text: deferredTest, isMatch: false, matchIndex: -1 }];
    const segs: MatchSegment[] = [];
    let lastEnd = 0;
    for (let idx = 0; idx < result.matches.length; idx++) {
      const m = result.matches[idx];
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (start > lastEnd) segs.push({ text: deferredTest.slice(lastEnd, start), isMatch: false, matchIndex: -1 });
      if (m[0].length > 0) segs.push({ text: m[0], isMatch: true, matchIndex: idx });
      lastEnd = Math.max(lastEnd, end);
    }
    if (lastEnd < deferredTest.length) segs.push({ text: deferredTest.slice(lastEnd), isMatch: false, matchIndex: -1 });
    return segs;
  }, [result.matches, deferredTest]);

  // Pattern syntax errors are shown under the pattern; "too slow" is about
  // the test text, so it stays in the results pane.
  const patternError = result.error && result.error !== TOO_SLOW ? result.error : '';
  const hasResult = result.error || result.matches.length > 0 || (!result.error && pattern && deferredTest);

  return (
    <div className="flex flex-col h-full">
      {/* Pattern + Flags row */}
      <ToolToolbar className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-fg-mute select-none">/</span>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="[a-z]+"
            className={cn('flex-1 h-ctl font-mono text-sm rounded-sm', patternError && 'border-bad')}
            aria-invalid={!!patternError}
            aria-describedby={patternError ? 'regex-pattern-error' : undefined}
          />
          <span className="font-mono text-sm text-fg-mute select-none">/</span>
          <div className="inline-flex h-ctl rounded-sm border border-line bg-bg-2/50 p-0.5 gap-px">
            {FLAG_DEFS.map(({ flag }) => (
              <button
                key={flag}
                type="button"
                title={m(`flag.${flag}` as 'flag.g')}
                aria-label={m(`flag.${flag}` as 'flag.g')}
                aria-pressed={flags.includes(flag)}
                onClick={() => toggleFlag(flag)}
                className={cn(
                  'w-6 rounded-md font-mono text-xs font-medium transition-all duration-150',
                  flags.includes(flag)
                    ? 'bg-acc/10 text-acc-ink'
                    : 'text-fg-mute hover:text-fg'
                )}
              >
                {flag}
              </button>
            ))}
          </div>
        </div>

        {/* A syntax error belongs next to the pattern, not at the bottom of
            the results pane. */}
        {patternError && (
          <p id="regex-pattern-error" role="alert" className="pl-4 font-mono text-xs text-bad">{patternError}</p>
        )}

        {/* Preset chips — clicking loads both pattern and sample text */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              aria-pressed={activePreset?.label === p.label}
              onClick={() => loadPreset(p)}
              className={cn(
                'h-6 text-xs rounded-lg transition-all',
                activePreset?.label === p.label &&
                  'border-acc/30 bg-acc/10 text-acc-ink hover:bg-acc/15 hover:text-acc-ink'
              )}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Active preset description — plain-language hint */}
        {activePreset && (
          <p className="text-[11px] text-fg-mute/80 leading-relaxed">
            {m(`preset.${activePreset.label}` as 'preset.Email')} · {m('presetReload')}
          </p>
        )}
      </ToolToolbar>

      {/* Test string — fills remaining space */}
      <div className="flex-1 min-h-0 flex flex-col">
        <PaneHeader label={m('testString')} hint={quickPasteHint} />
        <Textarea
          value={testString}
          onChange={(e) => setTestString(e.target.value)}
          placeholder={m('testPlaceholder')}
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Results panel */}
      {hasResult && (
        <div className="shrink-0 border-t border-line flex flex-col overflow-hidden" style={{ maxHeight: '45%' }}>
          {/* Status bar: count + stats + view tabs + copy-all */}
          <div className="shrink-0 px-1 border-b border-line bg-bg-2/10 flex items-center">
            {result.error ? (
              <span className="px-3 py-1.5 text-xs font-semibold text-bad">{c('error')}</span>
            ) : (
              <>
                {/* Match count + coverage stats */}
                <span className={cn(
                  'shrink-0 px-3 py-1.5 text-xs font-semibold whitespace-nowrap',
                  result.matches.length > 0 ? 'text-ok' : 'text-fg-mute'
                )}>
                  {m(result.matches.length === 1 ? 'matchCountOne' : 'matchCount', { n: result.matches.length })}
                  {stats && stats.chars > 0 && (
                    <span className="font-normal text-fg-mute">{m('matchStats', { chars: stats.chars, pct: stats.pct })}</span>
                  )}
                </span>
                {/* View tabs */}
                <div className="flex-1 min-w-0 flex items-center overflow-x-auto no-scrollbar">
                  {RESULT_VIEWS.map(({ id }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setResultView(id)}
                      className={cn(
                        'shrink-0 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                        resultView === id
                          ? 'text-fg border-acc'
                          : 'text-fg-mute hover:text-fg border-transparent'
                      )}
                    >
                      {m(`view.${id}`)}
                    </button>
                  ))}
                </div>
                {/* Copy all matches */}
                {result.matches.length > 0 && resultView === 'matches' && (
                  <CopyButton
                    value={() => result.matches.map((m) => m[0]).join('\n')}
                    icon={Layers}
                    label={c('copyAll')}
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-6 px-2 mr-1 text-xs"
                    iconClassName="h-3 w-3"
                  />
                )}
              </>
            )}
          </div>

          {/* Tab body */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {result.error === TOO_SLOW && (
              <div className="px-3 py-2.5 bg-bad/8 border border-bad/20 rounded-lg">
                <p className="font-mono text-sm text-bad">{m('tooSlow')}</p>
              </div>
            )}

            {/* Matches view */}
            {!result.error && resultView === 'matches' && (
              result.matches.length === 0 ? (
                <div className="px-3 py-2.5 bg-bg-2/50 border border-line rounded-lg">
                  <p className="text-sm text-fg-mute">{c('noMatches')}</p>
                </div>
              ) : (
                /* Matches as a grid, one ~26px row each, so `pos`/`len` compare down a
                   column. Columns are colored by type and headers name the unit
                   (`index`, `chars`); empty groups show an italic `NULL`. Capture
                   groups are columns, so the same group lines up across matches. */
                <div className="overflow-hidden rounded-sm border border-line">
                  <DataTable density="compact" className="font-mono">
                    <Thead sticky>
                      <Tr>
                        <Th className="w-10 whitespace-nowrap">#</Th>
                        {/* Fixed-width numeric columns; the value column takes the rest. */}
                        <Th className="w-20 whitespace-nowrap" align="right" sub="index" subTone="number">{m('pos')}</Th>
                        <Th className="w-20 whitespace-nowrap" align="right" sub="chars" subTone="number">{m('len')}</Th>
                        <Th className="w-full whitespace-nowrap" sub="string" subTone="string">{m('match')}</Th>
                        {groupNames.map((name, gIdx) => (
                          <Th key={gIdx} className="whitespace-nowrap" sub="string" subTone="string">
                            {name ? `<${name}>` : m('group', { n: gIdx + 1 })}
                          </Th>
                        ))}
                        <Th className="w-9" aria-label={c('copy')} />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {result.matches.map((m, idx) => (
                        <Tr key={idx}>
                          <Td className="text-fg-faint" numeric>{idx + 1}</Td>
                          <Td numeric tone="number">{m.index}</Td>
                          <Td numeric tone="number">{m[0].length}</Td>
                          <Td tone="string" className="max-w-[26rem] truncate" title={m[0]}>{m[0]}</Td>
                          {groupNames.map((_, gIdx) => {
                            const g = m[gIdx + 1];
                            return (
                              <Td key={gIdx} tone="string" className="max-w-[14rem] truncate" title={g ?? undefined}>
                                {g === undefined ? null : g}
                              </Td>
                            );
                          })}
                          <Td className="w-9 py-0">
                            <CopyButton value={m[0]} className="h-6 w-6" iconClassName="h-3 w-3" />
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                  <DataTableStatus
                    rows={result.matches.length}
                    note={`/${pattern}/${flags}`}
                  />
                </div>
              )
            )}

            {/* Highlight view */}
            {!result.error && resultView === 'highlight' && (
              <div className="space-y-2">
                {result.matches.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {MATCH_COLORS.slice(0, Math.min(result.matches.length, MATCH_COLORS.length)).map((color, idx) => (
                      <span key={idx} className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded', color)}>
                        {m('matchN', { n: idx + 1 })}{idx === MATCH_COLORS.length - 1 && result.matches.length > MATCH_COLORS.length ? `–${result.matches.length}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div className="font-mono text-sm whitespace-pre-wrap break-all leading-relaxed p-3 rounded-lg border border-line bg-bg-2/20 min-h-[80px]">
                  {highlightSegments.length === 0 && (
                    <span className="text-fg-mute/60">{m('enterTestString')}</span>
                  )}
                  {highlightSegments.map((seg, idx) =>
                    seg.isMatch ? (
                      <mark
                        key={idx}
                        title={`Match ${seg.matchIndex + 1}`}
                        className={cn('rounded-sm px-0.5', MATCH_COLORS[seg.matchIndex % MATCH_COLORS.length])}
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={idx}>{seg.text}</span>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Extract view — table of captured groups */}
            {!result.error && resultView === 'extract' && (
              result.matches.length === 0 ? (
                <div className="px-3 py-2.5 bg-bg-2/50 border border-line rounded-lg">
                  <p className="text-sm text-fg-mute">{m('noExtract')}</p>
                </div>
              ) : !result.matches.some((m) => m.length > 1) ? (
                <div className="space-y-3">
                  <div className="px-3 py-2.5 bg-bg-2/50 border border-line rounded-lg space-y-1">
                    <p className="text-sm text-fg-mute">{m('noGroups')}</p>
                    <p className="text-[11px] text-fg-mute/70">
                      {m('wrapToCapture')} <code className="font-mono">( )</code> {m('wrapToCaptureAfter')}
                    </p>
                  </div>
                  {/* Flat match list as a simple table when no groups */}
                  <DataTable density="compact" className="font-mono">
                    <Thead>
                      <Tr>
                        <Th className="whitespace-nowrap">#</Th>
                        <Th className="whitespace-nowrap">{m('pos')}</Th>
                        <Th className="whitespace-nowrap">{m('len')}</Th>
                        <Th className="whitespace-nowrap">{m('match')}</Th>
                      </Tr>
                    </Thead>
                    <Tbody zebra>
                      {result.matches.map((m, idx) => (
                        <Tr key={idx}>
                          <Td className="text-fg-mute">{idx + 1}</Td>
                          <Td className="text-fg-mute">{m.index}</Td>
                          <Td className="text-fg-mute">{m[0].length}</Td>
                          <Td className="max-w-[300px] truncate" title={m[0]}>{m[0]}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[11px] text-fg-mute">
                      {m(result.matches[0].length - 1 === 1 ? 'groupsPerMatchOne' : 'groupsPerMatch', { n: result.matches[0].length - 1 })}
                    </p>
                    <CopyButton
                      value={() => {
                        const header = ['#', m('pos'), m('match'), ...result.matches[0].slice(1).map((_, i) => groupNames[i] ? `<${groupNames[i]}>` : m('group', { n: i + 1 }))].join('\t');
                        const rows = result.matches.map((m, i) => [i + 1, m.index, m[0], ...m.slice(1).map(g => g ?? '')].join('\t'));
                        return [header, ...rows].join('\n');
                      }}
                      label={m('copyTable')}
                      variant="ghost"
                      size="sm"
                      className="h-5 px-2 text-[11px]"
                      iconClassName="h-2.5 w-2.5"
                    />
                  </div>
                  <DataTable density="compact" className="font-mono">
                    <Thead>
                      <Tr>
                        <Th className="whitespace-nowrap">#</Th>
                        <Th className="whitespace-nowrap">{m('pos')}</Th>
                        <Th className="whitespace-nowrap">{m('match')}</Th>
                        {result.matches[0].slice(1).map((_, gIdx) => (
                          <Th key={gIdx} className="whitespace-nowrap">
                            {groupNames[gIdx] ? `<${groupNames[gIdx]}>` : m('group', { n: gIdx + 1 })}
                          </Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody zebra>
                      {result.matches.map((m, idx) => (
                        <Tr key={idx}>
                          <Td className="text-fg-mute">{idx + 1}</Td>
                          <Td className="text-fg-mute">{m.index}</Td>
                          <Td className="max-w-[180px] truncate" title={m[0]}>{m[0]}</Td>
                          {m.slice(1).map((g, gIdx) => (
                            <Td key={gIdx} className="max-w-[160px] truncate" title={g ?? ''}>
                              {g !== undefined ? g : <span className="text-fg-mute/40">—</span>}
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                </div>
              )
            )}

            {/* Replace view */}
            {!result.error && resultView === 'replace' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-fg">{m('replacementText')}</label>
                  <Input
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder={m('replacementPlaceholder')}
                    className="h-ctl font-mono text-sm rounded-sm"
                  />
                  <p className="text-[11px] text-fg-mute">
                    {m('advanced')} <code className="font-mono">$1</code>, <code className="font-mono">$2</code>… {m('advancedGroups')} · <code className="font-mono">$&</code> {m('advancedWhole')} · <code className="font-mono">{'$<name>'}</code> {m('advancedNamed')}
                  </p>
                </div>
                {replaceResult.error ? (
                  <div className="px-3 py-2.5 bg-bad/8 border border-bad/20 rounded-lg">
                    <p className="font-mono text-sm text-bad">{replaceResult.error === TOO_SLOW ? m('tooSlow') : replaceResult.error}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-fg">
                        {c('result')}
                        {replaceResult.output !== deferredTest && (
                          <span className="ml-2 text-[11px] font-normal text-fg-mute">
                            {m('charsDelta', { from: deferredTest.length, to: replaceResult.output.length })}
                          </span>
                        )}
                      </label>
                      <CopyButton
                        value={replaceResult.output}
                        label={c('copy')}
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        iconClassName="h-3 w-3"
                        disabled={!replaceResult.output}
                      />
                    </div>
                    <Textarea
                      value={replaceResult.output}
                      readOnly
                      className="min-h-[80px] font-mono text-sm resize-none rounded-lg"
                      placeholder={m('resultPlaceholder')}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
