import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
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
      {/* Toolbar */}
      <div className="shrink-0 header-premium px-4 py-2.5">
        <Segmented
          value={mode}
          onValueChange={(v) => setMode(v)}
          options={[
            { value: 'encode', label: 'Encode' },
            { value: 'decode', label: 'Decode' },
          ]}
          aria-label="URL mode"
        />
      </div>

      {/* Input / Output — each half of remaining height */}
      <div className="flex-1 min-h-0 grid grid-rows-2 divide-y divide-border overflow-hidden">
        {/* Input */}
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Input</span>
            <span className="text-[11px] text-muted-foreground/70">{quickPasteHint}</span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Enter text to ${mode}`}
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </div>

        {/* Output */}
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Output</span>
            <CopyButton
              value={output}
              label="Copy"
              size="sm"
              variant="ghost"
              disabled={!output}
              className="h-6 px-2 text-xs rounded-lg"
              iconClassName="h-3 w-3"
            />
          </div>
          <Textarea
            value={output}
            readOnly
            placeholder="Result appears here"
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </div>
      </div>
    </div>
  );
}
