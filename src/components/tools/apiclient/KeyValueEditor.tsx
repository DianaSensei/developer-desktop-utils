// Editable Name/Value table (Bruno-style) shared by query params, headers, form
// bodies, and environment variables.
//
// There is always exactly one trailing empty row: typing into it materializes it
// into a real row and a fresh empty row appears below. Empty rows never linger
// above the last one. The trailing row keeps a stable id (held in a ref) so the
// input the user is typing in is never remounted when it materializes — focus is
// preserved. A "Bulk Edit" toggle swaps the table for a `key: value` textarea.

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Trash2 } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { VarInput } from './VarInput';
import { type KeyValue, type VarMap, newKeyValue } from './types';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  nameLabel?: string;
  valueLabel?: string;
  bulkEdit?: boolean;
  // When provided, name/value cells become {{variable}}-aware (highlight +
  // autocomplete + hover). Omitted where vars don't apply (e.g. env editor).
  vars?: VarMap;
}

const isFilled = (r: KeyValue) => r.key !== '' || r.value !== '';

export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = 'Name',
  valuePlaceholder = 'Value',
  nameLabel = 'Name',
  valueLabel = 'Value',
  bulkEdit = true,
  vars,
}: Props) {
  const [bulk, setBulk] = useState(false);
  // Bulk mode keeps its own text so newlines/spacing survive while typing; rows
  // are parsed out of it in the background and committed via onChange.
  const [bulkText, setBulkText] = useState('');
  const ghostRef = useRef(newKeyValue());

  // Only the filled rows are "real"; the trailing ghost represents the next row.
  const realRows = rows.filter(isFilled);
  const ghost = ghostRef.current;
  const displayRows = [...realRows, ghost];

  const editRow = (id: string, patch: Partial<KeyValue>) => {
    if (id === ghost.id) {
      // First keystroke in the trailing row: commit it and mint a new ghost.
      const materialized = { ...ghost, ...patch };
      ghostRef.current = newKeyValue();
      onChange([...realRows, materialized]);
      return;
    }
    // Editing a real row; drop it if it was cleared so no empty row lingers.
    onChange(realRows.map((r) => (r.id === id ? { ...r, ...patch } : r)).filter(isFilled));
  };

  const removeRow = (id: string) => onChange(realRows.filter((r) => r.id !== id));

  // Disabled rows round-trip through bulk mode with a leading `//` (Postman's
  // convention), so toggling a row off and editing in bulk doesn't silently
  // re-enable it.
  const enterBulk = () => {
    setBulkText(realRows.map((r) => `${r.enabled ? '' : '//'}${r.key}:${r.value}`).join('\n'));
    setBulk(true);
  };

  const parseBulk = (value: string) => {
    setBulkText(value);
    const parsed: KeyValue[] = [];
    for (const raw of value.split('\n')) {
      let line = raw.trim();
      if (!line) continue;
      const enabled = !line.startsWith('//');
      if (!enabled) line = line.slice(2).trim();
      const idx = line.indexOf(':');
      const k = (idx === -1 ? line : line.slice(0, idx)).trim();
      const v = idx === -1 ? '' : line.slice(idx + 1).trim();
      if (k || v) parsed.push({ ...newKeyValue(k, v), enabled });
    }
    onChange(parsed);
  };

  if (bulk) {
    return (
      <div className="space-y-1.5">
        <div className="flex justify-end">
          <button onClick={() => setBulk(false)} className="text-[11px] font-medium text-primary hover:underline">
            Key-Value Edit
          </button>
        </div>
        <CodeEditor
          value={bulkText}
          onChange={parseBulk}
          placeholder={`${keyPlaceholder}: ${valuePlaceholder}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden rounded-md border text-xs">
        {/* Header row */}
        <div className="grid grid-cols-[1rem_1fr_1fr_2rem] border-b bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          <div />
          <div className="border-r px-3 py-1.5">{nameLabel}</div>
          <div className="border-r px-3 py-1.5">{valueLabel}</div>
          <div />
        </div>

        {displayRows.map((row) => {
          const isGhost = row.id === ghost.id;
          const disabled = !isGhost && !row.enabled;
          return (
            <div key={row.id} className="group grid grid-cols-[1rem_1fr_1fr_2rem] border-b last:border-b-0 hover:bg-muted/20 transition-colors">
              {/* Enable/disable toggle dot */}
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => !isGhost && editRow(row.id, { enabled: !row.enabled })}
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full transition-colors',
                    isGhost ? 'invisible' : row.enabled ? 'bg-amber-400' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50',
                  )}
                  title={row.enabled ? 'Disable' : 'Enable'}
                />
              </div>
              {/* Name cell */}
              <div className="border-r px-1.5">
                <Input
                  value={row.key}
                  onChange={(e) => editRow(row.id, { key: e.target.value })}
                  placeholder={keyPlaceholder}
                  className={cn('h-9 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', disabled && 'opacity-40 line-through')}
                  spellCheck={false}
                />
              </div>
              {/* Value cell */}
              <div className="border-r px-1.5">
                {vars ? (
                  <div className={cn('flex h-9 items-center', disabled && 'opacity-40')}>
                    <VarInput
                      value={row.value}
                      onChange={(v) => editRow(row.id, { value: v })}
                      vars={vars}
                      placeholder={valuePlaceholder}
                    />
                  </div>
                ) : (
                  <Input
                    value={row.value}
                    onChange={(e) => editRow(row.id, { value: e.target.value })}
                    placeholder={valuePlaceholder}
                    className={cn('h-9 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', disabled && 'opacity-40')}
                    spellCheck={false}
                  />
                )}
              </div>
              {/* Delete */}
              <div className="flex items-center justify-center">
                {!isGhost && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="rounded p-1 text-muted-foreground/40 opacity-0 transition-all group-hover:opacity-100 hover:text-destructive"
                    title="Remove"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {bulkEdit && (
        <div className="flex justify-end">
          <button onClick={enterBulk} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            Bulk Edit
          </button>
        </div>
      )}
    </div>
  );
}
