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
import { InlineCodeField, SearchInput, TextEditor } from '@/design-system';
import { copyToClipboard } from '@/lib/clipboard';
import { type KeyValue, type VarMap, newKeyValue } from './types';
import { ResolvedValue, showsResolvedColumn } from './ResolvedValue';

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

/** Rows past which the table shows its own search box. Below this, scanning
 *  the list by eye is faster than typing a filter. */
const FILTER_THRESHOLD = 8;

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

/**
 * Rows → the `key: value` text shown in bulk mode. Disabled rows round-trip
 * with a leading `//` (Postman's convention), so toggling a row off and then
 * editing in bulk doesn't silently re-enable it.
 */
export function toBulkText(rows: KeyValue[]): string {
  return rows.map((r) => `${r.enabled ? '' : '//'}${r.key}:${r.value}`).join('\n');
}

/**
 * The inverse. Blank lines are skipped; a line with no `:` is a name with an
 * empty value; whitespace around each part is trimmed. Exported (and pure) so
 * the round trip can be tested without a React tree.
 */
export function parseBulkText(text: string): KeyValue[] {
  const parsed: KeyValue[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    const enabled = !line.startsWith('//');
    if (!enabled) line = line.slice(2).trim();
    const idx = line.indexOf(':');
    const k = (idx === -1 ? line : line.slice(0, idx)).trim();
    const v = idx === -1 ? '' : line.slice(idx + 1).trim();
    if (k || v) parsed.push({ ...newKeyValue(k, v), enabled });
  }
  return parsed;
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
  const [ownFilter, setOwnFilter] = useState('');
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
  // Two filters, ANDed: the caller's (the environment editor's search box)
  // and this table's own, which appears once a table is long enough to be
  // worth searching — a urlencoded body with thirty fields is a wall of
  // identical-looking rows otherwise.
  const q = filterQuery?.trim().toLowerCase() ?? '';
  const ownQ = ownFilter.trim().toLowerCase();
  const matches = (r: KeyValue, needle: string) =>
    r.key.toLowerCase().includes(needle) || r.value.toLowerCase().includes(needle);
  const visibleRows = realRows.filter(
    (r) => (!q || matches(r, q)) && (!ownQ || matches(r, ownQ)),
  );
  const displayRows = [...visibleRows, ghost];
  const showOwnFilter = realRows.length >= FILTER_THRESHOLD;

  // The Resolved column earns its width only when something in this table
  // actually uses a {{token}} — an always-on empty column in the common case
  // (headers with literal values) would be pure noise. It appears the moment
  // the first token is typed, which is also the moment it becomes useful.
  // Driven by every row, not just the visible ones: filtering down to rows
  // without tokens shouldn't drop a column out from under the table mid-type.
  const showResolved = showsResolvedColumn(realRows.map((r) => r.value), vars);

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

  const enterBulk = () => {
    setBulkText(toBulkText(realRows));
    setBulk(true);
  };

  const parseBulk = (value: string) => {
    setBulkText(value);
    onChange(parseBulkText(value));
  };

  if (bulk) {
    return (
      // The mode toggle keeps the same corner and the same weight in both
      // modes. It used to sit *below* the table and *above* the textarea, and
      // switch from a muted label to an accent link — so the one control you
      // need to get back moved ~200px and changed appearance the moment you
      // used it.
      //
      // `h-full` + `flex-1` on the editor, and a viewport-fraction floor
      // rather than CodeSurface's fixed `min-h-[180px]`: bulk edit is where
      // someone pastes or reworks a whole set of params at once, and 180px
      // (about 9 lines) stayed 180px no matter how large the window got. Now
      // it fills whatever height the pane gives it, and never less than a
      // third of the viewport.
      <div className="flex h-full min-h-0 flex-col gap-1.5">
        <TextEditor
          value={bulkText}
          onChange={parseBulk}
          placeholder={`${keyPlaceholder}: ${valuePlaceholder}`}
          vars={vars}
          className="min-h-[34vh] flex-1"
        />
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-[11px] text-fg-mute">
            One <code className="rounded bg-bg-2 px-1">{keyPlaceholder.toLowerCase()}: {valuePlaceholder.toLowerCase()}</code> per line
            {/* `{'//'}`, not a bare `//`: as raw JSX children those two
                characters read as the start of a comment to anything parsing
                this file (a linter flagged exactly that), even though React
                renders them as the literal text we want here. */}
            {' · '}prefix <code className="rounded bg-bg-2 px-1">{'//'}</code> to disable a row
          </span>
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
  const gridCols = [
    'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem]',
    'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem_2rem]',
    'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]',
    'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem_2rem]',
  ][(secretToggle ? 1 : 0) + (showResolved ? 2 : 0)];

  return (
    <div className="space-y-1.5">
      {showOwnFilter && (
        <div className="flex items-center gap-2">
          <SearchInput
            value={ownFilter}
            onChange={setOwnFilter}
            placeholder={`Filter ${realRows.length} rows…`}
            className="h-ctl text-xs"
            containerClassName="min-w-0 flex-1"
            aria-label="Filter rows"
          />
          <span className="shrink-0 text-[11px] tabular-nums text-fg-mute">
            {ownQ || q ? `${visibleRows.length}/${realRows.length}` : `${realRows.length} rows`}
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-md border text-xs">
        {/* Header row */}
        <div className={cn('grid border-b bg-bg-2/40 text-[11px] font-semibold uppercase tracking-wide text-fg-mute', gridCols)}>
          <div />
          <div className="border-r px-3 py-1.5">{nameLabel}</div>
          <div className="border-r px-3 py-1.5">{valueLabel}</div>
          {showResolved && <div className="border-r px-3 py-1.5">Resolved</div>}
          {secretToggle && <div />}
          <div />
        </div>

        {displayRows.map((row, i) => (
          <KeyValueRow
            key={row.id}
            row={row}
            isGhost={row.id === ghost.id}
            // The ghost row stays unstriped — it isn't data yet.
            striped={row.id !== ghost.id && i % 2 === 1}
            gridCols={gridCols}
            keyPlaceholder={keyPlaceholder}
            valuePlaceholder={valuePlaceholder}
            vars={vars}
            masked={isMasked(row)}
            showResolved={showResolved}
            secretToggle={secretToggle}
            revealed={revealed.has(row.id)}
            copied={copiedId === row.id}
            onEdit={(patch) => editRow(row.id, patch)}
            onRemove={() => removeRow(row.id)}
            onToggleReveal={() => toggleReveal(row.id)}
            onCopy={() => copyValue(row)}
          />
        ))}
        {/* Either filter can empty the table, so both have to be able to say
            so — an empty table with a lone ghost row and no explanation reads
            as data loss. */}
        {(q || ownQ) && visibleRows.length === 0 && (
          <p className="px-3 py-3 text-center text-[11px] text-fg-mute">
            No rows match &ldquo;{ownFilter.trim() || filterQuery}&rdquo; — {realRows.length} hidden.
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

// ─── one row ──────────────────────────────────────────────────────────────────

interface RowProps {
  row: KeyValue;
  isGhost: boolean;
  striped: boolean;
  gridCols: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  vars?: VarMap;
  masked: boolean;
  showResolved: boolean;
  secretToggle: boolean;
  revealed: boolean;
  copied: boolean;
  onEdit: (patch: Partial<KeyValue>) => void;
  onRemove: () => void;
  onToggleReveal: () => void;
  onCopy: () => void;
}

/**
 * One editable row. Extracted from the table's `map` callback, which had grown
 * past what any reader (or complexity check) can hold at once: five cells,
 * three of them conditional, plus a three-way choice of value editor.
 *
 * The /20 stripe and /40 hover are DataTable's own pair (Tbody zebra + Tr
 * interactive), not new values: hover has to stay clearly stronger than the
 * stripe, or hovering a striped row reads as no feedback at all.
 */
function KeyValueRow({
  row, isGhost, striped, gridCols, keyPlaceholder, valuePlaceholder, vars, masked,
  showResolved, secretToggle, revealed, copied, onEdit, onRemove, onToggleReveal, onCopy,
}: Readonly<RowProps>) {
  const disabled = !isGhost && !row.enabled;
  return (
    <div className={cn('group grid border-b last:border-b-0 hover:bg-bg-2/40 focus-within:bg-bg-2/40 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-focus transition-colors duration-fast ease-out-soft', striped && 'bg-bg-2/20', gridCols)}>
      {/* Enable/disable. The button IS the cell — clicking anywhere in the
          leading column toggles the row, not just the checkbox glyph itself,
          so the target stays the full ~34px cell people actually aim for. The
          Name/Value cells keep their normal behavior: they're editors, so a
          click there has to place the caret, not toggle the row. */}
      <div className="flex items-stretch">
        {isGhost ? (
          <span className="w-full" />
        ) : (
          <button
            type="button"
            role="checkbox"
            aria-checked={row.enabled}
            aria-label={`${row.key || keyPlaceholder} — ${row.enabled ? 'enabled' : 'disabled'}`}
            onClick={() => onEdit({ enabled: !row.enabled })}
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
          onChange={(e) => onEdit({ key: e.target.value })}
          placeholder={keyPlaceholder}
          className={cn('h-ctl border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', disabled && 'opacity-40 line-through')}
          spellCheck={false}
        />
      </div>

      {/* Value cell */}
      <div className="min-w-0 border-r px-1.5">
        <ValueCell
          row={row} isGhost={isGhost} disabled={disabled} vars={vars} masked={masked}
          valuePlaceholder={valuePlaceholder} revealed={revealed} copied={copied}
          onEdit={onEdit} onToggleReveal={onToggleReveal} onCopy={onCopy}
        />
      </div>

      {/* Resolved value — read-only, and only for rows that use {{tokens}}.
          Values come from the same map the highlighter uses, which already
          masks Vault entries and secret-flagged variables (see previewVars),
          so nothing secret is printed here that isn't already `••••••••`
          everywhere else. */}
      {showResolved && (
        <div className={cn('flex min-w-0 items-center border-r px-2.5', disabled && 'opacity-40')}>
          {!isGhost && vars && <ResolvedValue value={row.value} vars={vars} />}
        </div>
      )}

      {/* Secret toggle */}
      {secretToggle && (
        <div className="flex items-center justify-center">
          {!isGhost && (
            <button
              type="button"
              onClick={() => onEdit({ secret: !row.secret })}
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
            onClick={onRemove}
            className="rounded p-1 text-fg-mute/40 opacity-0 transition-all group-hover:opacity-100 hover:text-bad"
            title="Remove"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

interface ValueCellProps {
  row: KeyValue;
  isGhost: boolean;
  disabled: boolean;
  vars?: VarMap;
  masked: boolean;
  valuePlaceholder: string;
  revealed: boolean;
  copied: boolean;
  onEdit: (patch: Partial<KeyValue>) => void;
  onToggleReveal: () => void;
  onCopy: () => void;
}

/**
 * The value editor, which is one of three things depending on the table:
 * {{var}}-aware (requests), masked (Vault / secret env vars), or plain text.
 * An if-chain rather than the nested ternary this used to be in JSX — the
 * three branches are unrelated components, not variations of one.
 */
function ValueCell({
  row, isGhost, disabled, vars, masked, valuePlaceholder, revealed, copied,
  onEdit, onToggleReveal, onCopy,
}: Readonly<ValueCellProps>) {
  if (vars) {
    return (
      <div className={cn('flex h-ctl min-w-0 items-center', disabled && 'opacity-40')}>
        <InlineCodeField
          value={row.value}
          onChange={(v) => onEdit({ value: v })}
          vars={vars}
          placeholder={valuePlaceholder}
        />
      </div>
    );
  }
  if (masked) {
    return (
      <div className={cn('flex h-ctl min-w-0 items-center gap-0.5', disabled && 'opacity-40')}>
        <Input
          type={revealed ? 'text' : 'password'}
          value={row.value}
          onChange={(e) => onEdit({ value: e.target.value })}
          placeholder={valuePlaceholder}
          className="h-ctl border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          spellCheck={false}
          autoComplete="off"
        />
        {!isGhost && (
          <button
            type="button"
            onClick={onToggleReveal}
            className="shrink-0 rounded p-1 text-fg-mute/50 transition-colors hover:text-fg"
            title={revealed ? 'Hide value' : 'Reveal value'}
          >
            {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        )}
        {!isGhost && row.value && (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 rounded p-1 text-fg-mute/50 transition-colors hover:text-fg"
            title={copied ? 'Copied' : 'Copy value'}
          >
            {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    );
  }
  return (
    <Input
      value={row.value}
      onChange={(e) => onEdit({ value: e.target.value })}
      placeholder={valuePlaceholder}
      className={cn('h-ctl border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0', disabled && 'opacity-40')}
      spellCheck={false}
    />
  );
}
