import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

type DedupeMode = 'preserve' | 'sort';

export function ArrayDeduplicator() {
  const [input, setInput] = usePersistentState('devtool:deduplicate:input', '');
  const [mode, setMode] = usePersistentState<DedupeMode>('devtool:deduplicate:mode', 'preserve');

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  const result = useMemo(() => {
    const lines = input
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const unique = mode === 'sort' ? [...new Set(lines)].sort() : [...new Set(lines)];
    return {
      output: unique.join('\n'),
      original: lines.length,
      unique: unique.length,
      removed: lines.length - unique.length,
    };
  }, [input, mode]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Array Deduplicator</CardTitle>
        <CardDescription>Remove duplicate items from arrays or lists</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={mode === 'preserve' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setMode('preserve')}
          >
            Preserve Order
          </Button>
          <Button
            variant={mode === 'sort' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setMode('sort')}
          >
            Deduplicate & Sort
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Input (one item per line)</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`apple\nbanana\napple\norange — ${quickPasteHint}`}
            className="min-h-[200px] font-mono"
          />
        </div>

        {input && (
          <>
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
              <div className="text-center">
                <p className="text-2xl font-bold">{result.original}</p>
                <p className="text-xs text-muted-foreground">Original</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{result.unique}</p>
                <p className="text-xs text-muted-foreground">Unique</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{result.removed}</p>
                <p className="text-xs text-muted-foreground">Removed</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Output</Label>
                <Button onClick={() => copyToClipboard(result.output)} size="sm" variant="ghost">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
              </div>
              <Textarea value={result.output} readOnly className="min-h-[200px] font-mono" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
