import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useQuickPaste } from '@/hooks/useQuickPaste';
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

  const result = useMemo(() => {
    if (!pattern) return { matches: [], error: '' };
    try {
      const regex = new RegExp(pattern, flags);
      const matches: RegExpMatchArray[] = [];
      if (flags.includes('g')) {
        let match;
        const globalRegex = new RegExp(pattern, flags);
        while ((match = globalRegex.exec(testString)) !== null) {
          matches.push(match);
        }
      } else {
        const match = testString.match(regex);
        if (match) matches.push(match);
      }
      return { matches, error: '' };
    } catch (err) {
      return { matches: [], error: err instanceof Error ? err.message : 'Invalid regex pattern' };
    }
  }, [pattern, flags, testString]);

  const hasResult = result.error || result.matches.length > 0 || (!result.error && pattern && testString);

  return (
    <div className="flex flex-col h-full">
      {/* Pattern + flags + preset chips */}
      <div className="shrink-0 border-b bg-background px-4 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">/</span>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="[a-z]+"
            className="flex-1 h-7 font-mono text-sm"
          />
          <span className="font-mono text-sm text-muted-foreground">/</span>
          <Input
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
            placeholder="g"
            className="w-16 h-7 font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {COMMON_PATTERNS.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => setPattern(p.pattern)}
              className="h-6 text-xs">
              {p.label}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            g = global · i = case-insensitive · m = multiline
          </span>
        </div>
      </div>

      {/* Test string — fills remaining space */}
      <div className="flex-1 min-h-0 flex flex-col min-h-0">
        <div className="shrink-0 px-4 py-1.5 border-b bg-muted/20 text-xs font-medium text-muted-foreground">
          Test String — Press ⌘V to paste
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
        <div className="shrink-0 border-t flex flex-col overflow-hidden" style={{ maxHeight: '40%' }}>
          <div className="shrink-0 px-4 py-1.5 border-b bg-muted/20 text-xs font-medium">
            {result.error ? (
              <span className="text-destructive">Error</span>
            ) : result.matches.length > 0 ? (
              <span className="text-green-600 dark:text-green-400">
                {result.matches.length} match{result.matches.length > 1 ? 'es' : ''}
              </span>
            ) : (
              <span className="text-muted-foreground">No matches</span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {result.error && (
              <div className="px-3 py-2 bg-destructive/10 rounded-md">
                <p className="font-mono text-sm text-destructive">{result.error}</p>
              </div>
            )}
            {result.matches.map((match, idx) => (
              <div key={idx} className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                <p className="font-mono text-sm text-green-900 dark:text-green-300">
                  Match {idx + 1}: &quot;{match[0]}&quot;
                </p>
                {match.length > 1 && (
                  <div className="mt-2 space-y-1">
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
              <div className="px-3 py-2 bg-muted rounded-md">
                <p className="text-sm text-muted-foreground">No matches found</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
