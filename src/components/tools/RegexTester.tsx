import { useDeferredValue, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

type ResultView = 'matches' | 'highlight' | 'extract' | 'replace';

const FLAG_DEFS = [
  { flag: 'g', title: 'Global — find all matches' },
  { flag: 'i', title: 'Case insensitive' },
  { flag: 'm', title: 'Multiline — ^ and $ match line boundaries' },
  { flag: 's', title: 'DotAll — . matches newlines' },
  { flag: 'u', title: 'Unicode mode' },
  { flag: 'y', title: 'Sticky — match from lastIndex only' },
];

const COMMON_PATTERNS = [
  { label: 'Email', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' },
  { label: 'URL', pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)' },
  { label: 'Phone (US)', pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}' },
  { label: 'IP', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b' },
  { label: 'Hex Color', pattern: '#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})' },
  { label: 'UUID', pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' },
  { label: 'ISO Date', pattern: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])' },
  { label: 'HTML Tag', pattern: '<\\/?([a-zA-Z][a-zA-Z0-9]*)(?:\\s[^>]*)?' },
  { label: 'MD Link', pattern: '\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)' },
  { label: 'JWT', pattern: 'ey[A-Za-z0-9_-]+\\.ey[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+' },
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
        // Non-capturing: (?:  (?=  (?!
        if (rest[0] === ':' || rest[0] === '=' || rest[0] === '!') { i += 2; continue; }
        // Lookbehind: (?<= or (?<!
        if (rest[0] === '<' && (rest[1] === '=' || rest[1] === '!')) { i += 2; continue; }
        // Named group: (?<name>
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

  const deferredTest = useDeferredValue(testString);

  const groupNames = useMemo(() => parseGroupNames(pattern), [pattern]);

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
      <div className="shrink-0 header-premium px-4 py-2.5 space-y-2.5">
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
        <div className="flex flex-wrap gap-1.5">
          {COMMON_PATTERNS.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => setPattern(p.pattern)} className="h-6 text-xs rounded-lg">
              {p.label}
            </Button>
          ))}
        </div>
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
          placeholder="Enter text to test against the pattern"
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Results panel */}
      {hasResult && (
        <div className="shrink-0 border-t border-border flex flex-col overflow-hidden" style={{ maxHeight: '45%' }}>
          {/* Status + view tabs */}
          <div className="shrink-0 px-1 border-b border-border bg-muted/10 flex items-center">
            {result.error ? (
              <span className="px-3 py-1.5 text-xs font-semibold text-destructive">Error</span>
            ) : (
              <>
                <span className={cn(
                  'shrink-0 px-3 py-1.5 text-xs font-semibold',
                  result.matches.length > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                )}>
                  {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                </span>
                <div className="flex items-center overflow-x-auto no-scrollbar">
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
                              pos {m.index}–{(m.index ?? 0) + m[0].length}
                            </span>
                          </div>
                          <p className="font-mono text-sm text-foreground break-all">&quot;{m[0]}&quot;</p>
                        </div>
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => copyToClipboard(m[0])}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      {m.length > 1 && (
                        <div className="mt-2 space-y-1 pl-2 border-l-2 border-green-300/60 dark:border-green-700/60">
                          {m.slice(1).map((g, gIdx) => {
                            const name = groupNames[gIdx];
                            return (
                              <div key={gIdx} className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-medium text-blue-700 dark:text-blue-400 bg-blue-100/80 dark:bg-blue-900/30 px-1.5 py-0.5 rounded shrink-0">
                                  {name ? `<${name}>` : `#${gIdx + 1}`}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground break-all">
                                  {g !== undefined ? `"${g}"` : <span className="opacity-40">undefined</span>}
                                </span>
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
            )}

            {/* Extract view — table of captured groups */}
            {!result.error && resultView === 'extract' && (
              result.matches.length === 0 ? (
                <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-lg">
                  <p className="text-sm text-muted-foreground">No matches to extract</p>
                </div>
              ) : !result.matches.some((m) => m.length > 1) ? (
                <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-lg space-y-1">
                  <p className="text-sm text-muted-foreground">No capturing groups in pattern.</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Add groups with <code className="font-mono">( )</code> or named groups with <code className="font-mono">{'(?<name>...)'}</code>
                  </p>
                </div>
              ) : (
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
              )
            )}

            {/* Replace view */}
            {!result.error && resultView === 'replace' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Replacement</label>
                  <Input
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder="$1, $2… or $<name> for named groups"
                    className="h-8 font-mono text-sm rounded-lg"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Use <code className="font-mono">$1</code>, <code className="font-mono">$2</code>… for backreferences · <code className="font-mono">{'$<name>'}</code> for named groups
                  </p>
                </div>
                {replaceResult.error ? (
                  <div className="px-3 py-2.5 bg-destructive/8 border border-destructive/20 rounded-lg">
                    <p className="font-mono text-sm text-destructive">{replaceResult.error}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-foreground">Result</label>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!replaceResult.output} onClick={() => copyToClipboard(replaceResult.output)}>
                        <Copy className="h-3 w-3 mr-1" />Copy
                      </Button>
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
