import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToolToolbar, ToolPanes, ToolPane, PaneHeader } from '@/components/ui/tool-layout';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';
import { cn } from '@/lib/utils';

type TransformMode =
  | 'single-line'
  | 'multiple-lines'
  | 'array'
  | 'uppercase'
  | 'lowercase'
  | 'camelcase'
  | 'snakecase'
  | 'vn-phone-new'
  | 'vn-phone-old';

const MODE_OPTIONS: Array<{ value: TransformMode; label: string }> = [
  { value: 'single-line',    label: 'To Single Line' },
  { value: 'multiple-lines', label: 'To Multiple Lines' },
  { value: 'array',          label: 'To Array' },
  { value: 'uppercase',      label: 'To UPPERCASE' },
  { value: 'lowercase',      label: 'To lowercase' },
  { value: 'camelcase',      label: 'To camelCase' },
  { value: 'snakecase',      label: 'To snake_case' },
  { value: 'vn-phone-new',   label: 'VN Phone → New (10-digit)' },
  { value: 'vn-phone-old',   label: 'VN Phone → Old (11-digit)' },
];

// Vietnamese mobile prefix migration (effective Sept 2018): 11-digit numbers
// became 10-digit. Keyed by the 3-digit "old" subscriber prefix (after the
// trunk 0) → the 2-digit "new" prefix. Covers Viettel, MobiFone, VinaPhone,
// Vietnamobile and Gmobile.
const VN_OLD_TO_NEW: Record<string, string> = {
  // Viettel
  '162': '32', '163': '33', '164': '34', '165': '35',
  '166': '36', '167': '37', '168': '38', '169': '39',
  // MobiFone
  '120': '70', '121': '79', '122': '77', '126': '76', '128': '78',
  // VinaPhone
  '123': '83', '124': '84', '125': '85', '127': '81', '129': '82',
  // Vietnamobile
  '186': '56', '188': '58',
  // Gmobile
  '199': '59',
};

const VN_NEW_TO_OLD: Record<string, string> = Object.fromEntries(
  Object.entries(VN_OLD_TO_NEW).map(([oldPrefix, newPrefix]) => [newPrefix, oldPrefix])
);

// Matches phone-like runs within a line: a leading digit (optionally +), then
// digits with common separators, ending in a digit. Bounded so it can't span
// unrelated numbers. Direction-specific conversion leaves non-matches untouched.
const VN_PHONE_TOKEN = /\+?\d[\d.\-\s]{6,16}\d/g;

/**
 * Convert a single phone token between Vietnamese old/new mobile formats.
 * Returns the converted token, or null when it isn't a recognized number for
 * the requested direction (so the caller can leave it unchanged).
 */
function convertVnPhone(token: string, dir: 'toNew' | 'toOld'): string | null {
  const hasPlus = token.trimStart().startsWith('+');
  let body = token.replace(/\D/g, '');
  let prefix: string;
  if (body.startsWith('84')) {
    prefix = hasPlus ? '+84' : '84';
    body = body.slice(2);
  } else if (body.startsWith('0')) {
    prefix = '0';
    body = body.slice(1);
  } else {
    return null;
  }

  if (dir === 'toNew' && body.length === 10) {
    const mapped = VN_OLD_TO_NEW[body.slice(0, 3)];
    if (mapped) return prefix + mapped + body.slice(3);
  } else if (dir === 'toOld' && body.length === 9) {
    const mapped = VN_NEW_TO_OLD[body.slice(0, 2)];
    if (mapped) return prefix + mapped + body.slice(2);
  }
  return null;
}

function convertVnPhones(text: string, dir: 'toNew' | 'toOld') {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(VN_PHONE_TOKEN, (m) => convertVnPhone(m, dir) ?? m))
    .join('\n');
}

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
      case 'vn-phone-new':   return convertVnPhones(input, 'toNew');
      case 'vn-phone-old':   return convertVnPhones(input, 'toOld');
      default:               return input;
    }
  }, [input, mode, removeLineWhitespace, removeChars, delimiters]);

  useQuickPaste((text) => setInput(text));
  useInputHistory(input, setInput);

  return (
    <div className="flex flex-col h-full">
      {/* Options toolbar */}
      <ToolToolbar>
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
                variant="outline"
                aria-pressed={removeLineWhitespace}
                onClick={() => setRemoveLineWhitespace((v) => !v)}
                className={cn(
                  'h-8 text-xs rounded-lg',
                  removeLineWhitespace &&
                    'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                )}
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
      </ToolToolbar>

      <ToolPanes>
        <ToolPane>
          <PaneHeader label="Input" hint={quickPasteHint} />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to transform"
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
