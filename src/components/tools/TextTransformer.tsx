import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

type TransformMode =
  | 'single-line'
  | 'multiple-lines'
  | 'array'
  | 'uppercase'
  | 'lowercase'
  | 'camelcase'
  | 'snakecase';

const MODE_OPTIONS: Array<{ value: TransformMode; label: string }> = [
  { value: 'single-line', label: 'To Single Line' },
  { value: 'multiple-lines', label: 'To Multiple Lines' },
  { value: 'array', label: 'To Array' },
  { value: 'uppercase', label: 'To UPPERCASE' },
  { value: 'lowercase', label: 'To lowercase' },
  { value: 'camelcase', label: 'To camelCase' },
  { value: 'snakecase', label: 'To snake_case' },
];

// Escape a single character for safe use inside a regex character class.
function escapeForCharClass(char: string) {
  return char.replace(/[\\\]^-]/g, '\\$&');
}

function splitWords(text: string) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function toCamelCase(text: string) {
  return splitWords(text)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('');
}

function toSnakeCase(text: string) {
  return splitWords(text)
    .map((word) => word.toLowerCase())
    .join('_');
}

function toSingleLine(text: string, removeLineWhitespace: boolean, removeChars: string) {
  let result = text;

  if (removeChars) {
    const charClass = [...new Set(removeChars.split(''))].map(escapeForCharClass).join('');
    if (charClass) {
      result = result.replace(new RegExp(`[${charClass}]`, 'g'), '');
    }
  }

  if (removeLineWhitespace) {
    // Trim each line and join directly, dropping the whitespace between lines.
    result = result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join('');
  } else {
    result = result.replace(/\r?\n/g, ' ');
  }

  return result.replace(/\s+/g, ' ').trim();
}

function toMultipleLines(text: string, delimiters: string) {
  const source = delimiters || ',;';
  const charClass = [...new Set(source.split(''))].map(escapeForCharClass).join('');
  if (!charClass) return text;

  return text
    .split(new RegExp(`[${charClass}]`))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function toArray(text: string) {
  const items = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return JSON.stringify(items, null, 2);
}

export function TextTransformer() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<TransformMode>('single-line');

  // Single line options
  const [removeLineWhitespace, setRemoveLineWhitespace] = useState(false);
  const [removeChars, setRemoveChars] = useState('');

  // Multiple lines options
  const [delimiters, setDelimiters] = useState(',;');

  const output = useMemo(() => {
    if (!input) return '';

    switch (mode) {
      case 'single-line':
        return toSingleLine(input, removeLineWhitespace, removeChars);
      case 'multiple-lines':
        return toMultipleLines(input, delimiters);
      case 'array':
        return toArray(input);
      case 'uppercase':
        return input.toUpperCase();
      case 'lowercase':
        return input.toLowerCase();
      case 'camelcase':
        return toCamelCase(input);
      case 'snakecase':
        return toSnakeCase(input);
      default:
        return input;
    }
  }, [input, mode, removeLineWhitespace, removeChars, delimiters]);

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Text Transformer</CardTitle>
        <CardDescription>
          Convert text between single line, multiple lines, arrays, and letter cases — updates live as you type
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as TransformMode)}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Select a transform" />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === 'single-line' && (
            <div className="flex flex-1 flex-wrap items-end gap-2">
              <Button
                type="button"
                variant={removeLineWhitespace ? 'default' : 'outline'}
                onClick={() => setRemoveLineWhitespace((value) => !value)}
              >
                Remove whitespace between lines
              </Button>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="remove-chars" className="text-xs text-muted-foreground">
                  Characters to remove
                </Label>
                <Input
                  id="remove-chars"
                  value={removeChars}
                  onChange={(event) => setRemoveChars(event.target.value)}
                  placeholder="e.g. ,.;!?-"
                  className="font-mono"
                />
              </div>
            </div>
          )}

          {mode === 'multiple-lines' && (
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="delimiters" className="text-xs text-muted-foreground">
                Split by delimiter characters (default: comma and semicolon)
              </Label>
              <Input
                id="delimiters"
                value={delimiters}
                onChange={(event) => setDelimiters(event.target.value)}
                placeholder=",;"
                className="font-mono"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Input Text</Label>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Enter text to transform"
            className="min-h-[150px]"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Output</Label>
            <Button onClick={copyOutput} size="sm" variant="ghost" disabled={!output}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
          </div>
          <Textarea
            value={output}
            readOnly
            placeholder="Result appears here"
            className={cn('min-h-[150px] font-mono')}
          />
        </div>
      </CardContent>
    </Card>
  );
}
