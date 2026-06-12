import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import * as Diff from 'diff';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

export function TextDiff() {
  const [text1, setText1] = usePersistentState('devtool:diff:text1', '');
  const [text2, setText2] = usePersistentState('devtool:diff:text2', '');

  useInputHistory(text1, setText1);

  const diffResult = useMemo(() => Diff.diffWords(text1, text2), [text1, text2]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Text Diff Compare</CardTitle>
        <CardDescription>Compare two texts and see the differences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Original Text</Label>
            <Textarea
              value={text1}
              onChange={(e) => setText1(e.target.value)}
              placeholder="Enter original text"
              className="min-h-[200px] font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Modified Text</Label>
            <Textarea
              value={text2}
              onChange={(e) => setText2(e.target.value)}
              placeholder="Enter modified text"
              className="min-h-[200px] font-mono text-sm"
            />
          </div>
        </div>

        {(text1 || text2) && (
          <div className="space-y-2">
            <Label>Diff Result</Label>
            <div className="border rounded-md p-4 bg-muted/30 min-h-[150px] overflow-auto">
              <pre className="font-mono text-sm whitespace-pre-wrap">
                {diffResult.map((part, index) => {
                  const color = part.added
                    ? 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-200'
                    : part.removed
                    ? 'bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200'
                    : '';
                  return (
                    <span key={index} className={color}>
                      {part.value}
                    </span>
                  );
                })}
              </pre>
            </div>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-200 dark:bg-red-900/40 rounded" />
                <span>Removed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-200 dark:bg-green-900/40 rounded" />
                <span>Added</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
