// Multipart form-data editor (Bruno-style): each row is a Key plus either a text
// Value or an uploaded file, with an optional explicit Content-Type. Like the
// shared KeyValueEditor it always keeps one trailing empty row that materializes
// on first edit (stable ghost id → focus is preserved).

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check, File as FileIcon, Trash2, Upload, X } from 'lucide-react';
import { type KeyValue, newKeyValue } from './types';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}

const isFilled = (r: KeyValue) => r.key !== '' || r.value !== '' || !!r.fileName;

const inputCls = 'h-8 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0';

export function MultipartEditor({ rows, onChange }: Props) {
  const ghostRef = useRef(newKeyValue());

  const realRows = rows.filter(isFilled);
  const ghost = ghostRef.current;
  const displayRows = [...realRows, ghost];

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
    <div className="overflow-hidden rounded-md border text-xs">
      {/* header */}
      <div className="grid grid-cols-[1fr_1fr_10rem_2rem] border-b bg-muted/30 font-semibold">
        <div className="border-r px-3 py-1.5">Key</div>
        <div className="border-r px-3 py-1.5">Value</div>
        <div className="border-r px-3 py-1.5">Content-Type</div>
        <div />
      </div>

      {displayRows.map((row) => {
        const isGhost = row.id === ghost.id;
        const isFile = row.kind === 'file' && !!row.fileName;
        return (
          <div key={row.id} className="grid grid-cols-[1fr_1fr_10rem_2rem] border-b last:border-b-0">
            {/* key cell with enable checkbox */}
            <div className="flex items-center gap-1.5 border-r px-2">
              <button
                type="button"
                onClick={() => !isGhost && editRow(row.id, { enabled: !row.enabled })}
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  isGhost ? 'invisible' : row.enabled ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )}
                title={row.enabled ? 'Enabled' : 'Disabled'}
              >
                {!isGhost && row.enabled && <Check className="h-2.5 w-2.5" />}
              </button>
              <Input
                value={row.key}
                onChange={(e) => editRow(row.id, { key: e.target.value })}
                placeholder="Key"
                className={cn(inputCls, !isGhost && !row.enabled && 'opacity-50')}
                spellCheck={false}
              />
            </div>

            {/* value cell: text input + upload, or a file chip */}
            <div className="flex items-center gap-1 border-r px-2">
              {isFile ? (
                <>
                  <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate" title={row.fileName}>{row.fileName}</span>
                  <button type="button" onClick={() => clearFile(row.id)} title="Remove file" className="rounded p-0.5 text-muted-foreground/60 hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <Input
                    value={row.value}
                    onChange={(e) => editRow(row.id, { value: e.target.value })}
                    placeholder="Value"
                    className={cn(inputCls, !isGhost && !row.enabled && 'opacity-50')}
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => attachFile(row.id)} title="Attach file" className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground">
                    <Upload className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>

            {/* content-type cell */}
            <div className="border-r px-2">
              <Input
                value={row.contentType ?? ''}
                onChange={(e) => editRow(row.id, { contentType: e.target.value })}
                placeholder="Auto"
                className={cn(inputCls, !isGhost && !row.enabled && 'opacity-50')}
                spellCheck={false}
              />
            </div>

            {/* action cell */}
            <div className="flex items-center justify-center">
              {!isGhost && (
                <button type="button" onClick={() => removeRow(row.id)} title="Remove" className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
