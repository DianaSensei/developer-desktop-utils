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
    <Card>
      <CardHeader>
        <CardTitle>URL Encoder / Decoder</CardTitle>
        <CardDescription>Encode or decode URL strings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={mode === 'encode' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setMode('encode')}
          >
            Encode
          </Button>
          <Button
            variant={mode === 'decode' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setMode('decode')}
          >
            Decode
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Input</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Enter text to ${mode} — ${quickPasteHint}`}
            className="min-h-[120px] font-mono"
          />
        </div>

        {output && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Output</Label>
              <Button onClick={() => copyToClipboard(output)} size="sm" variant="ghost">
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
            <Textarea value={output} readOnly className="min-h-[120px] font-mono" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
