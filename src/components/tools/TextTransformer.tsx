import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';

export function TextTransformer() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  const toSingleLine = () => {
    const singleLine = input.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    setOutput(singleLine);
  };

  const toMultipleLines = () => {
    const lines = input
      .split(/[,;]/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
    setOutput(lines);
  };

  const toArray = () => {
    const items = input
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const array = JSON.stringify(items, null, 2);
    setOutput(array);
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Text Transformer</CardTitle>
        <CardDescription>Convert text between single line, multiple lines, and arrays</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input Text</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to transform"
            className="min-h-[150px]"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button onClick={toSingleLine} variant="outline">
            To Single Line
          </Button>
          <Button onClick={toMultipleLines} variant="outline">
            To Multiple Lines
          </Button>
          <Button onClick={toArray} variant="outline">
            To Array
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
            <Textarea value={output} readOnly className="min-h-[150px] font-mono" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
