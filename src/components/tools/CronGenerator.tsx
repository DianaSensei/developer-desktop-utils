import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Copy, HelpCircle, Lightbulb, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

type CronMode = 'linux' | 'quartz';
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
      { label: 'Weekdays season', value: 'JAN-MAR' },
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
};

function normalizeExpression(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function getRules(mode: CronMode) {
  return mode === 'linux' ? LINUX_RULES : QUARTZ_RULES;
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

function fieldsFromExpression(mode: CronMode, expression: string) {
  const parts = normalizeExpression(expression).split(' ').filter(Boolean);
  const rules = getRules(mode);

  if (parts.length !== rules.length) return null;

  return rules.reduce<CronFields>(
    (nextFields, rule, index) => ({
      ...nextFields,
      [rule.key]: parts[index],
    }),
    { ...DEFAULT_FIELDS, year: '' }
  );
}

function inferMode(expression: string, fallback: CronMode): CronMode {
  const count = normalizeExpression(expression).split(' ').filter(Boolean).length;
  if (count === 5) return 'linux';
  if (count === 6 || count === 7) return 'quartz';
  return fallback;
}

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

function validateBaseToken(token: string, rule: FieldRule): string | null {
  if (token === '*') return null;
  if (token === '?' && rule.allowQuestion) return null;
  if (token === 'L' && rule.allowLast) return null;
  if (rule.allowWeekday && /^LW$/i.test(token)) return null;
  if (rule.allowWeekday && /^\d+W$/i.test(token)) {
    return isNumberInRange(token.slice(0, -1), rule) ? null : `${rule.label} weekday value is outside ${rule.range}.`;
  }
  if (rule.allowLast && /^[A-Z0-9]+L$/i.test(token)) {
    return isNumberInRange(token.slice(0, -1), rule) ? null : `${rule.label} last value is outside ${rule.range}.`;
  }
  if (rule.allowNth && /^[A-Z0-9]+#[1-5]$/i.test(token)) {
    return isNumberInRange(token.split('#')[0], rule) ? null : `${rule.label} nth value is outside ${rule.range}.`;
  }

  if (token.includes('-')) {
    const [start, end, extra] = token.split('-');
    if (extra !== undefined || !start || !end) return `${rule.label} range is malformed.`;
    if (!isNumberInRange(start, rule) || !isNumberInRange(end, rule)) {
      return `${rule.label} range must be ${rule.range}.`;
    }
    return null;
  }

  return isNumberInRange(token, rule) ? null : `${rule.label} must be ${rule.range}.`;
}

function validateField(value: string, rule: FieldRule) {
  const trimmed = value.trim();

  if (!trimmed) {
    return rule.optional ? [] : [`${rule.label} is required.`];
  }

  return trimmed
    .split(',')
    .map((item) => {
      const [base, step, extra] = item.split('/');
      if (extra !== undefined || !base) return `${rule.label} step is malformed.`;
      if (step !== undefined && (!/^\d+$/.test(step) || Number(step) <= 0)) {
        return `${rule.label} step must be a positive number.`;
      }
      return validateBaseToken(base, rule);
    })
    .filter(Boolean) as string[];
}

function modeRuleTooltip(mode: CronMode) {
  if (mode === 'linux') {
    return 'Linux cron uses 5 fields: minute, hour, day of month, month, day of week. Use *, values, ranges, lists, and steps like */5.';
  }

  return 'Quartz cron uses 6 fields plus optional year: second, minute, hour, day of month, month, day of week, year. Use ? in either day field, plus L, W, and # where supported.';
}

function validateExpression(mode: CronMode, expression: string) {
  const normalized = normalizeExpression(expression);
  const parts = normalized.split(' ').filter(Boolean);
  const rules = getRules(mode);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!normalized) {
    return { normalized, fields: null, errors: ['Enter or generate a cron expression.'], warnings };
  }

  if (parts.length !== rules.length) {
    errors.push(
      mode === 'linux'
        ? 'Linux cron must have 5 fields: minute hour day-of-month month day-of-week.'
        : 'Quartz cron must have 6 fields, or 7 fields when year is included.'
    );
    return { normalized, fields: null, errors, warnings };
  }

  const fields = fieldsFromExpression(mode, normalized);

  if (!fields) {
    errors.push('Unable to read cron fields.');
    return { normalized, fields: null, errors, warnings };
  }

  rules.forEach((rule) => {
    errors.push(...validateField(fields[rule.key], rule));
  });

  if (mode === 'quartz') {
    const dom = fields.dayOfMonth;
    const dow = fields.dayOfWeek;
    if (dom !== '?' && dow !== '?') {
      warnings.push('Quartz usually uses ? in either day-of-month or day-of-week to avoid conflicting schedules.');
    }
  }

  return { normalized, fields, errors, warnings };
}

function phraseForValue(value: string, label: string) {
  if (!value || value === '*') return `every ${label}`;
  if (value === '?') return `no specific ${label}`;

  const every = value.match(/^\*\/(\d+)$/);
  if (every) return `every ${every[1]} ${label}${every[1] === '1' ? '' : 's'}`;

  if (/^\d+$/.test(value) || /^[A-Z]{3}$/i.test(value)) return `${label} ${value}`;
  if (value.includes(',')) return `${label}s ${value}`;
  if (value.includes('-')) return `${label}s ${value}`;

  return `${label} ${value}`;
}

function explainExpression(mode: CronMode, fields: CronFields | null, errors: string[]) {
  if (!fields || errors.length > 0) return 'Fix validation issues to see the schedule explanation.';

  const minuteStep = fields.minute.match(/^\*\/(\d+)$/);
  const secondStep = fields.seconds.match(/^\*\/(\d+)$/);

  if (mode === 'linux') {
    if (minuteStep && fields.hour === '*' && fields.dayOfMonth === '*' && fields.month === '*' && fields.dayOfWeek === '*') {
      return `Every ${minuteStep[1]} minutes.`;
    }
    if (fields.minute === '*' && fields.hour === '*' && fields.dayOfMonth === '*' && fields.month === '*' && fields.dayOfWeek === '*') {
      return 'Every minute.';
    }
    if (fields.minute === '0' && fields.hour === '*' && fields.dayOfMonth === '*' && fields.month === '*' && fields.dayOfWeek === '*') {
      return 'Every hour.';
    }
  }

  if (mode === 'quartz') {
    if (secondStep && fields.minute === '*' && fields.hour === '*' && fields.dayOfMonth === '?' && fields.month === '*' && fields.dayOfWeek === '*') {
      return `Every ${secondStep[1]} seconds.`;
    }
    if (minuteStep && fields.seconds === '0' && fields.hour === '*' && fields.month === '*') {
      return `Every ${minuteStep[1]} minutes.`;
    }
  }

  const parts =
    mode === 'linux'
      ? [
          phraseForValue(fields.minute, 'minute'),
          phraseForValue(fields.hour, 'hour'),
          phraseForValue(fields.dayOfMonth, 'day of month'),
          phraseForValue(fields.month, 'month'),
          phraseForValue(fields.dayOfWeek, 'day of week'),
        ]
      : [
          phraseForValue(fields.seconds, 'second'),
          phraseForValue(fields.minute, 'minute'),
          phraseForValue(fields.hour, 'hour'),
          phraseForValue(fields.dayOfMonth, 'day of month'),
          phraseForValue(fields.month, 'month'),
          phraseForValue(fields.dayOfWeek, 'day of week'),
          fields.year ? phraseForValue(fields.year, 'year') : '',
        ].filter(Boolean);

  return `Runs at ${parts.join(', ')}.`;
}

export function CronGenerator() {
  const [mode, setMode] = useState<CronMode>('linux');
  const [fields, setFields] = useState<CronFields>(DEFAULT_FIELDS);
  const [expression, setExpression] = useState(expressionFromFields('linux', DEFAULT_FIELDS));

  const inferredMode = inferMode(expression, mode);
  const rules = getRules(mode);
  const analysis = useMemo(() => validateExpression(mode, expression), [mode, expression]);
  const explanation = useMemo(
    () => explainExpression(mode, analysis.fields, analysis.errors),
    [analysis.errors, analysis.fields, mode]
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

  const reset = () => {
    setMode('linux');
    setFields(DEFAULT_FIELDS);
    setExpression(expressionFromFields('linux', DEFAULT_FIELDS));
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(normalizeExpression(expression));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Cron Expression</CardTitle>
            <CardDescription>Generate, validate, and explain Linux or Quartz cron schedules</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-md border bg-muted/45 p-0.5">
              {(['linux', 'quartz'] as CronMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => changeMode(item)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    mode === item
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={`${mode} cron rule`}
              className="group relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <HelpCircle className="h-4 w-4" />
              <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-72 rounded-md border bg-popover px-2.5 py-2 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-md group-hover:block group-focus-visible:block">
                {modeRuleTooltip(mode)}
              </span>
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="cron-expression">Expression</Label>
            {inferredMode !== mode && (
              <span className="text-xs text-muted-foreground">Looks like {inferredMode} cron</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="cron-expression"
              value={expression}
              onChange={(event) => updateExpression(event.target.value)}
              placeholder={mode === 'linux' ? '*/5 * * * *' : '0 */5 * ? * *'}
              className="font-mono"
            />
            <Button onClick={copyToClipboard} size="icon" variant="outline" title="Copy expression">
              <Copy className="h-4 w-4" />
            </Button>
            <Button onClick={reset} size="icon" variant="ghost" title="Reset">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rules.map((rule) => {
            const suggestions = SUGGESTIONS[mode][rule.key] ?? [];
            const fieldErrors = validateField(fields[rule.key], rule);

            return (
              <div key={rule.key} className="space-y-2 rounded-md border bg-background/50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`cron-${rule.key}`}>{rule.label}</Label>
                  <span className="text-xs text-muted-foreground">{rule.range}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`cron-${rule.key}`}
                    value={fields[rule.key]}
                    onChange={(event) => updateField(rule.key, event.target.value)}
                    placeholder={rule.optional ? 'optional' : '*'}
                    className={cn(
                      'h-8 min-w-0 flex-1 font-mono',
                      fieldErrors.length > 0 && 'border-destructive'
                    )}
                  />
                  <Select
                    value="__placeholder"
                    onValueChange={(value) => updateField(rule.key, value === '__empty' ? '' : value)}
                  >
                    <SelectTrigger
                      aria-label={`${rule.label} suggestions`}
                      title="Suggestions"
                      className="group relative h-8 w-9 flex-none justify-center px-0 text-muted-foreground hover:text-foreground [&>span]:hidden [&>svg:last-child]:hidden"
                    >
                      <Lightbulb className="h-4 w-4" />
                      <SelectValue className="sr-only" placeholder="Suggestions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__placeholder" disabled>
                        Choose value
                      </SelectItem>
                      {suggestions.map((suggestion) => (
                        <SelectItem key={`${rule.key}-${suggestion.value}`} value={suggestion.value || '__empty'}>
                          {suggestion.label} ({suggestion.value || 'blank'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {fieldErrors.length > 0 && (
                  <p className="text-xs text-destructive">{fieldErrors[0]}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <Label>Presets</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS[mode].map((preset) => (
              <Button key={preset.value} variant="outline" size="sm" onClick={() => applyPreset(preset.value)}>
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <div
          className={cn(
            'space-y-2 rounded-md border px-3 py-3',
            analysis.errors.length > 0
              ? 'border-destructive/25 bg-destructive/10'
              : 'border-primary/25 bg-accent/45'
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {analysis.errors.length > 0 ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            )}
            <span>{analysis.errors.length > 0 ? 'Invalid expression' : `Valid ${mode} cron`}</span>
          </div>
          <p className="text-sm text-foreground">{explanation}</p>
          {analysis.errors.map((error) => (
            <p key={error} className="text-xs text-destructive">
              {error}
            </p>
          ))}
          {analysis.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
