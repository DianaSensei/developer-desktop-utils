import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Copy } from 'lucide-react';

export function JsonFormatter() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  const formatJson = () => {
    try {
      const parsed = JSON.parse(input);
      const formatted = JSON.stringify(parsed, null, 2);
      setOutput(formatted);
      setIsValid(true);
      setError('');
    } catch (err) {
      setOutput('');
      setIsValid(false);
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const minifyJson = () => {
    try {
      const parsed = JSON.parse(input);
      const minified = JSON.stringify(parsed);
      setOutput(minified);
      setIsValid(true);
      setError('');
    } catch (err) {
      setOutput('');
      setIsValid(false);
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const validateJson = () => {
    try {
      JSON.parse(input);
      setIsValid(true);
      setError('');
      setOutput('Valid JSON!');
    } catch (err) {
      setIsValid(false);
      setError(err instanceof Error ? err.message : 'Invalid JSON');
      setOutput('');
    }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>JSON Formatter & Validator</CardTitle>
        <CardDescription>Format, minify, and validate JSON data</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input JSON</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"key": "value"}'
            className="min-h-[200px] font-mono text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={formatJson} className="flex-1">
            Format
          </Button>
          <Button onClick={minifyJson} variant="outline" className="flex-1">
            Minify
          </Button>
          <Button onClick={validateJson} variant="outline" className="flex-1">
            Validate
          </Button>
        </div>

        {isValid !== null && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg ${
              isValid ? 'bg-green-50 text-green-900 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-300'
            }`}
          >
            {isValid ? (
              <>
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Valid JSON</span>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5" />
                <span className="font-medium">Invalid JSON</span>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-900 dark:text-red-300 font-mono">{error}</p>
          </div>
        )}

        {output && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Output</Label>
              <Button onClick={copyOutput} size="sm" variant="ghost">
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
            <Textarea value={output} readOnly className="min-h-[200px] font-mono text-sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
