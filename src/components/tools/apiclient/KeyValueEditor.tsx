// Editable table of key/value rows with per-row enable checkbox + delete.
// Shared by query params, headers, form bodies, and environment variables.
// A trailing empty "ghost" row auto-materializes into a real row on first edit.

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check, Plus, Trash2 } from 'lucide-react';
import { type KeyValue, newKeyValue } from './types';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}: Props) {
  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));

  const add = () => onChange([...rows, newKeyValue()]);

  return (
    <div className="rounded-md border divide-y">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2 px-2 py-1">
          <button
            type="button"
            onClick={() => update(row.id, { enabled: !row.enabled })}
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
              row.enabled ? 'bg-primary border-primary text-primary-foreground' : 'border-input',
            )}
            title={row.enabled ? 'Enabled' : 'Disabled'}
          >
            {row.enabled && <Check className="h-3 w-3" />}
          </button>
          <Input
            value={row.key}
            onChange={(e) => update(row.id, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className={cn('h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0', !row.enabled && 'opacity-50')}
          />
          <Input
            value={row.value}
            onChange={(e) => update(row.id, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className={cn('h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0', !row.enabled && 'opacity-50')}
          />
          <button
            type="button"
            onClick={() => remove(row.id)}
            className="shrink-0 rounded p-1 text-muted-foreground/60 hover:text-destructive"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">No rows yet.</p>
      )}
      <button
        type="button"
        onClick={add}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> Add row
      </button>
    </div>
  );
}
