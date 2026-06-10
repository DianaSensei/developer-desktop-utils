import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';

export function UrlTool() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const encodeUrl = () => {
    const encoded = encodeURIComponent(input);
    setOutput(encoded);
  };

  const decodeUrl = () => {
    try {
      const decoded = decodeURIComponent(input);
      setOutput(decoded);
    } catch (error) {
      setOutput('Error: Invalid URL-encoded string');
    }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>URL Encoder/Decoder</CardTitle>
        <CardDescription>Encode or decode URL strings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to encode or URL-encoded text to decode"
            className="min-h-[120px] font-mono"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={encodeUrl} className="flex-1">
            Encode
          </Button>
          <Button onClick={decodeUrl} variant="outline" className="flex-1">
            Decode
          </Button>
        </div>

        {output && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Output</Label>
              <Button onClick={copyOutput} size="sm" variant="ghost">
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
