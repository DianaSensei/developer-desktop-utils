import { useDeferredValue, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';

type ResultView = 'matches' | 'highlight' | 'extract' | 'replace';

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

const MATCH_COLORS = [
  'bg-yellow-200/80 dark:bg-yellow-800/40 text-yellow-900 dark:text-yellow-200',
  'bg-blue-200/80 dark:bg-blue-800/40 text-blue-900 dark:text-blue-200',
  'bg-green-200/80 dark:bg-green-800/40 text-green-900 dark:text-green-200',
  'bg-purple-200/80 dark:bg-purple-800/40 text-purple-900 dark:text-purple-200',
  'bg-orange-200/80 dark:bg-orange-800/40 text-orange-900 dark:text-orange-200',
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
  const [pattern, setPattern] = usePersistentState('devtool:regex:pattern', '');
  const [flags, setFlags] = usePersistentState('devtool:regex:flags', 'g');
  const [testString, setTestString] = usePersistentState('devtool:regex:testString', '');
  const [replacement, setReplacement] = usePersistentState('devtool:regex:replacement', '');
  const [resultView, setResultView] = usePersistentState<ResultView>('devtool:regex:view', 'matches');

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

  const result = useMemo(() => {
    if (!pattern) return { matches: [] as RegExpExecArray[], error: '' };
    try {
      const MAX = 500;
      const matches: RegExpExecArray[] = [];
      if (flags.includes('g') || flags.includes('y')) {
        const re = new RegExp(pattern, flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(deferredTest)) !== null) {
          matches.push(m);
          if (m.index === re.lastIndex) re.lastIndex++;
          if (matches.length >= MAX) break;
        }
      } else {
        const m = new RegExp(pattern, flags).exec(deferredTest);
        if (m) matches.push(m);
      }
      return { matches, error: '' };
    } catch (err) {
      return { matches: [] as RegExpExecArray[], error: err instanceof Error ? err.message : 'Invalid regex' };
    }
  }, [pattern, flags, deferredTest]);

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

  const replaceResult = useMemo(() => {
    if (!pattern || !deferredTest) return { output: '', error: '' };
    try {
      return { output: deferredTest.replace(new RegExp(pattern, flags), replacement), error: '' };
    } catch (err) {
      return { output: '', error: err instanceof Error ? err.message : 'Error' };
    }
  }, [pattern, flags, deferredTest, replacement]);

  const hasResult = result.error || result.matches.length > 0 || (!result.error && pattern && deferredTest);

  return (
    <div className="flex flex-col h-full">
      {/* Pattern + Flags row */}
      <div className="shrink-0 header-premium px-4 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground select-none">/</span>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="[a-z]+"
            className={cn('flex-1 h-8 font-mono text-sm rounded-lg', result.error && 'border-destructive')}
          />
          <span className="font-mono text-sm text-muted-foreground select-none">/</span>
          <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5 gap-px">
            {FLAG_DEFS.map(({ flag, title }) => (
              <button
                key={flag}
                type="button"
                title={title}
                onClick={() => toggleFlag(flag)}
                className={cn(
                  'w-6 rounded-md font-mono text-xs font-medium transition-all duration-150',
                  flags.includes(flag)
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {flag}
              </button>
            ))}
          </div>
        </div>

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
                  'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
              )}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Active preset description — plain-language hint */}
        {activePreset && (
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            {activePreset.description} · click the chip again to reload sample text
          </p>
        )}
      </div>

      {/* Test string — fills remaining space */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Test String</span>
          <span className="text-[11px] text-muted-foreground/70">{quickPasteHint}</span>
        </div>
        <Textarea
          value={testString}
          onChange={(e) => setTestString(e.target.value)}
          placeholder="Paste or type text here, or pick a preset above to load an example"
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Results panel */}
      {hasResult && (
        <div className="shrink-0 border-t border-border flex flex-col overflow-hidden" style={{ maxHeight: '45%' }}>
          {/* Status bar: count + stats + view tabs + copy-all */}
          <div className="shrink-0 px-1 border-b border-border bg-muted/10 flex items-center">
            {result.error ? (
              <span className="px-3 py-1.5 text-xs font-semibold text-destructive">Error</span>
            ) : (
              <>
                {/* Match count + coverage stats */}
                <span className={cn(
                  'shrink-0 px-3 py-1.5 text-xs font-semibold whitespace-nowrap',
                  result.matches.length > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                )}>
                  {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                  {stats && stats.chars > 0 && (
                    <span className="font-normal text-muted-foreground"> · {stats.chars} chars · {stats.pct}%</span>
                  )}
                </span>
                {/* View tabs */}
                <div className="flex-1 min-w-0 flex items-center overflow-x-auto no-scrollbar">
                  {RESULT_VIEWS.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setResultView(id)}
                      className={cn(
                        'shrink-0 px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
                        resultView === id
                          ? 'text-foreground border-primary'
                          : 'text-muted-foreground hover:text-foreground border-transparent'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Copy all matches */}
                {result.matches.length > 0 && resultView === 'matches' && (
                  <CopyButton
                    value={() => result.matches.map((m) => m[0]).join('\n')}
                    icon={Layers}
                    label="Copy all"
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
            {result.error && (
              <div className="px-3 py-2.5 bg-destructive/8 border border-destructive/20 rounded-lg">
                <p className="font-mono text-sm text-destructive">{result.error}</p>
              </div>
            )}

            {/* Matches view */}
            {!result.error && resultView === 'matches' && (
              result.matches.length === 0 ? (
                <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-lg">
                  <p className="text-sm text-muted-foreground">No matches found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {result.matches.map((m, idx) => (
                    <div key={idx} className="p-3 bg-green-50/80 dark:bg-green-950/20 border border-green-200/50 dark:border-green-900/30 rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded">
                              #{idx + 1}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              pos {m.index}–{(m.index ?? 0) + m[0].length} · {m[0].length} char{m[0].length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <p className="font-mono text-sm text-foreground break-all">&quot;{m[0]}&quot;</p>
                        </div>
                        <CopyButton value={m[0]} className="h-6 w-6 shrink-0" iconClassName="h-3 w-3" />
                      </div>
                      {m.length > 1 && (
                        <div className="mt-2 space-y-1 pl-2 border-l-2 border-green-300/60 dark:border-green-700/60">
                          {m.slice(1).map((g, gIdx) => {
                            const name = groupNames[gIdx];
                            return (
                              <div key={gIdx} className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-medium text-blue-700 dark:text-blue-400 bg-blue-100/80 dark:bg-blue-900/30 px-1.5 py-0.5 rounded shrink-0">
                                  {name ? `<${name}>` : `Group ${gIdx + 1}`}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground break-all">
                                  {g !== undefined ? `"${g}"` : <span className="opacity-40">undefined</span>}
                                </span>
                                {g !== undefined && (
                                  <CopyButton value={g} className="h-5 w-5 shrink-0 ml-auto" iconClassName="h-2.5 w-2.5" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Highlight view */}
            {!result.error && resultView === 'highlight' && (
              <div className="space-y-2">
                {result.matches.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {MATCH_COLORS.slice(0, Math.min(result.matches.length, MATCH_COLORS.length)).map((color, idx) => (
                      <span key={idx} className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', color)}>
                        Match {idx + 1}{idx === MATCH_COLORS.length - 1 && result.matches.length > MATCH_COLORS.length ? `–${result.matches.length}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div className="font-mono text-sm whitespace-pre-wrap break-all leading-relaxed p-3 rounded-lg border border-border bg-muted/20 min-h-[80px]">
                  {highlightSegments.length === 0 && (
                    <span className="text-muted-foreground/60">Enter a test string above</span>
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
                <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-lg">
                  <p className="text-sm text-muted-foreground">No matches to extract</p>
                </div>
              ) : !result.matches.some((m) => m.length > 1) ? (
                <div className="space-y-3">
                  <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-lg space-y-1">
                    <p className="text-sm text-muted-foreground">No capturing groups — showing all matches.</p>
                    <p className="text-[11px] text-muted-foreground/70">
                      Wrap parts of your pattern in <code className="font-mono">( )</code> to capture them as groups.
                    </p>
                  </div>
                  {/* Flat match list as a simple table when no groups */}
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">#</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">Pos</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">Len</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.matches.map((m, idx) => (
                          <tr key={idx} className={cn('border-b border-border/50', idx % 2 === 0 && 'bg-muted/10')}>
                            <td className="px-3 py-1.5 text-muted-foreground">{idx + 1}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{m.index}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{m[0].length}</td>
                            <td className="px-3 py-1.5 text-foreground max-w-[300px] truncate" title={m[0]}>{m[0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[11px] text-muted-foreground">
                      {result.matches[0].length - 1} group{result.matches[0].length - 1 !== 1 ? 's' : ''} captured per match
                    </p>
                    <CopyButton
                      value={() => {
                        const header = ['#', 'Pos', 'Match', ...result.matches[0].slice(1).map((_, i) => groupNames[i] ? `<${groupNames[i]}>` : `Group ${i + 1}`)].join('\t');
                        const rows = result.matches.map((m, i) => [i + 1, m.index, m[0], ...m.slice(1).map(g => g ?? '')].join('\t'));
                        return [header, ...rows].join('\n');
                      }}
                      label="Copy table"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-2 text-[11px]"
                      iconClassName="h-2.5 w-2.5"
                    />
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">#</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">Pos</th>
                          <th className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">Match</th>
                          {result.matches[0].slice(1).map((_, gIdx) => (
                            <th key={gIdx} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">
                              {groupNames[gIdx] ? `<${groupNames[gIdx]}>` : `Group ${gIdx + 1}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.matches.map((m, idx) => (
                          <tr key={idx} className={cn('border-b border-border/50', idx % 2 === 0 && 'bg-muted/10')}>
                            <td className="px-3 py-1.5 text-muted-foreground">{idx + 1}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{m.index}</td>
                            <td className="px-3 py-1.5 text-foreground max-w-[180px] truncate" title={m[0]}>{m[0]}</td>
                            {m.slice(1).map((g, gIdx) => (
                              <td key={gIdx} className="px-3 py-1.5 text-foreground max-w-[160px] truncate" title={g ?? ''}>
                                {g !== undefined ? g : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* Replace view */}
            {!result.error && resultView === 'replace' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Replacement text</label>
                  <Input
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder="Type replacement text here, or leave empty to delete matches"
                    className="h-8 font-mono text-sm rounded-lg"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Advanced: <code className="font-mono">$1</code>, <code className="font-mono">$2</code>… insert captured groups · <code className="font-mono">$&</code> inserts the whole match · <code className="font-mono">{'$<name>'}</code> for named groups
                  </p>
                </div>
                {replaceResult.error ? (
                  <div className="px-3 py-2.5 bg-destructive/8 border border-destructive/20 rounded-lg">
                    <p className="font-mono text-sm text-destructive">{replaceResult.error}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-foreground">
                        Result
                        {replaceResult.output !== deferredTest && (
                          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                            {deferredTest.length} → {replaceResult.output.length} chars
                          </span>
                        )}
                      </label>
                      <CopyButton
                        value={replaceResult.output}
                        label="Copy"
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
                      placeholder="Result appears here"
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
