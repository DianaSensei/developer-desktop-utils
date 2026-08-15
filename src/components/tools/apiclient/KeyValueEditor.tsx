// Editable Name/Value table (Bruno-style) shared by query params, headers, form
// bodies, and environment variables.
//
// There is always exactly one trailing empty row: typing into it materializes it
// into a real row and a fresh empty row appears below. Empty rows never linger
// above the last one. The trailing row keeps a stable id (held in a ref) so the
// input the user is typing in is never remounted when it materializes — focus is
// preserved. A "Bulk Edit" toggle swaps the table for a `key: value` textarea.

import { useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { Callout } from '@/components/ui/callout';
import { InlineCodeField, TextEditor } from '@/design-system';
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
  // Renders values as password fields with a per-row reveal toggle. `true`
  // masks every row (the Vault, where every entry is inherently a secret); a
  // predicate masks only the rows it returns true for (environment variables,
  // where secrecy is opt-in per row via `secretToggle` below).
  // Mutually exclusive with `vars` — secrets aren't {{ }}-substitutable inputs.
  masked?: boolean | ((row: KeyValue) => boolean);
  // Adds a per-row lock toggle that flips `row.secret`, so a value can be
  // marked secret (masked here, and excluded from codegen/export/history the
  // same way the Vault already is) without moving it out of its environment.
  secretToggle?: boolean;
  // Shows a hint when two enabled rows share a key. `'params'` explains that
  // both are sent (URLSearchParams.append keeps duplicates); `'headers'`
  // explains that only the last one wins (a plain object assignment) — real
  // HTTP semantics, not a bug, so this only makes the divergence visible.
  duplicateKeyHint?: 'params' | 'headers';
}

const isFilled = (r: KeyValue) => r.key !== '' || r.value !== '';

const DUPLICATE_KEY_TEXT: Record<'params' | 'headers', string> = {
  params: 'Both values are sent — repeated query params are all included.',
  headers: 'Only the last value is sent — a repeated header name overwrites earlier ones.',
};

export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = 'Name',
  valuePlaceholder = 'Value',
  nameLabel = 'Name',
  valueLabel = 'Value',
  bulkEdit = true,
  vars,
  masked = false,
  secretToggle = false,
  duplicateKeyHint,
}: Props) {
  const isMasked = (row: KeyValue) => (typeof masked === 'function' ? masked(row) : masked);
  const [bulk, setBulk] = useState(false);
  // Bulk mode keeps its own text so newlines/spacing survive while typing; rows
  // are parsed out of it in the background and committed via onChange.
  const [bulkText, setBulkText] = useState('');
  const ghostRef = useRef(newKeyValue());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Only the filled rows are "real"; the trailing ghost represents the next row.
  const realRows = rows.filter(isFilled);
  const ghost = ghostRef.current;
  const displayRows = [...realRows, ghost];

  const hasDuplicateKeys = useMemo(() => {
    if (!duplicateKeyHint) return false;
    const seen = new Set<string>();
    for (const r of realRows) {
      if (!r.enabled || !r.key) continue;
      if (seen.has(r.key)) return true;
      seen.add(r.key);
    }
    return false;
  }, [realRows, duplicateKeyHint]);

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
        <TextEditor
          value={bulkText}
          onChange={parseBulk}
          placeholder={`${keyPlaceholder}: ${valuePlaceholder}`}
        />
      </div>
    );
  }

  const gridCols = secretToggle ? 'grid-cols-[1rem_1fr_1fr_2rem_2rem]' : 'grid-cols-[1rem_1fr_1fr_2rem]';

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden rounded-md border text-xs">
        {/* Header row */}
        <div className={cn('grid border-b bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70', gridCols)}>
          <div />
          <div className="border-r px-3 py-1.5">{nameLabel}</div>
          <div className="border-r px-3 py-1.5">{valueLabel}</div>
          {secretToggle && <div />}
          <div />
        </div>

        {displayRows.map((row) => {
          const isGhost = row.id === ghost.id;
          const disabled = !isGhost && !row.enabled;
          const secret = isMasked(row);
          return (
            <div key={row.id} className={cn('group grid border-b last:border-b-0 hover:bg-muted/20 focus-within:bg-muted/20 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring/40 transition-colors', gridCols)}>
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
                    <InlineCodeField
                      value={row.value}
                      onChange={(v) => editRow(row.id, { value: v })}
                      vars={vars}
                      placeholder={valuePlaceholder}
                    />
                  </div>
                ) : secret ? (
                  <div className={cn('flex h-9 items-center gap-0.5', disabled && 'opacity-40')}>
                    <Input
                      type={revealed.has(row.id) ? 'text' : 'password'}
                      value={row.value}
                      onChange={(e) => editRow(row.id, { value: e.target.value })}
                      placeholder={valuePlaceholder}
                      className="h-9 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {!isGhost && (
                      <button
                        type="button"
                        onClick={() => toggleReveal(row.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:text-foreground"
                        title={revealed.has(row.id) ? 'Hide value' : 'Reveal value'}
                      >
                        {revealed.has(row.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    )}
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
              {/* Secret toggle */}
              {secretToggle && (
                <div className="flex items-center justify-center">
                  {!isGhost && (
                    <button
                      type="button"
                      onClick={() => editRow(row.id, { secret: !row.secret })}
                      className={cn(
                        'rounded p-1 transition-colors',
                        row.secret ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-foreground',
                      )}
                      title={row.secret ? 'Marked as secret — masked here and excluded from generated code/export' : 'Mark as secret'}
                    >
                      {row.secret ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              )}
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

      {hasDuplicateKeys && duplicateKeyHint && (
        <Callout tone="info" size="sm">Duplicate name — {DUPLICATE_KEY_TEXT[duplicateKeyHint]}</Callout>
      )}

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
