// Test-data generator: define a field schema, pick a row count, and export
// realistic fake records as JSON, NDJSON, CSV, TSV, or SQL inserts — for seeding
// databases or feeding the Mock Server / API Client. Deterministic per seed.

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CopyButton } from '@/components/ui/copy-button';
import { CodeEditor } from '@/components/tools/apiclient/CodeEditor';
import { saveTextFile } from '@/components/tools/apiclient/fileio';
import { Plus, X, Download, RefreshCw } from 'lucide-react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { generateRows, serializeRows, ROW_FORMATS, DATE_FORMATS, FAKER_TYPE_GROUPS, type FieldDef, type FakerType, type RowFormat, type DateFormat } from '@/lib/faker';

const DEFAULT_FIELDS: FieldDef[] = [
  { id: 'f1', name: 'id', type: 'uuid' },
  { id: 'f2', name: 'name', type: 'fullName' },
  { id: 'f3', name: 'email', type: 'email' },
  { id: 'f4', name: 'age', type: 'int', min: 18, max: 80 },
];

const newId = () => `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function FakeDataGenerator() {
  const [fields, setFields] = usePersistentState<FieldDef[]>('devtool:fakeData:fields', DEFAULT_FIELDS);
  const [count, setCount] = usePersistentState('devtool:fakeData:count', 10);
  const [seed, setSeed] = usePersistentState('devtool:fakeData:seed', 1);
  const [format, setFormat] = usePersistentState<RowFormat>('devtool:fakeData:format', 'json');
  const [table, setTable] = usePersistentState('devtool:fakeData:table', 'users');
  const [prefix, setPrefix] = usePersistentState('devtool:fakeData:prefix', 'data');

  const safeCount = Math.max(1, Math.min(count || 1, 10000));

  const [output, setOutput] = useState('');

  // generateRows lazy-loads faker (async). Debounce so editing field names /
  // count doesn't regenerate on every keystroke, and ignore stale results.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const rows = await generateRows(fields, safeCount, seed >>> 0);
        const text = await serializeRows(rows, fields, format, { table, prefix });
        if (!cancelled) setOutput(text);
      })();
    }, 150);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [fields, safeCount, seed, format, table, prefix]);

  const updateField = (id: string, patch: Partial<FieldDef>) =>
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const addField = () =>
    setFields((prev) => [...prev, { id: newId(), name: `field${prev.length + 1}`, type: 'word' }]);
  const removeField = (id: string) => setFields((prev) => prev.filter((f) => f.id !== id));

  const handleDownload = () => {
    const ext = ROW_FORMATS.find((f) => f.value === format)?.ext ?? 'txt';
    if (output) void saveTextFile(`data.${ext}`, output);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 header-premium px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Input
            type="number"
            min={1}
            max={10000}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value) || 1)}
            className="h-8 w-24 text-xs rounded-lg"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Seed</span>
          <Input
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
            className="h-8 w-24 text-xs rounded-lg"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
            title="New random seed"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Format</span>
          <Select value={format} onValueChange={(v) => setFormat(v as RowFormat)}>
            <SelectTrigger className="h-8 w-28 text-xs rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROW_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {format === 'sql' && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Table</span>
            <Input
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="users"
              className="h-8 w-32 text-xs font-mono rounded-lg"
            />
          </div>
        )}
        {format === 'properties' && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Prefix</span>
            <Input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="data"
              className="h-8 w-32 text-xs font-mono rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Body: schema | output */}
      <div className="flex flex-1 min-h-0 divide-x divide-border">
        {/* Schema builder */}
        <div className="flex w-[360px] shrink-0 flex-col min-h-0">
          <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>Fields</span>
            <Button variant="ghost" size="sm" onClick={addField} className="h-6 gap-1 px-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 space-y-2">
            {fields.map((f) => (
              <div key={f.id} className="rounded-lg border border-border bg-muted/20 p-2 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={f.name}
                    onChange={(e) => updateField(f.id, { name: e.target.value })}
                    placeholder="field name"
                    className="h-7 flex-1 text-xs font-mono rounded-md"
                  />
                  <button
                    onClick={() => removeField(f.id)}
                    title="Remove field"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Select value={f.type} onValueChange={(v) => updateField(f.id, { type: v as FakerType })}>
                    <SelectTrigger className="h-7 flex-1 text-xs rounded-md"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FAKER_TYPE_GROUPS.map((g) => (
                        <SelectGroup key={g.group}>
                          <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{g.group}</SelectLabel>
                          {g.types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(f.type === 'int' || f.type === 'float') && (
                  <div className="flex items-center gap-1.5">
                    <Input type="number" value={f.min ?? 0} onChange={(e) => updateField(f.id, { min: parseFloat(e.target.value) || 0 })} placeholder="min" className="h-7 text-xs rounded-md" />
                    <Input type="number" value={f.max ?? 1000} onChange={(e) => updateField(f.id, { max: parseFloat(e.target.value) || 0 })} placeholder="max" className="h-7 text-xs rounded-md" />
                    {f.type === 'float' && (
                      <Input type="number" min={0} max={10} value={f.decimals ?? 2} onChange={(e) => updateField(f.id, { decimals: parseInt(e.target.value) || 0 })} title="decimals" className="h-7 w-16 text-xs rounded-md" />
                    )}
                  </div>
                )}
                {(f.type === 'date' || f.type === 'birthdate') && (
                  <Select value={f.dateFormat ?? (f.type === 'birthdate' ? 'isoDate' : 'iso')} onValueChange={(v) => updateField(f.id, { dateFormat: v as DateFormat })}>
                    <SelectTrigger className="h-7 text-xs rounded-md"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATE_FORMATS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          <span className="flex items-baseline gap-2">
                            {d.label}
                            <span className="font-mono text-[10px] text-muted-foreground">{d.example}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {f.type === 'enum' && (
                  <Input
                    value={f.values ?? ''}
                    onChange={(e) => updateField(f.id, { values: e.target.value })}
                    placeholder="comma,separated,values"
                    className="h-7 text-xs font-mono rounded-md"
                  />
                )}
              </div>
            ))}
            {fields.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">No fields — add one to start.</p>
            )}
          </div>
        </div>

        {/* Output */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>{safeCount.toLocaleString()} row{safeCount !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={handleDownload} disabled={!output} title="Download" className="h-6 w-6 rounded text-muted-foreground hover:text-foreground">
                <Download className="h-3.5 w-3.5" />
              </Button>
              <CopyButton value={() => output} iconClassName="h-3.5 w-3.5" disabled={!output} />
            </div>
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-3 pb-3">
            <CodeEditor
              key={`out-${format}`}
              value={output}
              onChange={() => {}}
              readOnly
              language={format === 'json' ? 'json' : format === 'sql' ? 'sql' : 'text'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
