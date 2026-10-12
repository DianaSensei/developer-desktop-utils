import { useMemo } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HelpCircle, Lightbulb, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { CopyButton } from '@/components/ui/copy-button';
import { ExplainBand } from '@/components/ui/explain-band';
import { Tooltip } from '@/components/ui/tooltip';
import { nextCronRuns } from '@/lib/cronNext';
import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';
import MESSAGES from '@/components/tools/CronGenerator.messages';
import { ToolToolbar } from '@/components/ui/tool-layout';

type CronMode = 'linux' | 'quartz' | 'spring';
type FieldKey = 'seconds' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year';

interface CronFields {
  seconds: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  year: string;
}

interface FieldRule {
  key: FieldKey;
  label: string;
  range: string;
  min?: number;
  max?: number;
  aliases?: Record<string, number>;
  optional?: boolean;
  allowQuestion?: boolean;
  allowLast?: boolean;
  allowWeekday?: boolean;
  allowNth?: boolean;
}

const MONTH_ALIASES = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_ALIASES = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const QUARTZ_DAY_ALIASES = {
  SUN: 1,
  MON: 2,
  TUE: 3,
  WED: 4,
  THU: 5,
  FRI: 6,
  SAT: 7,
};

const DEFAULT_FIELDS: CronFields = {
  seconds: '0',
  minute: '*',
  hour: '*',
  dayOfMonth: '*',
  month: '*',
  dayOfWeek: '*',
  year: '',
};

const LINUX_RULES: FieldRule[] = [
  { key: 'minute', label: 'Minute', range: '0-59', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', range: '0-23', min: 0, max: 23 },
  { key: 'dayOfMonth', label: 'Day of Month', range: '1-31', min: 1, max: 31 },
  { key: 'month', label: 'Month', range: '1-12 or JAN-DEC', min: 1, max: 12, aliases: MONTH_ALIASES },
  { key: 'dayOfWeek', label: 'Day of Week', range: '0-7 or SUN-SAT', min: 0, max: 7, aliases: DAY_ALIASES },
];

const QUARTZ_RULES: FieldRule[] = [
  { key: 'seconds', label: 'Seconds', range: '0-59', min: 0, max: 59 },
  { key: 'minute', label: 'Minute', range: '0-59', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', range: '0-23', min: 0, max: 23 },
  {
    key: 'dayOfMonth',
    label: 'Day of Month',
    range: '1-31, ?, L, W',
    min: 1,
    max: 31,
    allowQuestion: true,
    allowLast: true,
    allowWeekday: true,
  },
  { key: 'month', label: 'Month', range: '1-12 or JAN-DEC', min: 1, max: 12, aliases: MONTH_ALIASES },
  {
    key: 'dayOfWeek',
    label: 'Day of Week',
    range: '1-7, SUN-SAT, ?, L, #',
    min: 1,
    max: 7,
    aliases: QUARTZ_DAY_ALIASES,
    allowQuestion: true,
    allowLast: true,
    allowNth: true,
  },
  { key: 'year', label: 'Year', range: 'optional', min: 1970, max: 2099, optional: true },
];

const SPRING_DAY_ALIASES = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const SPRING_RULES: FieldRule[] = [
  { key: 'seconds', label: 'Seconds', range: '0-59', min: 0, max: 59 },
  { key: 'minute', label: 'Minute', range: '0-59', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', range: '0-23', min: 0, max: 23 },
  {
    key: 'dayOfMonth',
    label: 'Day of Month',
    range: '1-31, ?, L, W',
    min: 1,
    max: 31,
    allowQuestion: true,
    allowLast: true,
    allowWeekday: true,
  },
  { key: 'month', label: 'Month', range: '1-12 or JAN-DEC', min: 1, max: 12, aliases: MONTH_ALIASES },
  {
    key: 'dayOfWeek',
    label: 'Day of Week',
    range: '0-7, SUN-SAT, ?, L, #',
    min: 0,
    max: 7,
    aliases: SPRING_DAY_ALIASES,
    allowQuestion: true,
    allowLast: true,
    allowNth: true,
  },
];

const SUGGESTIONS: Record<CronMode, Partial<Record<FieldKey, Array<{ label: string; value: string }>>>> = {
  linux: {
    minute: [
      { label: 'Every minute', value: '*' },
      { label: 'Every 5 minutes', value: '*/5' },
      { label: 'At minute 0', value: '0' },
      { label: 'At minute 30', value: '30' },
    ],
    hour: [
      { label: 'Every hour', value: '*' },
      { label: 'Midnight', value: '0' },
      { label: '9 AM', value: '9' },
      { label: 'Business hours', value: '9-17' },
    ],
    dayOfMonth: [
      { label: 'Every day', value: '*' },
      { label: '1st day', value: '1' },
      { label: '15th day', value: '15' },
    ],
    month: [
      { label: 'Every month', value: '*' },
      { label: 'January', value: 'JAN' },
      { label: 'Q1 (Jan–Mar)', value: 'JAN-MAR' },
    ],
    dayOfWeek: [
      { label: 'Every day', value: '*' },
      { label: 'Monday', value: 'MON' },
      { label: 'Weekdays', value: 'MON-FRI' },
      { label: 'Weekend', value: 'SAT,SUN' },
    ],
  },
  quartz: {
    seconds: [
      { label: 'At second 0', value: '0' },
      { label: 'Every second', value: '*' },
      { label: 'Every 30 seconds', value: '*/30' },
    ],
    minute: [
      { label: 'Every minute', value: '*' },
      { label: 'Every 5 minutes', value: '*/5' },
      { label: 'At minute 0', value: '0' },
      { label: 'At minute 30', value: '30' },
    ],
    hour: [
      { label: 'Every hour', value: '*' },
      { label: 'Midnight', value: '0' },
      { label: '9 AM', value: '9' },
      { label: 'Business hours', value: '9-17' },
    ],
    dayOfMonth: [
      { label: 'No specific day', value: '?' },
      { label: 'Every day', value: '*' },
      { label: 'Last day', value: 'L' },
      { label: 'Nearest weekday to 15th', value: '15W' },
    ],
    month: [
      { label: 'Every month', value: '*' },
      { label: 'January', value: 'JAN' },
      { label: 'First quarter', value: 'JAN-MAR' },
    ],
    dayOfWeek: [
      { label: 'No specific day', value: '?' },
      { label: 'Monday', value: 'MON' },
      { label: 'Weekdays', value: 'MON-FRI' },
      { label: 'Second Monday', value: 'MON#2' },
      { label: 'Last Friday', value: 'FRIL' },
    ],
    year: [
      { label: 'Any year', value: '' },
      { label: 'This year', value: new Date().getFullYear().toString() },
    ],
  },
  spring: {
    seconds: [
      { label: 'At second 0', value: '0' },
      { label: 'Every second', value: '*' },
      { label: 'Every 30 seconds', value: '*/30' },
    ],
    minute: [
      { label: 'Every minute', value: '*' },
      { label: 'Every 5 minutes', value: '*/5' },
      { label: 'At minute 0', value: '0' },
      { label: 'At minute 30', value: '30' },
    ],
    hour: [
      { label: 'Every hour', value: '*' },
      { label: 'Midnight', value: '0' },
      { label: '9 AM', value: '9' },
      { label: 'Business hours', value: '9-17' },
    ],
    dayOfMonth: [
      { label: 'No specific day', value: '?' },
      { label: 'Every day', value: '*' },
      { label: 'Last day', value: 'L' },
      { label: 'Nearest weekday to 15th', value: '15W' },
    ],
    month: [
      { label: 'Every month', value: '*' },
      { label: 'January', value: 'JAN' },
      { label: 'First quarter', value: 'JAN-MAR' },
    ],
    dayOfWeek: [
      { label: 'No specific day', value: '?' },
      { label: 'Sunday', value: 'SUN' },
      { label: 'Monday', value: 'MON' },
      { label: 'Weekdays', value: 'MON-FRI' },
      { label: 'Second Monday', value: 'MON#2' },
      { label: 'Last Friday', value: 'FRIL' },
    ],
  },
};

const PRESETS = {
  linux: [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Hourly', value: '0 * * * *' },
    { label: 'Daily midnight', value: '0 0 * * *' },
    { label: 'Monday 9 AM', value: '0 9 * * MON' },
  ],
  quartz: [
    { label: 'Every minute', value: '0 * * ? * *' },
    { label: 'Every 5 minutes', value: '0 */5 * ? * *' },
    { label: 'Hourly', value: '0 0 * ? * *' },
    { label: 'Daily midnight', value: '0 0 0 ? * *' },
    { label: 'Monday 9 AM', value: '0 0 9 ? * MON' },
  ],
  spring: [
    { label: 'Every minute', value: '0 * * ? * *' },
    { label: 'Every 5 minutes', value: '0 */5 * ? * *' },
    { label: 'Hourly', value: '0 0 * ? * *' },
    { label: 'Daily midnight', value: '0 0 0 ? * *' },
    { label: 'Monday 9 AM', value: '0 0 9 ? * MON' },
  ],
};

function normalizeExpression(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function getRules(mode: CronMode) {
  if (mode === 'linux') return LINUX_RULES;
  if (mode === 'spring') return SPRING_RULES;
  return QUARTZ_RULES;
}

function expressionFromFields(mode: CronMode, fields: CronFields) {
  const rules = getRules(mode);
  return rules
    .map((rule) => {
      const value = fields[rule.key].trim();
      if (rule.optional) return value;
      return value || '*';
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Số trường hợp lệ: từ số trường BẮT BUỘC tới tổng số trường. Quartz có năm là
 * trường tuỳ chọn ở cuối — bản trước đòi đủ 7, nên chính biểu thức mặc định và
 * mọi preset 6 trường của chế độ Quartz đều bị báo "Invalid expression".
 */
function acceptsFieldCount(mode: CronMode, count: number) {
  const rules = getRules(mode);
  const required = rules.filter((r) => !r.optional).length;
  return count >= required && count <= rules.length;
}

function fieldsFromExpression(mode: CronMode, expression: string) {
  const parts = normalizeExpression(expression).split(' ').filter(Boolean);
  const rules = getRules(mode);

  if (!acceptsFieldCount(mode, parts.length)) return null;

  return rules.reduce<CronFields>(
    (nextFields, rule, index) => ({
      ...nextFields,
      [rule.key]: parts[index] ?? '',
    }),
    { ...DEFAULT_FIELDS, year: '' }
  );
}

function inferMode(expression: string, fallback: CronMode): CronMode {
  const count = normalizeExpression(expression).split(' ').filter(Boolean).length;
  if (count === 5) return 'linux';
  if (count === 6) {
    // Spring uses 0-7 for day of week, Quartz uses 1-7
    // If it looks like it uses 0-6 range or SUN-SAT aliases, it's likely Spring
    return 'spring';
  }
  if (count === 7) return 'quartz';
  return fallback;
}

/** Hàm dịch truyền vào các hàm thuần (kiểm tra, giải thích) — chúng không gọi được hook. */
type T = (key: keyof typeof MESSAGES, params?: Record<string, string | number>) => string;

const fieldName = (rule: FieldRule, t: T) => t(`field.${rule.key}`);
const rangeText = (rule: FieldRule, t: T) =>
  rule.range === 'optional' ? t('optional') : rule.range.replace(/ or /g, ` ${t('or')} `);
/** Nhãn gợi ý/preset — khoá từ điển là nhãn tiếng Anh gốc; thiếu thì giữ nguyên. */
const labelText = (label: string, t: T) =>
  `label.${label}` in MESSAGES ? t(`label.${label}` as keyof typeof MESSAGES) : label;

function aliasValue(value: string, aliases?: Record<string, number>) {
  if (!aliases) return value;
  return aliases[value.toUpperCase()]?.toString() ?? value;
}

function isNumberInRange(value: string, rule: FieldRule) {
  const resolved = aliasValue(value, rule.aliases);
  if (!/^\d+$/.test(resolved)) return false;

  const number = Number(resolved);
  return (
    (rule.min === undefined || number >= rule.min) &&
    (rule.max === undefined || number <= rule.max)
  );
}

function validateBaseToken(token: string, rule: FieldRule, t: T): string | null {
  const p = { field: fieldName(rule, t), range: rangeText(rule, t) };
  if (token === '*') return null;
  if (token === '?' && rule.allowQuestion) return null;
  if (token === 'L' && rule.allowLast) return null;
  if (rule.allowWeekday && /^LW$/i.test(token)) return null;
  if (rule.allowWeekday && /^\d+W$/i.test(token)) {
    return isNumberInRange(token.slice(0, -1), rule) ? null : t('weekdayOutside', p);
  }
  if (rule.allowLast && /^[A-Z0-9]+L$/i.test(token)) {
    return isNumberInRange(token.slice(0, -1), rule) ? null : t('lastOutside', p);
  }
  if (rule.allowNth && /^[A-Z0-9]+#[1-5]$/i.test(token)) {
    return isNumberInRange(token.split('#')[0], rule) ? null : t('nthOutside', p);
  }

  if (token.includes('-')) {
    const [start, end, extra] = token.split('-');
    if (extra !== undefined || !start || !end) return t('rangeMalformed', p);
    if (!isNumberInRange(start, rule) || !isNumberInRange(end, rule)) {
      return t('rangeMustBe', p);
    }
    return null;
  }

  return isNumberInRange(token, rule) ? null : t('mustBe', p);
}

function validateField(value: string, rule: FieldRule, t: T) {
  const p = { field: fieldName(rule, t) };
  const trimmed = value.trim();

  if (!trimmed) {
    return rule.optional ? [] : [t('required', p)];
  }

  return trimmed
    .split(',')
    .map((item) => {
      const [base, step, extra] = item.split('/');
      if (extra !== undefined || !base) return t('stepMalformed', p);
      if (step !== undefined && (!/^\d+$/.test(step) || Number(step) <= 0)) {
        return t('stepPositive', p);
      }
      return validateBaseToken(base, rule, t);
    })
    .filter(Boolean) as string[];
}

function modeRuleTooltip(mode: CronMode, t: T) {
  if (mode === 'linux') {
    return t('linuxRule');
  }
  if (mode === 'spring') {
    return t('springRule');
  }

  return t('quartzRule');
}

function validateExpression(mode: CronMode, expression: string, t: T) {
  const normalized = normalizeExpression(expression);
  const parts = normalized.split(' ').filter(Boolean);
  const rules = getRules(mode);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!normalized) {
    return { normalized, fields: null, errors: [t('enterExpression')], warnings };
  }

  if (!acceptsFieldCount(mode, parts.length)) {
    const fieldCountMsg = mode === 'linux'
      ? t('linuxFields')
      : mode === 'spring'
        ? t('springFields')
        : t('quartzFields');
    errors.push(fieldCountMsg);
    return { normalized, fields: null, errors, warnings };
  }

  const fields = fieldsFromExpression(mode, normalized);

  if (!fields) {
    errors.push(t('unreadable'));
    return { normalized, fields: null, errors, warnings };
  }

  rules.forEach((rule) => {
    errors.push(...validateField(fields[rule.key], rule, t));
  });

  if (mode === 'quartz' || mode === 'spring') {
    const dom = fields.dayOfMonth;
    const dow = fields.dayOfWeek;
    if (dom !== '?' && dow !== '?') {
      const prefix = mode === 'spring' ? 'Spring' : 'Quartz';
      warnings.push(t('dayConflict', { flavor: prefix }));
    }
  }

  return { normalized, fields, errors, warnings };
}

type Unit = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year';

function phraseForValue(value: string, unitKey: Unit, t: T) {
  const unit = t(`unit.${unitKey}`);
  if (!value || value === '*') return t('phraseEvery', { unit });
  if (value === '?') return t('phraseNoSpecific', { unit });

  const every = value.match(/^\*\/(\d+)$/);
  if (every) return every[1] === '1' ? t('phraseEveryOne', { unit }) : t('phraseEveryN', { n: every[1], unit });

  if (/^\d+$/.test(value) || /^[A-Z]{3}$/i.test(value)) return t('phraseValue', { unit, value });
  if (value.includes(',') || value.includes('-')) return t('phraseValues', { unit, value });

  return t('phraseValue', { unit, value });
}

function explainExpression(mode: CronMode, fields: CronFields | null, errors: string[], t: T) {
  if (!fields || errors.length > 0) return t('fixFirst');

  const minuteStep = fields.minute.match(/^\*\/(\d+)$/);
  const secondStep = fields.seconds.match(/^\*\/(\d+)$/);

  if (mode === 'linux') {
    if (minuteStep && fields.hour === '*' && fields.dayOfMonth === '*' && fields.month === '*' && fields.dayOfWeek === '*') {
      return t('everyNMinutes', { n: minuteStep[1] });
    }
    if (fields.minute === '*' && fields.hour === '*' && fields.dayOfMonth === '*' && fields.month === '*' && fields.dayOfWeek === '*') {
      return t('everyMinute');
    }
    if (fields.minute === '0' && fields.hour === '*' && fields.dayOfMonth === '*' && fields.month === '*' && fields.dayOfWeek === '*') {
      return t('everyHour');
    }
  }

  if (mode === 'quartz' || mode === 'spring') {
    if (secondStep && fields.minute === '*' && fields.hour === '*' && fields.dayOfMonth === '?' && fields.month === '*' && fields.dayOfWeek === '*') {
      return t('everyNSeconds', { n: secondStep[1] });
    }
    if (minuteStep && fields.seconds === '0' && fields.hour === '*' && fields.month === '*') {
      return t('everyNMinutes', { n: minuteStep[1] });
    }
  }

  const parts =
    mode === 'linux'
      ? [
          phraseForValue(fields.minute, 'minute', t),
          phraseForValue(fields.hour, 'hour', t),
          phraseForValue(fields.dayOfMonth, 'dayOfMonth', t),
          phraseForValue(fields.month, 'month', t),
          phraseForValue(fields.dayOfWeek, 'dayOfWeek', t),
        ]
      : [
          phraseForValue(fields.seconds, 'second', t),
          phraseForValue(fields.minute, 'minute', t),
          phraseForValue(fields.hour, 'hour', t),
          phraseForValue(fields.dayOfMonth, 'dayOfMonth', t),
          phraseForValue(fields.month, 'month', t),
          phraseForValue(fields.dayOfWeek, 'dayOfWeek', t),
          fields.year ? phraseForValue(fields.year, 'year', t) : '',
        ].filter(Boolean);

  return t('runsAt', { parts: parts.join(', ') });
}

function formatRun(d: Date, withSeconds: boolean) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;
  return `${day} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

function relativeFromNow(d: Date, t: T) {
  const sec = Math.round((d.getTime() - Date.now()) / 1000);
  if (sec < 60) return t('inSeconds', { n: Math.max(sec, 0) });
  const min = Math.round(sec / 60);
  if (min < 60) return t('inMinutes', { n: min });
  const hr = Math.round(min / 60);
  if (hr < 48) return t('inHours', { n: hr });
  return t('inDays', { n: Math.round(hr / 24) });
}

export function CronGenerator() {
  const sdk = usePluginSdkFor('cron-generator');
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  const quickPasteHint = useQuickPasteHint();
  const [mode, setMode] = usePluginState<CronMode>(sdk, 'cron:mode', 'linux', { legacyKey: 'devtool:cron:mode' });
  const [fields, setFields] = usePluginState<CronFields>(sdk, 'cron:fields', DEFAULT_FIELDS, { legacyKey: 'devtool:cron:fields' });
  const [expression, setExpression] = usePluginState(sdk, 'cron:expression', () =>
    expressionFromFields('linux', DEFAULT_FIELDS)
  , { legacyKey: 'devtool:cron:expression' });

  const inferredMode = inferMode(expression, mode);
  const rules = getRules(mode);
  const analysis = useMemo(() => validateExpression(mode, expression, m), [mode, expression, m]);
  const explanation = useMemo(
    () => explainExpression(mode, analysis.fields, analysis.errors, m),
    [analysis.errors, analysis.fields, mode, m]
  );
  // Năm mốc chạy kế tiếp — cách chắc nhất để biết biểu thức đúng ý hay không.
  const nextRuns = useMemo(
    () => (analysis.fields && analysis.errors.length === 0 ? nextCronRuns(mode, analysis.fields) : null),
    [analysis.fields, analysis.errors.length, mode]
  );

  const syncExpression = (nextMode: CronMode, nextFields: CronFields) => {
    setExpression(expressionFromFields(nextMode, nextFields));
  };

  const changeMode = (nextMode: CronMode) => {
    const nextFields =
      nextMode === 'linux'
        ? {
            ...fields,
            dayOfMonth: fields.dayOfMonth.replace(/\?/g, '*') || '*',
            dayOfWeek: fields.dayOfWeek.replace(/\?/g, '*') || '*',
            year: '',
          }
        : nextMode === 'spring'
          ? {
              ...fields,
              seconds: fields.seconds || '0',
              dayOfMonth: fields.dayOfMonth === '*' && fields.dayOfWeek === '*' ? '?' : fields.dayOfMonth,
              year: '',
            }
          : {
              ...fields,
              seconds: fields.seconds || '0',
              dayOfMonth: fields.dayOfMonth === '*' && fields.dayOfWeek === '*' ? '?' : fields.dayOfMonth,
            };

    setMode(nextMode);
    setFields(nextFields);
    syncExpression(nextMode, nextFields);
  };

  const updateField = (field: FieldKey, value: string) => {
    const nextFields = { ...fields, [field]: value };
    setFields(nextFields);
    syncExpression(mode, nextFields);
  };

  const updateExpression = (value: string) => {
    const nextMode = inferMode(value, mode);
    const parsed = fieldsFromExpression(nextMode, value);

    setExpression(value);

    if (parsed) {
      setMode(nextMode);
      setFields(parsed);
    }
  };

  const applyPreset = (value: string) => {
    updateExpression(value);
  };

  useQuickPaste((text) => updateExpression(text.trim()));
  useInputHistory(expression, updateExpression);

  const reset = () => {
    setMode('linux');
    setFields(DEFAULT_FIELDS);
    setExpression(expressionFromFields('linux', DEFAULT_FIELDS));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <ToolToolbar className="flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={changeMode}
          options={(['linux', 'quartz', 'spring'] as CronMode[]).map((item) => ({
            value: item,
            label: item.charAt(0).toUpperCase() + item.slice(1),
          }))}
          aria-label={m('flavorLabel')}
        />
        <Tooltip label={m('ruleTitle', { flavor: mode })} description={modeRuleTooltip(mode, m)} side="bottom" width={288}>
          <button
            type="button"
            aria-label={m('ruleTitle', { flavor: mode })}
            className="inline-flex h-ctl w-ctl items-center justify-center rounded-sm text-fg-mute hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </Tooltip>
      </ToolToolbar>

      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="cron-expression">{m('expression')}</Label>
            {inferredMode !== mode ? (
              <span className="text-xs text-fg-mute">{m('looksLike', { flavor: inferredMode })}</span>
            ) : (
              <span className="text-xs text-fg-mute">{quickPasteHint}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="cron-expression"
              value={expression}
              onChange={(event) => updateExpression(event.target.value)}
              placeholder={mode === 'linux' ? '*/5 * * * *' : '0 */5 * ? * *'}
              className="font-mono h-ctl-lg rounded-sm border-b border-line"
            />
            <CopyButton
              value={() => normalizeExpression(expression)}
              variant="outline"
              size="sm"
              title={m('copyExpression')}
              aria-label={m('copyExpression')}
              className="h-ctl px-2"
              iconClassName="h-4 w-4"
            />
            <Button onClick={reset} size="sm" variant="ghost" title={c('reset')} aria-label={c('reset')} className="h-ctl px-2">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rules.map((rule) => {
            const suggestions = SUGGESTIONS[mode][rule.key] ?? [];
            const fieldErrors = validateField(fields[rule.key], rule, m);

            return (
              <div key={rule.key} className="space-y-2 rounded-lg border border-line bg-bg/50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`cron-${rule.key}`}>{fieldName(rule, m)}</Label>
                  <span className="text-xs text-fg-mute">{rangeText(rule, m)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`cron-${rule.key}`}
                    value={fields[rule.key]}
                    onChange={(event) => updateField(rule.key, event.target.value)}
                    placeholder={rule.optional ? m('optional') : '*'}
                    className={cn(
                      'h-ctl min-w-0 flex-1 font-mono',
                      fieldErrors.length > 0 && 'border-bad'
                    )}
                  />
                  <Select
                    value="__placeholder"
                    onValueChange={(value) => updateField(rule.key, value === '__empty' ? '' : value)}
                  >
                    <SelectTrigger
                      aria-label={m('suggestions', { field: fieldName(rule, m) })}
                      title={m('suggestionsShort')}
                      className="group relative h-ctl w-9 flex-none justify-center rounded-sm px-0 text-fg-mute hover:text-fg [&>span]:hidden [&>svg:last-child]:hidden"
                    >
                      <Lightbulb className="h-4 w-4" />
                      <SelectValue className="sr-only" placeholder={m('suggestionsShort')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__placeholder" disabled>
                        {m('chooseValue')}
                      </SelectItem>
                      {suggestions.map((suggestion) => (
                        <SelectItem key={`${rule.key}-${suggestion.value}`} value={suggestion.value || '__empty'}>
                          {labelText(suggestion.label, m)} ({suggestion.value || m('blank')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {fieldErrors.length > 0 && (
                  <p className="text-xs text-bad">{fieldErrors[0]}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <Label>{m('presets')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS[mode].map((preset) => (
              <Button key={preset.value} variant="outline" size="sm" onClick={() => applyPreset(preset.value)} className="h-ctl text-xs">
                {labelText(preset.label, m)}
              </Button>
            ))}
          </div>
        </div>

        {/*
          Bản cũ: viền/nền dùng border-acc/bg-acc (tức là ACCENT, đổi
          theo tone chủ đạo) trong khi icon lại cứng text-green-500 — đúng lỗi
          trộn hai hệ màu mà design/RULES.md cảnh báo. Đổi tone chủ đạo sang đỏ
          thì cả khối "hợp lệ" sẽ nhuộm đỏ trong khi icon vẫn xanh lá. ExplainBand
          lấy màu từ hệ trạng thái cố định nên không còn lệch được nữa.
        */}
        <ExplainBand
          tone={analysis.errors.length > 0 ? 'bad' : 'ok'}
          title={
            analysis.errors.length > 0
              ? m('invalidExpression')
              : mode === 'spring'
                ? m('validSpring')
                : m('validCron', { flavor: mode })
          }
        >
          {explanation}
          {analysis.errors.map((error) => (
            <span key={error} className="mt-1 block text-bad">
              {error}
            </span>
          ))}
          {analysis.warnings.map((warning) => (
            <span key={warning} className="mt-1 block text-fg-mute">
              {warning}
            </span>
          ))}
        </ExplainBand>

        {nextRuns && (
          <div className="space-y-2">
            <Label>{m('nextRuns')} <span className="font-normal text-fg-mute">{m('localTime')}</span></Label>
            {'unsupported' in nextRuns ? (
              <p className="text-xs text-fg-mute">
                {m('previewUnsupported')} <code className="font-mono">{nextRuns.unsupported}</code> {m('previewUnsupportedAfter')}
              </p>
            ) : nextRuns.runs.length === 0 ? (
              <p className="text-xs text-fg-mute">{m('neverFires')}</p>
            ) : (
              <ol className="divide-y divide-line rounded-sm border border-line bg-card">
                {nextRuns.runs.map((run) => (
                  <li key={run.getTime()} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="font-mono text-sm tabular-nums">{formatRun(run, mode !== 'linux')}</span>
                    <span className="text-xs text-fg-mute">{relativeFromNow(run, m)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
