import { useDeferredValue, useMemo, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import * as Diff from 'diff';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';

export function TextDiff() {
  const [text1, setText1] = usePersistentState('devtool:diff:text1', '');
  const [text2, setText2] = usePersistentState('devtool:diff:text2', '');

  useInputHistory(text1, setText1);

  // With two equal panes, quick-paste fills whichever side was focused last
  // (defaulting to Original). It only fires when no field is focused — while
  // editing a pane, ⌘V pastes normally at the cursor.
  const activeSetter = useRef(setText1);
  useQuickPaste((text) => activeSetter.current(text));

  // Diffing is O(n·m) and runs on every keystroke. Defer it so typing in either
  // pane stays responsive — the textareas update instantly while the (heavier)
  // diff render happens at low priority and can be interrupted by further typing.
  const dText1 = useDeferredValue(text1);
  const dText2 = useDeferredValue(text2);
  const diffResult = useMemo(() => Diff.diffWords(dText1, dText2), [dText1, dText2]);

  return (
    <div className="flex flex-col h-full">
      {/* Two input columns */}
      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x overflow-hidden">
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 text-xs font-medium text-muted-foreground">
            Original
          </div>
          <Textarea
            value={text1}
            onChange={(e) => setText1(e.target.value)}
            onFocus={() => { activeSetter.current = setText1; }}
            placeholder={`Enter original text — ${quickPasteHint}`}
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </div>
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 text-xs font-medium text-muted-foreground">
            Modified
          </div>
          <Textarea
            value={text2}
            onChange={(e) => setText2(e.target.value)}
            onFocus={() => { activeSetter.current = setText2; }}
            placeholder={`Enter modified text — ${quickPasteHint}`}
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </div>
      </div>

      {/* Diff result panel */}
      {(text1 || text2) && (
        <div className="shrink-0 border-t flex flex-col" style={{ maxHeight: '35%' }}>
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between text-xs font-medium">
            <span>Diff Result</span>
            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-red-200 dark:bg-red-900/40" />
                Removed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-green-200 dark:bg-green-900/40" />
                Added
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <pre className="font-mono text-sm whitespace-pre-wrap">
              {diffResult.map((part, index) => {
                const cls = part.added
                  ? 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-200'
                  : part.removed
                  ? 'bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200'
                  : '';
                return <span key={index} className={cls}>{part.value}</span>;
              })}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
