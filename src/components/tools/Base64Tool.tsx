import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowDownUp, Copy } from 'lucide-react';

export function Base64Tool() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const encode = () => {
    try {
      const encoded = btoa(input);
      setOutput(encoded);
    } catch (error) {
      setOutput('Error: Invalid input for encoding');
    }
  };

  const decode = () => {
    try {
      const decoded = atob(input);
      setOutput(decoded);
    } catch (error) {
      setOutput('Error: Invalid base64 string');
    }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Base64 Encoder/Decoder</CardTitle>
        <CardDescription>Encode or decode text using Base64</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to encode or base64 to decode"
            className="min-h-[150px] font-mono"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={encode} className="flex-1">
            Encode
          </Button>
          <Button onClick={decode} variant="outline" className="flex-1">
            Decode
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Output</Label>
            <Button onClick={copyOutput} size="sm" variant="ghost">
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
          </div>
          <Textarea
            value={output}
            readOnly
            placeholder="Result will appear here"
            className="min-h-[150px] font-mono"
          />
        </div>
      </CardContent>
    </Card>
  );
}
