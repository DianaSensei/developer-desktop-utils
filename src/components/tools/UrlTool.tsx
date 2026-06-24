import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
import { ToolToolbar, ToolPanes, ToolPane, PaneHeader } from '@/components/ui/tool-layout';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';

type UrlMode = 'encode' | 'decode';

export function UrlTool() {
  const [input, setInput] = usePersistentState('devtool:url:input', '');
  const [mode, setMode] = usePersistentState<UrlMode>('devtool:url:mode', 'encode');

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  const output = useMemo(() => {
    if (!input) return '';
    try {
      return mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input);
    } catch {
      return 'Error: Invalid URL-encoded string';
    }
  }, [input, mode]);

  return (
    <div className="flex flex-col h-full">
      <ToolToolbar>
        <Segmented
          value={mode}
          onValueChange={(v) => setMode(v)}
          options={[
            { value: 'encode', label: 'Encode' },
            { value: 'decode', label: 'Decode' },
          ]}
          aria-label="URL mode"
        />
      </ToolToolbar>

      <ToolPanes>
        <ToolPane>
          <PaneHeader label="Input" hint={quickPasteHint} />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Enter text to ${mode}`}
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </ToolPane>

        <ToolPane>
          <PaneHeader
            label="Output"
            action={
              <CopyButton
                value={output}
                label="Copy"
                size="sm"
                variant="ghost"
                disabled={!output}
                className="h-6 px-2 text-xs rounded-lg"
                iconClassName="h-3 w-3"
              />
            }
          />
          <Textarea
            value={output}
            readOnly
            placeholder="Result appears here"
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </ToolPane>
      </ToolPanes>
    </div>
  );
}
