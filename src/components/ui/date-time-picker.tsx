import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Date + time picker. Combines the shared DatePicker with the constrained
// TimePicker. Value is an epoch-ms timestamp.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

function toISO(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toHM(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function combine(iso: string, hm: string): number | null {
  const [y, mo, da] = iso.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  if (!y || !mo || !da || Number.isNaN(h) || Number.isNaN(mi)) return null;
  return new Date(y, mo - 1, da, h, mi, 0, 0).getTime();
}

export interface DateTimePickerProps {
  value: number; // epoch ms
  onChange: (ts: number) => void;
  disabled?: boolean;
  className?: string;
  minuteStep?: number;
}

export function DateTimePicker({ value, onChange, disabled, className, minuteStep }: DateTimePickerProps) {
  const iso = toISO(value);
  const hm = toHM(value);

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <DatePicker
        value={iso}
        disabled={disabled}
        onChange={(nextIso) => { const ts = combine(nextIso, hm); if (ts != null) onChange(ts); }}
      />
      <TimePicker
        value={hm}
        disabled={disabled}
        minuteStep={minuteStep}
        onChange={(nextHm) => { const ts = combine(iso, nextHm); if (ts != null) onChange(ts); }}
      />
    </div>
  );
}
