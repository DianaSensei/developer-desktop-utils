import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy } from 'lucide-react';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

type TransformMode =
  | 'single-line'
  | 'multiple-lines'
  | 'array'
  | 'uppercase'
  | 'lowercase'
  | 'camelcase'
  | 'snakecase';

const MODE_OPTIONS: Array<{ value: TransformMode; label: string }> = [
  { value: 'single-line',    label: 'To Single Line' },
  { value: 'multiple-lines', label: 'To Multiple Lines' },
  { value: 'array',          label: 'To Array' },
  { value: 'uppercase',      label: 'To UPPERCASE' },
  { value: 'lowercase',      label: 'To lowercase' },
  { value: 'camelcase',      label: 'To camelCase' },
  { value: 'snakecase',      label: 'To snake_case' },
];

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
  return splitWords(text).map((w) => w.toLowerCase()).join('_');
}

function toSingleLine(text: string, removeLineWhitespace: boolean, removeChars: string) {
  let result = text;
  if (removeChars) {
    const charClass = [...new Set(removeChars.split(''))].map(escapeForCharClass).join('');
    if (charClass) result = result.replace(new RegExp(`[${charClass}]`, 'g'), '');
  }
  if (removeLineWhitespace) {
    result = result.split(/\r?\n/).map((line) => line.trim()).join('');
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
  const [input, setInput] = usePersistentState('devtool:textTransform:input', '');
  const [mode, setMode] = usePersistentState<TransformMode>('devtool:textTransform:mode', 'single-line');
  const [removeLineWhitespace, setRemoveLineWhitespace] = usePersistentState('devtool:textTransform:removeLineWs', false);
  const [removeChars, setRemoveChars] = usePersistentState('devtool:textTransform:removeChars', '');
  const [delimiters, setDelimiters] = usePersistentState('devtool:textTransform:delimiters', ',;');

  const output = useMemo(() => {
    if (!input) return '';
    switch (mode) {
      case 'single-line':    return toSingleLine(input, removeLineWhitespace, removeChars);
      case 'multiple-lines': return toMultipleLines(input, delimiters);
      case 'array':          return toArray(input);
      case 'uppercase':      return input.toUpperCase();
      case 'lowercase':      return input.toLowerCase();
      case 'camelcase':      return toCamelCase(input);
      case 'snakecase':      return toSnakeCase(input);
      default:               return input;
    }
  }, [input, mode, removeLineWhitespace, removeChars, delimiters]);

  useQuickPaste((text) => setInput(text));
  useInputHistory(input, setInput);

  return (
    <div className="flex flex-col h-full">
      {/* Options toolbar */}
      <div className="shrink-0 header-premium px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={mode} onValueChange={(v) => setMode(v as TransformMode)}>
            <SelectTrigger className="h-8 w-52 text-xs rounded-lg">
              <SelectValue placeholder="Select transform" />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {mode === 'single-line' && (
            <>
              <Button
                type="button"
                size="sm"
                variant={removeLineWhitespace ? 'default' : 'outline'}
                onClick={() => setRemoveLineWhitespace((v) => !v)}
                className="h-8 text-xs rounded-lg"
              >
                Remove whitespace between lines
              </Button>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Remove chars</span>
                <Input
                  value={removeChars}
                  onChange={(e) => setRemoveChars(e.target.value)}
                  placeholder="e.g. ,.;!?"
                  className="h-8 w-32 font-mono text-xs rounded-lg"
                />
              </div>
            </>
          )}

          {mode === 'multiple-lines' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Split by</span>
              <Input
                value={delimiters}
                onChange={(e) => setDelimiters(e.target.value)}
                placeholder=",;"
                className="h-8 w-24 font-mono text-xs rounded-lg"
              />
            </div>
          )}
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
            placeholder="Enter text to transform"
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
