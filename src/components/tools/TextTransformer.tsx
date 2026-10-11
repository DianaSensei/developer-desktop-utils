import { useMemo } from 'react';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/ui/copy-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToolToolbar, ToolPanes, ToolPane, PaneHeader } from '@/components/ui/tool-layout';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';
import MESSAGES from '@/components/tools/TextTransformer.messages';

type TransformMode =
  | 'single-line'
  | 'multiple-lines'
  | 'array'
  | 'uppercase'
  | 'lowercase'
  | 'all-cases'
  | 'camelcase'
  | 'pascalcase'
  | 'snakecase'
  | 'constantcase'
  | 'kebabcase'
  | 'titlecase'
  | 'vn-phone-new'
  | 'vn-phone-old';

const MODE_OPTIONS: Array<{ value: TransformMode; label: string }> = [
  { value: 'single-line',    label: 'To Single Line' },
  { value: 'multiple-lines', label: 'To Multiple Lines' },
  { value: 'array',          label: 'To Array' },
  { value: 'uppercase',      label: 'To UPPERCASE' },
  { value: 'lowercase',      label: 'To lowercase' },
  { value: 'all-cases',      label: 'All cases at once' },
  { value: 'camelcase',      label: 'To camelCase' },
  { value: 'pascalcase',     label: 'To PascalCase' },
  { value: 'snakecase',      label: 'To snake_case' },
  { value: 'constantcase',   label: 'To CONSTANT_CASE' },
  { value: 'kebabcase',      label: 'To kebab-case' },
  { value: 'titlecase',      label: 'To Title Case' },
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

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/**
 * Đổi kiểu chữ THEO TỪNG DÒNG. Bản trước chạy trên cả khối văn bản, mà
 * `splitWords` tách theo mọi khoảng trắng kể cả xuống dòng — nên một danh sách
 * định danh (`user_id⏎first_name`, đúng thứ hay dán vào đây nhất) bị gộp thành
 * MỘT định danh `userIdFirstName`. Dòng trống được giữ nguyên.
 */
function perLine(text: string, fn: (words: string[]) => string) {
  return text
    .split('\n')
    .map((line) => {
      const words = splitWords(line);
      return words.length ? fn(words) : line;
    })
    .join('\n');
}

export const CASE_TRANSFORMS = {
  camelcase: (t: string) => perLine(t, (w) => w.map((x, i) => (i === 0 ? x.toLowerCase() : capitalize(x))).join('')),
  pascalcase: (t: string) => perLine(t, (w) => w.map(capitalize).join('')),
  snakecase: (t: string) => perLine(t, (w) => w.map((x) => x.toLowerCase()).join('_')),
  constantcase: (t: string) => perLine(t, (w) => w.map((x) => x.toUpperCase()).join('_')),
  kebabcase: (t: string) => perLine(t, (w) => w.map((x) => x.toLowerCase()).join('-')),
  titlecase: (t: string) => perLine(t, (w) => w.map(capitalize).join(' ')),
} as const;

/** Thứ tự hiện trong chế độ "All cases" — nhãn chính là ví dụ của kiểu đó. */
const ALL_CASES: Array<[keyof typeof CASE_TRANSFORMS, string]> = [
  ['camelcase', 'camelCase'],
  ['pascalcase', 'PascalCase'],
  ['snakecase', 'snake_case'],
  ['constantcase', 'CONSTANT_CASE'],
  ['kebabcase', 'kebab-case'],
  ['titlecase', 'Title Case'],
];

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
  const sdk = usePluginSdkFor('text-transform');
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  const quickPasteHint = useQuickPasteHint();
  const [input, setInput] = usePluginState(sdk, 'textTransform:input', '', { legacyKey: 'devtool:textTransform:input' });
  const [mode, setMode] = usePluginState<TransformMode>(sdk, 'textTransform:mode', 'single-line', { legacyKey: 'devtool:textTransform:mode' });
  const [removeLineWhitespace, setRemoveLineWhitespace] = usePluginState(sdk, 'textTransform:removeLineWs', false, { legacyKey: 'devtool:textTransform:removeLineWs' });
  const [removeChars, setRemoveChars] = usePluginState(sdk, 'textTransform:removeChars', '', { legacyKey: 'devtool:textTransform:removeChars' });
  const [delimiters, setDelimiters] = usePluginState(sdk, 'textTransform:delimiters', ',;', { legacyKey: 'devtool:textTransform:delimiters' });

  const output = useMemo(() => {
    if (!input) return '';
    switch (mode) {
      case 'single-line':    return toSingleLine(input, removeLineWhitespace, removeChars);
      case 'multiple-lines': return toMultipleLines(input, delimiters);
      case 'array':          return toArray(input);
      case 'uppercase':      return input.toUpperCase();
      case 'lowercase':      return input.toLowerCase();
      case 'camelcase':
      case 'pascalcase':
      case 'snakecase':
      case 'constantcase':
      case 'kebabcase':
      case 'titlecase':      return CASE_TRANSFORMS[mode](input);
      case 'all-cases':      return '';
      case 'vn-phone-new':   return convertVnPhones(input, 'toNew');
      case 'vn-phone-old':   return convertVnPhones(input, 'toOld');
      default:               return input;
    }
  }, [input, mode, removeLineWhitespace, removeChars, delimiters]);

  useQuickPaste((text) => setInput(text));
  useInputHistory(input, setInput);

  return (
    <div className="flex flex-col h-full">
      {/* Options toolbar — chiều cao 32px trên MỌI control ở đây (không phải
          mức nghỉ 34px mặc định) là chủ ý: đây là toolbar dày đặc (xem lời chú
          trong button.tsx size="sm"), một hàng nhiều control ngang nhau cần
          cùng một chiều cao nhỏ hơn mức nghỉ, không phải bỏ sót. */}
      <ToolToolbar>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={mode} onValueChange={(v) => setMode(v as TransformMode)}>
            <SelectTrigger className="h-ctl w-52 text-xs rounded-sm">
              <SelectValue placeholder={m('selectTransform')} />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{m(`mode.${o.value}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {mode === 'single-line' && (
            <>
              <ToggleChip pressed={removeLineWhitespace} onPressedChange={setRemoveLineWhitespace}>
                {m('removeWhitespace')}
              </ToggleChip>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-fg-mute">{m('removeChars')}</span>
                <Input
                  value={removeChars}
                  onChange={(e) => setRemoveChars(e.target.value)}
                  placeholder={m('removeCharsExample')}
                  className="h-ctl w-32 font-mono text-xs rounded-sm"
                />
              </div>
            </>
          )}

          {mode === 'multiple-lines' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-fg-mute">{m('splitBy')}</span>
              <Input
                value={delimiters}
                onChange={(e) => setDelimiters(e.target.value)}
                placeholder=",;"
                className="h-ctl w-24 font-mono text-xs rounded-sm"
              />
            </div>
          )}
        </div>
      </ToolToolbar>

      <ToolPanes>
        <ToolPane>
          <PaneHeader label={c('input')} hint={quickPasteHint} />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={m('inputPlaceholder')}
            className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
          />
        </ToolPane>

        {mode === 'all-cases' ? (
          // Đổi kiểu chữ là việc "thử xem kiểu nào hợp" — hiện mọi kiểu cùng
          // lúc, mỗi kiểu một nút Copy, thay vì mở dropdown từng lần một.
          <ToolPane>
            <PaneHeader label={m('allCases')} />
            <div className="flex-1 min-h-0 divide-y divide-line overflow-y-auto">
              {ALL_CASES.map(([key, label]) => {
                const value = input ? CASE_TRANSFORMS[key](input) : '';
                return (
                  <div key={key} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="w-28 shrink-0 pt-0.5 font-mono text-xs text-fg-mute">{label}</span>
                    <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">
                      {value || <span className="text-fg-mute">—</span>}
                    </pre>
                    <CopyButton value={value} disabled={!value} variant="ghost" size="icon" className="h-6 w-6 shrink-0" iconClassName="h-3.5 w-3.5" />
                  </div>
                );
              })}
            </div>
          </ToolPane>
        ) : (
          <ToolPane>
            <PaneHeader
              label={c('output')}
              action={
                <CopyButton
                  value={output}
                  label={c('copy')}
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
              placeholder={m('outputPlaceholder')}
              className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
            />
          </ToolPane>
        )}
      </ToolPanes>
    </div>
  );
}
