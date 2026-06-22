import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

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
        <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
          {([['encode', 'Encode'], ['decode', 'Decode']] as [UrlMode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-4 text-xs font-medium transition-all duration-150',
                mode === m ? 'bg-card text-foreground shadow-sm-premium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
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
            <Button
              onClick={() => copyToClipboard(output)}
              size="sm"
              variant="ghost"
              disabled={!output}
              className="h-6 px-2 text-xs rounded-lg"
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </Button>
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
