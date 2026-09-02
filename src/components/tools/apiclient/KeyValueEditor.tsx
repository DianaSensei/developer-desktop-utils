// Editable Name/Value table (Bruno-style) shared by query params, headers, form
// bodies, and environment variables.
//
// There is always exactly one trailing empty row: typing into it materializes it
// into a real row and a fresh empty row appears below. Empty rows never linger
// above the last one. The trailing row keeps a stable id (held in a ref) so the
// input the user is typing in is never remounted when it materializes — focus is
// preserved. A "Bulk Edit" toggle swaps the table for a `key: value` textarea.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check, Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { Callout } from '@/components/ui/callout';
import { InlineCodeField, TextEditor } from '@/design-system';
import { copyToClipboard } from '@/lib/clipboard';
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
  // Hides rows whose key/value don't match (case-insensitive substring) —
  // for a large table (an environment with dozens of variables). This only
  // narrows what's *rendered*: `onChange` still always receives every row,
  // filtered or not, so editing while filtered can never silently drop the
  // rows currently hidden from view. The trailing ghost row is never hidden,
  // so a new row can still be added while filtered.
  filterQuery?: string;
}

const isFilled = (r: KeyValue) => r.key !== '' || r.value !== '';

const DUPLICATE_KEY_TEXT: Record<'params' | 'headers', string> = {
  params: 'Both values are sent — repeated query params are all included.',
  headers: 'Only the last value is sent — a repeated header name overwrites earlier ones.',
};

/**
 * Whether two enabled rows collide on name, by the rules of the thing being
 * edited — exported for its own test.
 *
 * Header names are case-insensitive (RFC 7230) and request.ts's `buildHeaders`
 * folds them that way: `Accept` and `accept` are one header and only the last
 * survives. A case-only difference is precisely the collision hardest to spot
 * by eye, and the exact-match check this used to do stayed silent for it.
 * Query parameters are the opposite — `id` and `ID` really are two different
 * params — so those keep comparing exactly.
 */
export function hasDuplicateNames(rows: KeyValue[], kind: 'params' | 'headers'): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.enabled || !r.key) continue;
    const name = kind === 'headers' ? r.key.toLowerCase() : r.key;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}

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
  filterQuery,
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

  // Masked values otherwise need reveal → select → copy just to get one
  // secret onto the clipboard. This is scoped to the masked branch only —
  // a plain-text row's <Input> is already a click-select-copy away, so a
  // dedicated button there would just be a second way to do the same thing.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const copyValue = async (row: KeyValue) => {
    if (!row.value) return;
    await copyToClipboard(row.value);
    setCopiedId(row.id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1200);
  };

  // Only the filled rows are "real"; the trailing ghost represents the next row.
  const realRows = rows.filter(isFilled);
  const ghost = ghostRef.current;
  const q = filterQuery?.trim().toLowerCase() ?? '';
  const visibleRows = q
    ? realRows.filter((r) => r.key.toLowerCase().includes(q) || r.value.toLowerCase().includes(q))
    : realRows;
  const displayRows = [...visibleRows, ghost];

  const hasDuplicateKeys = useMemo(
    () => (duplicateKeyHint ? hasDuplicateNames(realRows, duplicateKeyHint) : false),
    [realRows, duplicateKeyHint],
  );

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
      // The mode toggle keeps the same corner and the same weight in both
      // modes. It used to sit *below* the table and *above* the textarea, and
      // switch from a muted label to an accent link — so the one control you
      // need to get back moved ~200px and changed appearance the moment you
      // used it.
      <div className="space-y-1.5">
        <TextEditor
          value={bulkText}
          onChange={parseBulk}
          placeholder={`${keyPlaceholder}: ${valuePlaceholder}`}
          vars={vars}
        />
        <div className="flex justify-end">
          <button onClick={() => setBulk(false)} className="text-[11px] text-fg-mute transition-colors hover:text-fg">
            Key-Value Edit
          </button>
        </div>
      </div>
    );
  }

  // `minmax(0,1fr)`, never a bare `1fr`. Every row here is its OWN grid
  // container, so track sizes are computed per row — and `1fr` is shorthand for
  // `minmax(auto, 1fr)`, whose `auto` floor is the cell's min-content width. One
  // row holding something that can't shrink (a JWT in the CodeMirror value cell)
  // therefore resized that row alone: its Name column collapsed to 21px while
  // Value ballooned to 1149px in a 438px table, so the columns stopped lining up
  // with every other row. Pinning the floor to 0 makes all rows agree whatever
  // they contain.
  // The leading column is 2rem, not 1rem: the whole cell is the enable/disable
  // target (see the row below), so this width is the target's width. The dot
  // inside stays 8px — the affordance grew, the visual didn't.
  const gridCols = secretToggle
    ? 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem_2rem]'
    : 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem]';

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden rounded-md border text-xs">
        {/* Header row */}
        <div className={cn('grid border-b bg-bg-2/40 text-[11px] font-semibold uppercase tracking-wide text-fg-mute', gridCols)}>
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
            <div key={row.id} className={cn('group grid border-b last:border-b-0 hover:bg-bg-2/20 focus-within:bg-bg-2/20 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-focus transition-colors', gridCols)}>
              {/* Enable/disable. The button IS the cell — clicking anywhere in
                  the leading column toggles the row, not just the checkbox
                  glyph itself, so the target stays the full ~34px cell people
                  actually aim for. The Name/Value cells keep their normal
                  behavior: they're editors, so a click there has to place the
                  caret, not toggle the row. */}
              <div className="flex items-stretch">
                {isGhost ? (
                  <span className="w-full" />
                ) : (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={row.enabled}
                    aria-label={`${row.key || keyPlaceholder} — ${row.enabled ? 'enabled' : 'disabled'}`}
                    onClick={() => editRow(row.id, { enabled: !row.enabled })}
                    className="group/toggle flex w-full cursor-pointer items-center justify-center transition-colors hover:bg-bg-2/60 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus"
                    title={row.enabled ? 'Disable' : 'Enable'}
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                        row.enabled
                          ? 'border-acc bg-acc text-acc-fg group-hover/toggle:border-acc-hi group-hover/toggle:bg-acc-hi'
                          : 'border-sunk bg-bg group-hover/toggle:border-fg-mute',
                      )}
                    >
                      {row.enabled && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                  </button>
                )}
              </div>
              {/* Name cell */}
              <div className="min-w-0 border-r px-1.5">
                <Input
                  value={row.key}
                  onChange={(e) => editRow(row.id, { key: e.target.value })}
                  placeholder={keyPlaceholder}
                  className={cn('h-ctl border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', disabled && 'opacity-40 line-through')}
                  spellCheck={false}
                />
              </div>
              {/* Value cell */}
              <div className="min-w-0 border-r px-1.5">
                {vars ? (
                  <div className={cn('flex h-ctl min-w-0 items-center', disabled && 'opacity-40')}>
                    <InlineCodeField
                      value={row.value}
                      onChange={(v) => editRow(row.id, { value: v })}
                      vars={vars}
                      placeholder={valuePlaceholder}
                    />
                  </div>
                ) : secret ? (
                  <div className={cn('flex h-ctl min-w-0 items-center gap-0.5', disabled && 'opacity-40')}>
                    <Input
                      type={revealed.has(row.id) ? 'text' : 'password'}
                      value={row.value}
                      onChange={(e) => editRow(row.id, { value: e.target.value })}
                      placeholder={valuePlaceholder}
                      className="h-ctl border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {!isGhost && (
                      <button
                        type="button"
                        onClick={() => toggleReveal(row.id)}
                        className="shrink-0 rounded p-1 text-fg-mute/50 transition-colors hover:text-fg"
                        title={revealed.has(row.id) ? 'Hide value' : 'Reveal value'}
                      >
                        {revealed.has(row.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    )}
                    {!isGhost && row.value && (
                      <button
                        type="button"
                        onClick={() => copyValue(row)}
                        className="shrink-0 rounded p-1 text-fg-mute/50 transition-colors hover:text-fg"
                        title={copiedId === row.id ? 'Copied' : 'Copy value'}
                      >
                        {copiedId === row.id ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                ) : (
                  <Input
                    value={row.value}
                    onChange={(e) => editRow(row.id, { value: e.target.value })}
                    placeholder={valuePlaceholder}
                    className={cn('h-ctl border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', disabled && 'opacity-40')}
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
                        row.secret ? 'text-acc-ink hover:text-acc' : 'text-fg-mute/40 opacity-0 group-hover:opacity-100 hover:text-fg',
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
                    className="rounded p-1 text-fg-mute/40 opacity-0 transition-all group-hover:opacity-100 hover:text-bad"
                    title="Remove"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {q && visibleRows.length === 0 && (
          <p className="px-3 py-3 text-center text-[11px] text-fg-mute">
            No rows match &ldquo;{filterQuery}&rdquo; — {realRows.length} hidden.
          </p>
        )}
      </div>

      {hasDuplicateKeys && duplicateKeyHint && (
        <Callout tone="info" size="sm">Duplicate name — {DUPLICATE_KEY_TEXT[duplicateKeyHint]}</Callout>
      )}

      {bulkEdit && (
        <div className="flex justify-end">
          <button onClick={enterBulk} className="text-[11px] text-fg-mute transition-colors hover:text-fg">
            Bulk Edit
          </button>
        </div>
      )}
    </div>
  );
}
