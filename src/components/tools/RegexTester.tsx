import { useDeferredValue, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';

const COMMON_PATTERNS = [
  { label: 'Email', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' },
  { label: 'URL', pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)' },
  { label: 'Phone (US)', pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}' },
  { label: 'IP Address', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b' },
  { label: 'Hex Color', pattern: '#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})' },
];

export function RegexTester() {
  const [pattern, setPattern] = usePersistentState('devtool:regex:pattern', '');
  const [flags, setFlags] = usePersistentState('devtool:regex:flags', 'g');
  const [testString, setTestString] = usePersistentState('devtool:regex:testString', '');

  useQuickPaste(setTestString);
  useInputHistory(testString, setTestString);

  // Matching against a large test string runs on every keystroke. Defer the
  // test string so typing/editing the pattern stays responsive; the match
  // computation and results render happen at low priority.
  const deferredTest = useDeferredValue(testString);
  const result = useMemo(() => {
    if (!pattern) return { matches: [], error: '' };
    try {
      const regex = new RegExp(pattern, flags);
      const matches: RegExpMatchArray[] = [];
      if (flags.includes('g')) {
        // Cap results so a pattern that matches very often can't grow the
        // array (and the render) without bound.
        const MAX_MATCHES = 10_000;
        const globalRegex = new RegExp(pattern, flags);
        let match: RegExpExecArray | null;
        while ((match = globalRegex.exec(deferredTest)) !== null) {
          matches.push(match);
          // A zero-width match (e.g. /a*/, /\b/, /\s*/) leaves lastIndex
          // unchanged — without this nudge exec() would loop forever and
          // freeze the UI. Advance past it manually.
          if (match.index === globalRegex.lastIndex) {
            globalRegex.lastIndex++;
          }
          if (matches.length >= MAX_MATCHES) break;
        }
      } else {
        const match = deferredTest.match(regex);
        if (match) matches.push(match);
      }
      return { matches, error: '' };
    } catch (err) {
      return { matches: [], error: err instanceof Error ? err.message : 'Invalid regex pattern' };
    }
  }, [pattern, flags, deferredTest]);

  const hasResult = result.error || result.matches.length > 0 || (!result.error && pattern && deferredTest);

  return (
    <div className="flex flex-col h-full">
      {/* Pattern + flags + preset chips */}
      <div className="shrink-0 header-premium px-4 py-2.5 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground select-none">/</span>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="[a-z]+"
            className="flex-1 h-8 font-mono text-sm rounded-lg"
          />
          <span className="font-mono text-sm text-muted-foreground select-none">/</span>
          <Input
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            placeholder="g"
            className="w-16 h-8 font-mono text-sm rounded-lg"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {COMMON_PATTERNS.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => setPattern(p.pattern)}
              className="h-6 text-xs rounded-lg">
              {p.label}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground hidden sm:block">
            g = global · i = insensitive · m = multiline
          </span>
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
        <div className="shrink-0 border-t border-border flex flex-col overflow-hidden" style={{ maxHeight: '40%' }}>
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center gap-2">
            {result.error ? (
              <span className="text-xs font-semibold text-destructive">Error</span>
            ) : result.matches.length > 0 ? (
              <>
                <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                  {result.matches.length} match{result.matches.length > 1 ? 'es' : ''}
                </span>
                <span className="text-[11px] text-muted-foreground/60">found</span>
              </>
            ) : (
              <span className="text-xs font-medium text-muted-foreground">No matches</span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {result.error && (
              <div className="px-3 py-2.5 bg-destructive/8 border border-destructive/20 rounded-lg">
                <p className="font-mono text-sm text-destructive">{result.error}</p>
              </div>
            )}
            {result.matches.map((match, idx) => (
              <div key={idx} className="p-3 bg-green-50/80 dark:bg-green-950/20 border border-green-200/50 dark:border-green-900/30 rounded-lg">
                <p className="font-mono text-sm font-medium text-green-800 dark:text-green-300">
                  Match {idx + 1}: <span className="font-normal">&quot;{match[0]}&quot;</span>
                </p>
                {match.length > 1 && (
                  <div className="mt-2 space-y-1 pl-2 border-l border-green-300/50 dark:border-green-800/50">
                    {match.slice(1).map((group, gIdx) => (
                      <p key={gIdx} className="text-xs font-mono text-muted-foreground">
                        Group {gIdx + 1}: &quot;{group}&quot;
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!result.error && result.matches.length === 0 && (
              <div className="px-3 py-2.5 bg-muted/50 border border-border rounded-lg">
                <p className="text-sm text-muted-foreground">No matches found</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
