// Multipart form-data editor (Bruno-style): each row is a Key plus either a text
// Value or an uploaded file, with an optional explicit Content-Type. Like the
// shared KeyValueEditor it always keeps one trailing empty row that materializes
// on first edit (stable ghost id → focus is preserved).

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check, File as FileIcon, Trash2, Upload, X } from 'lucide-react';
import { InlineCodeField } from '@/design-system';
import { type KeyValue, type VarMap, newKeyValue } from './types';
import { ResolvedValue, showsResolvedColumn } from './ResolvedValue';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  // Form-data keys and values really are {{var}}-substituted on send (see
  // request.ts's multipart branch), so this editor gets the same highlight +
  // autocomplete + Resolved column as every other table. It used to be the
  // one substituted surface with no sign that substitution happens at all.
  vars?: VarMap;
}

const isFilled = (r: KeyValue) => r.key !== '' || r.value !== '' || !!r.fileName;

const inputCls = 'h-ctl border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0';

export function MultipartEditor({ rows, onChange, vars }: Props) {
  const ghostRef = useRef(newKeyValue());

  const realRows = rows.filter(isFilled);
  const ghost = ghostRef.current;
  const displayRows = [...realRows, ghost];
  // A file row's `value` is empty (the bytes live in fileContent), so only
  // text rows can carry tokens — which is exactly what this asks.
  const showResolved = showsResolvedColumn(realRows.map((r) => r.value), vars);
  const gridCols = showResolved
    ? 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_10rem_2rem]'
    : 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_10rem_2rem]';

  const editRow = (id: string, patch: Partial<KeyValue>) => {
    if (id === ghost.id) {
      const materialized = { ...ghost, ...patch };
      ghostRef.current = newKeyValue();
      onChange([...realRows, materialized]);
      return;
    }
    onChange(realRows.map((r) => (r.id === id ? { ...r, ...patch } : r)).filter(isFilled));
  };

  const removeRow = (id: string) => onChange(realRows.filter((r) => r.id !== id));

  const attachFile = (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] ?? '';
        editRow(id, { kind: 'file', value: '', fileName: file.name, fileType: file.type, fileContent: base64 });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const clearFile = (id: string) =>
    editRow(id, { kind: 'text', fileName: undefined, fileType: undefined, fileContent: undefined });

  return (
    // Content-Type is a fixed 10rem column, so a narrow pane squeezes Key and
    // Value instead; scroll sideways below the min width rather than shrink
    // them to unusable slivers.
    <div className="overflow-x-auto overflow-y-hidden rounded-md border text-xs">
      <div className={showResolved ? 'min-w-[34rem]' : 'min-w-[26rem]'}>
      {/* Header and grid match KeyValueEditor's: an uppercase muted caption
          rather than bold title case, "Name" rather than "Key", and a leading
          2rem toggle column so the Name cell starts at the same x as it does
          in the Query/Headers/Path tables above. This editor was the one table
          in the tool that kept the old treatment. */}
      <div className={cn('grid border-b bg-bg-2/40 text-[11px] font-semibold uppercase tracking-wide text-fg-mute', gridCols)}>
        <div />
        <div className="border-r px-3 py-1.5">Name</div>
        <div className="border-r px-3 py-1.5">Value</div>
        {showResolved && <div className="border-r px-3 py-1.5">Resolved</div>}
        <div className="border-r px-3 py-1.5">Content-Type</div>
        <div />
      </div>

      {displayRows.map((row, i) => {
        const isGhost = row.id === ghost.id;
        const isFile = row.kind === 'file' && !!row.fileName;
        return (
          // Zebra /20 + hover /40, the same pair as KeyValueEditor and
          // DataTable — a form-data body is just as easy to lose your place in.
          <div key={row.id} className={cn('group grid border-b last:border-b-0 transition-colors duration-fast ease-out-soft hover:bg-bg-2/40 focus-within:bg-bg-2/40 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-focus', !isGhost && i % 2 === 1 && 'bg-bg-2/20', gridCols)}>
            {/* Toggle column — the whole cell is the target, with the same
                role/aria and hover feedback KeyValueEditor's rows carry. */}
            <div className="flex items-stretch border-r">
              {isGhost ? (
                <span className="w-full" />
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={row.enabled}
                  aria-label={`${row.key || 'Field'} — ${row.enabled ? 'enabled' : 'disabled'}`}
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
            {/* name cell */}
            <div className="flex min-w-0 items-center border-r px-1.5">
              <Input
                value={row.key}
                onChange={(e) => editRow(row.id, { key: e.target.value })}
                placeholder="Name"
                className={cn(inputCls, !isGhost && !row.enabled && 'opacity-50')}
                spellCheck={false}
              />
            </div>

            {/* value cell: text input + upload, or a file chip */}
            <div className="flex min-w-0 items-center gap-1 border-r px-2">
              {isFile ? (
                <>
                  <FileIcon className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                  <span className="flex-1 truncate" title={row.fileName}>{row.fileName}</span>
                  <button type="button" onClick={() => clearFile(row.id)} title="Remove file" className="rounded p-0.5 text-fg-mute/60 hover:text-bad">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  {vars ? (
                    <div className={cn('flex h-ctl min-w-0 flex-1 items-center', !isGhost && !row.enabled && 'opacity-50')}>
                      <InlineCodeField
                        value={row.value}
                        onChange={(v) => editRow(row.id, { value: v })}
                        vars={vars}
                        placeholder="Value"
                      />
                    </div>
                  ) : (
                    <Input
                      value={row.value}
                      onChange={(e) => editRow(row.id, { value: e.target.value })}
                      placeholder="Value"
                      className={cn(inputCls, !isGhost && !row.enabled && 'opacity-50')}
                      spellCheck={false}
                    />
                  )}
                  <button type="button" onClick={() => attachFile(row.id)} title="Attach file" className="shrink-0 rounded p-0.5 text-fg-mute/60 hover:text-fg">
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>

            {/* resolved cell — see ResolvedValue.tsx */}
            {showResolved && (
              <div className={cn('flex min-w-0 items-center border-r px-2.5', !isGhost && !row.enabled && 'opacity-50')}>
                {!isGhost && vars && !isFile && <ResolvedValue value={row.value} vars={vars} />}
              </div>
            )}
            {/* content-type cell */}
            <div className="min-w-0 border-r px-2">
              <Input
                value={row.contentType ?? ''}
                onChange={(e) => editRow(row.id, { contentType: e.target.value })}
                placeholder="Auto"
                className={cn(inputCls, !isGhost && !row.enabled && 'opacity-50')}
                spellCheck={false}
              />
            </div>

            {/* Action cell — revealed on hover/focus like every other table's,
                instead of a trash icon sitting on every row at rest. */}
            <div className="flex items-center justify-center">
              {!isGhost && (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  title="Remove"
                  className="rounded p-1 text-fg-mute/40 opacity-0 transition-all hover:text-bad group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
