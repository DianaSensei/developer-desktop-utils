import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regex Tester</CardTitle>
        <CardDescription>Test and debug regular expressions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Regex Pattern</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="[a-z]+"
              className="font-mono"
            />
            <span className="text-muted-foreground">/</span>
            <Input
              value={flags}
              onChange={(e) => setFlags(e.target.value)}
              placeholder="g"
              className="w-20 font-mono"
            />
          </div>
          <p className="text-xs text-muted-foreground">Flags: g (global), i (case-insensitive), m (multiline)</p>
        </div>

        <div className="space-y-2">
          <Label>Common Patterns</Label>
          <div className="flex flex-wrap gap-2">
            {COMMON_PATTERNS.map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => setPattern(p.pattern)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Test String</Label>
          <Textarea
            value={testString}
            onChange={(e) => setTestString(e.target.value)}
            placeholder="Enter text to test — Press ⌘V to paste"
            className="min-h-[120px]"
          />
        </div>

        {result.error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-900 dark:text-red-300">{result.error}</p>
          </div>
        )}

        {result.matches.length > 0 && (
          <div className="space-y-2">
            <Label className="text-green-600 dark:text-green-400">
              Matches Found: {result.matches.length}
            </Label>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {result.matches.map((match, idx) => (
                <div key={idx} className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <p className="font-mono text-sm text-green-900 dark:text-green-300">
                    Match {idx + 1}: "{match[0]}"
                  </p>
                  {match.length > 1 && (
                    <div className="mt-2 space-y-1">
                      {match.slice(1).map((group, gIdx) => (
                        <p key={gIdx} className="text-xs font-mono text-muted-foreground">
                          Group {gIdx + 1}: "{group}"
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!result.error && result.matches.length === 0 && pattern && testString && (
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">No matches found</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
