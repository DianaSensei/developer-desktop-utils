// Request builder: the Params / Headers / Body / Auth editor tabs. The method +
// URL + Send bar lives above the split (see AddressBar). Edits are written
// straight back to the store so the request is always saved (Postman autosave).

import { useMemo, useRef, useState } from 'react';
import {
  Braces, Check, ChevronDown, Code2, Database, File, FileText, FormInput,
  Hexagon, type LucideIcon, Tag, Trash2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { KeyValueEditor } from './KeyValueEditor';
import { MultipartEditor } from './MultipartEditor';
import { CodeEditor } from './CodeEditor';
import { VarInput } from './VarInput';
import { ResponsiveTabBar } from './ResponsiveTabBar';
import { AuthEditor } from './AuthEditor';
import { urlWithParams } from './request';
import {
  type ApiRequest, type Assertion, type AssertOperator, type BodyMode,
  type KeyValue, type VarDef, type VarMap, ASSERT_OPERATORS, UNARY_ASSERT_OPERATORS, newAssertion, newKeyValue,
} from './types';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'script' | 'vars' | 'assert' | 'tests' | 'settings';

interface Props {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
  vars: VarMap;
}

const count = (n: number) => (n ? ` (${n})` : '');

export function RequestPanel({ request, onChange, vars }: Props) {
  const [tab, setTab] = useState<Tab>('params');

  const enabledParams = request.params.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key).length;

  const hasScript = !!(request.script.req.trim() || request.script.res.trim());
  const hasVars = request.vars.req.length > 0 || request.vars.res.length > 0;
  const enabledAsserts = request.assertions.filter((a) => a.enabled && a.expr).length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'params', label: `Params${count(enabledParams)}` },
    { id: 'body', label: `Body${request.body.mode !== 'none' ? ' •' : ''}` },
    { id: 'headers', label: `Headers${count(enabledHeaders)}` },
    { id: 'auth', label: `Auth${request.auth.type !== 'none' ? ' •' : ''}` },
    { id: 'vars', label: `Vars${hasVars ? ' •' : ''}` },
    { id: 'script', label: `Script${hasScript ? ' •' : ''}` },
    { id: 'assert', label: `Assert${count(enabledAsserts)}` },
    { id: 'tests', label: `Tests${request.tests.trim() ? ' •' : ''}` },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* tab bar — collapses into » when narrow */}
      <ResponsiveTabBar
        tabs={tabs}
        active={tab}
        onSelect={(id) => setTab(id as Tab)}
        right={tab === 'body' ? <BodyModeDropdown body={request.body} onChange={onChange} /> : undefined}
      />

      {/* tab body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'params' && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Query</Label>
              {/* Editing params rewrites the URL's query string (kept in sync). */}
              <KeyValueEditor rows={request.params} onChange={(params) => onChange({ params, url: urlWithParams(request.url, params) })} vars={vars} />
            </div>
            <PathParamsEditor request={request} onChange={onChange} vars={vars} />
          </div>
        )}
        {tab === 'headers' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3"><KeyValueEditor rows={request.headers} onChange={(headers) => onChange({ headers })} keyPlaceholder="Header" vars={vars} /></div>
        )}
        {tab === 'body' && <div className="flex min-h-0 flex-1 flex-col p-3"><BodyEditor request={request} onChange={onChange} vars={vars} /></div>}
        {tab === 'auth' && <div className="min-h-0 flex-1 overflow-y-auto p-3"><AuthEditor auth={request.auth} onChange={(auth) => onChange({ auth })} vars={vars} /></div>}
        {tab === 'script' && <ScriptEditor request={request} onChange={onChange} />}
        {tab === 'vars' && <div className="min-h-0 flex-1 overflow-y-auto p-3"><VarsEditor request={request} onChange={onChange} /></div>}
        {tab === 'assert' && <div className="min-h-0 flex-1 overflow-y-auto p-3"><AssertEditor request={request} onChange={onChange} /></div>}
        {tab === 'settings' && <div className="min-h-0 flex-1 overflow-y-auto p-3"><SettingsEditor request={request} onChange={onChange} /></div>}
        {tab === 'tests' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <p className="text-[11px] text-muted-foreground">
              Post-response test script — use <code className="rounded bg-muted px-1">test()</code> and <code className="rounded bg-muted px-1">expect()</code> with <code className="rounded bg-muted px-1">res</code>, <code className="rounded bg-muted px-1">bru</code>.
            </p>
            <CodeEditor
              value={request.tests}
              onChange={(tests) => onChange({ tests })}
              placeholder={'test("status is 200", function () {\n  expect(res.getStatus()).to.equal(200);\n});'}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── scripts ──────────────────────────────────────────────────────────────────

function ScriptEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { script } = request;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <Label className="text-xs">Pre-request <span className="font-normal text-muted-foreground">— runs before send; mutate <code className="rounded bg-muted px-1">req</code>, set <code className="rounded bg-muted px-1">bru</code> vars</span></Label>
        <CodeEditor
          value={script.req}
          onChange={(v) => onChange({ script: { ...script, req: v } })}
          placeholder={"bru.setVar('ts', Date.now());\nreq.setHeader('X-Trace', 'abc');"}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <Label className="text-xs">Post-response <span className="font-normal text-muted-foreground">— runs after response; read <code className="rounded bg-muted px-1">res</code>, set <code className="rounded bg-muted px-1">bru</code> vars</span></Label>
        <CodeEditor
          value={script.res}
          onChange={(v) => onChange({ script: { ...script, res: v } })}
          placeholder={"bru.setVar('token', res.getBody().token);"}
        />
      </div>
    </div>
  );
}

// ─── vars (declarative) ───────────────────────────────────────────────────────

const toKv = (defs: VarDef[]): KeyValue[] =>
  defs.map((d) => ({ id: d.id, key: d.name, value: d.value, enabled: d.enabled }));
const fromKv = (rows: KeyValue[]): VarDef[] =>
  rows.map((r) => ({ id: r.id, name: r.key, value: r.value, enabled: r.enabled }));

function VarsEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { vars } = request;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Pre Request</Label>
        <KeyValueEditor
          rows={toKv(vars.req)}
          onChange={(rows) => onChange({ vars: { ...vars, req: fromKv(rows) } })}
          valuePlaceholder="Value"
          valueLabel="Value"
          bulkEdit={false}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Post Response</Label>
        <KeyValueEditor
          rows={toKv(vars.res)}
          onChange={(rows) => onChange({ vars: { ...vars, res: fromKv(rows) } })}
          valuePlaceholder="Expr"
          valueLabel="Expr"
          bulkEdit={false}
        />
      </div>
    </div>
  );
}

// ─── assertions (declarative) ─────────────────────────────────────────────────

const assertInputCls = 'h-8 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0';

function AssertEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { assertions } = request;
  const ghostRef = useRef(newAssertion());

  const isFilled = (a: Assertion) => a.expr !== '' || a.value !== '';
  const realRows = assertions.filter(isFilled);
  const ghost = ghostRef.current;
  const displayRows = [...realRows, ghost];

  const editRow = (id: string, patch: Partial<Assertion>) => {
    if (id === ghost.id) {
      const materialized = { ...ghost, ...patch };
      ghostRef.current = newAssertion();
      onChange({ assertions: [...realRows, materialized] });
      return;
    }
    onChange({ assertions: realRows.map((a) => (a.id === id ? { ...a, ...patch } : a)).filter(isFilled) });
  };
  const removeRow = (id: string) => onChange({ assertions: realRows.filter((a) => a.id !== id) });

  return (
    <div className="overflow-hidden rounded-md border text-xs">
      {/* header */}
      <div className="grid grid-cols-[1fr_12rem_1fr_2rem] border-b bg-muted/30 font-semibold">
        <div className="border-r px-3 py-1.5">Expr</div>
        <div className="border-r px-3 py-1.5">Operator</div>
        <div className="border-r px-3 py-1.5">Value</div>
        <div />
      </div>

      {displayRows.map((a) => {
        const isGhost = a.id === ghost.id;
        const unary = UNARY_ASSERT_OPERATORS.includes(a.operator);
        return (
          <div key={a.id} className="grid grid-cols-[1fr_12rem_1fr_2rem] border-b last:border-b-0">
            {/* expr cell with enable checkbox */}
            <div className="flex items-center gap-1.5 border-r px-2">
              <button
                type="button"
                onClick={() => !isGhost && editRow(a.id, { enabled: !a.enabled })}
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  isGhost ? 'invisible' : a.enabled ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )}
                title={a.enabled ? 'Enabled' : 'Disabled'}
              >
                {!isGhost && a.enabled && <Check className="h-2.5 w-2.5" />}
              </button>
              <Input
                value={a.expr}
                onChange={(e) => editRow(a.id, { expr: e.target.value })}
                placeholder="Expr"
                className={cn(assertInputCls, !isGhost && !a.enabled && 'opacity-50')}
                spellCheck={false}
              />
            </div>

            {/* operator cell */}
            <div className="flex items-center border-r">
              <Select value={a.operator} onValueChange={(v) => editRow(a.id, { operator: v as AssertOperator })}>
                <SelectTrigger className="h-8 w-full border-0 bg-transparent px-2 text-xs shadow-none focus:ring-0"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {ASSERT_OPERATORS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* value cell (hidden for unary operators) */}
            <div className="border-r px-2">
              {!unary && (
                <Input
                  value={a.value}
                  onChange={(e) => editRow(a.id, { value: e.target.value })}
                  placeholder="Value"
                  className={cn(assertInputCls, !isGhost && !a.enabled && 'opacity-50')}
                  spellCheck={false}
                />
              )}
            </div>

            {/* action cell */}
            <div className="flex items-center justify-center">
              {!isGhost && (
                <button type="button" onClick={() => removeRow(a.id)} title="Remove" className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-destructive">
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

// ─── path params ──────────────────────────────────────────────────────────────

function PathParamsEditor({ request, onChange, vars }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void; vars: VarMap }) {
  // Path params are the :placeholders that follow a '/' in the URL.
  const names = useMemo(() => {
    const found: string[] = [];
    const re = /\/:([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(request.url))) if (!found.includes(m[1])) found.push(m[1]);
    return found;
  }, [request.url]);

  if (names.length === 0) return null;

  const valueOf = (name: string) => request.pathParams.find((p) => p.key === name)?.value ?? '';
  const setValue = (name: string, value: string) => {
    const exists = request.pathParams.some((p) => p.key === name);
    const next = exists
      ? request.pathParams.map((p) => (p.key === name ? { ...p, value } : p))
      : [...request.pathParams, newKeyValue(name, value)];
    onChange({ pathParams: next });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Path</Label>
      <div className="overflow-hidden rounded-md border text-xs">
        <div className="grid grid-cols-[1fr_1fr] border-b bg-muted/30 font-semibold">
          <div className="border-r px-3 py-1.5">Name</div>
          <div className="px-3 py-1.5">Value</div>
        </div>
        {names.map((name) => (
          <div key={name} className="grid grid-cols-[1fr_1fr] border-b last:border-b-0">
            <div className="flex items-center border-r px-3 py-1 font-mono text-muted-foreground">:{name}</div>
            <div className="flex h-8 items-center px-2">
              <VarInput
                value={valueOf(name)}
                onChange={(v) => setValue(name, v)}
                vars={vars}
                placeholder="Value"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── settings ─────────────────────────────────────────────────────────────────

function SettingsEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const settings = request.settings;
  const set = (patch: Partial<typeof settings>) => onChange({ settings: { ...settings, ...patch } });
  const [tagDraft, setTagDraft] = useState('');

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (tag && !settings.tags.includes(tag)) set({ tags: [...settings.tags, tag] });
    setTagDraft('');
  };

  return (
    <div className="max-w-xl space-y-6">
      <p className="text-xs text-muted-foreground">Configure request settings for this item.</p>

      {/* Tags */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs"><Tag className="h-3.5 w-3.5" /> Tags</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
          {settings.tags.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {t}
              <button onClick={() => set({ tags: settings.tags.filter((x) => x !== t) })} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); }
              if (e.key === 'Backspace' && !tagDraft && settings.tags.length) set({ tags: settings.tags.slice(0, -1) });
            }}
            onBlur={() => addTag(tagDraft)}
            placeholder={settings.tags.length ? '' : 'e.g., smoke, regression'}
            className="min-w-[8rem] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            spellCheck={false}
          />
        </div>
      </div>

      <ToggleRow
        title="URL Encoding"
        hint="Automatically encode query parameters in the URL"
        checked={settings.encodeUrl}
        onChange={(encodeUrl) => set({ encodeUrl })}
      />
      <ToggleRow
        title="Automatically Follow Redirects"
        hint="Follow HTTP redirects automatically"
        checked={settings.followRedirects}
        onChange={(followRedirects) => set({ followRedirects })}
      />

      <NumberRow
        title="Max Redirects"
        hint="Set a limit for the number of redirects to follow"
        value={settings.maxRedirects}
        disabled={!settings.followRedirects}
        onChange={(maxRedirects) => set({ maxRedirects })}
      />
      <NumberRow
        title="Timeout (ms)"
        hint="Set maximum time to wait before aborting the request"
        value={settings.timeout}
        clearable
        onChange={(timeout) => set({ timeout })}
      />
    </div>
  );
}

function ToggleRow({ title, hint, checked, onChange }: {
  title: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function NumberRow({ title, hint, value, onChange, disabled, clearable }: {
  title: string; hint: string; value: number; onChange: (v: number) => void; disabled?: boolean; clearable?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', disabled && 'opacity-50')}>
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="relative w-28 shrink-0">
        <Input
          type="number"
          min={0}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="h-8 text-xs"
        />
        {clearable && value > 0 && (
          <button onClick={() => onChange(0)} title="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── body ───────────────────────────────────────────────────────────────────

const BODY_LABEL: Record<BodyMode, string> = {
  none: 'No Body',
  json: 'JSON', xml: 'XML', text: 'TEXT', sparql: 'SPARQL',
  graphql: 'GraphQL',
  multipart: 'Multipart Form', urlencoded: 'Form URL Encoded',
  file: 'File / Binary',
};

const RAW_PLACEHOLDER: Partial<Record<BodyMode, string>> = {
  json: '{\n  "key": "value"\n}',
  xml: '<root>\n  <key>value</key>\n</root>',
  text: 'Raw request body',
  sparql: 'SELECT * WHERE { ?s ?p ?o } LIMIT 10',
};

const BODY_GROUPS: { label: string; items: { id: BodyMode; icon: LucideIcon }[] }[] = [
  { label: 'Form', items: [{ id: 'multipart', icon: FormInput }, { id: 'urlencoded', icon: FormInput }] },
  { label: 'Raw', items: [{ id: 'json', icon: Braces }, { id: 'xml', icon: Code2 }, { id: 'text', icon: FileText }, { id: 'sparql', icon: Database }] },
  { label: 'GraphQL', items: [{ id: 'graphql', icon: Hexagon }] },
  { label: 'Other', items: [{ id: 'file', icon: File }, { id: 'none', icon: X }] },
];

// The grouped body-type selector that sits at the right of the request tab bar.
function BodyModeDropdown({ body, onChange }: { body: ApiRequest['body']; onChange: (p: Partial<ApiRequest>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 py-2 text-xs font-medium text-amber-500 hover:text-amber-400"
      >
        {BODY_LABEL[body.mode]} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border bg-popover p-1.5 shadow-md">
            {BODY_GROUPS.map((group) => (
              <div key={group.label} className="py-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                {group.items.map(({ id, icon: Icon }) => {
                  const active = body.mode === id;
                  return (
                    <button
                      key={id}
                      onClick={() => { onChange({ body: { ...body, mode: id } }); setOpen(false); }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
                        active && 'bg-amber-400/10 text-amber-500',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">{BODY_LABEL[id]}</span>
                      {active && <Check className="h-3.5 w-3.5 text-amber-500" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BodyEditor({ request, onChange, vars }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void; vars: VarMap }) {
  const { body } = request;
  const setBody = (patch: Partial<typeof body>) => onChange({ body: { ...body, ...patch } });

  if (body.mode === 'none') {
    return <p className="text-sm text-muted-foreground">No Body</p>;
  }
  if (body.mode === 'multipart') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MultipartEditor rows={body.form} onChange={(form) => setBody({ form })} />
      </div>
    );
  }
  if (body.mode === 'urlencoded') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <KeyValueEditor rows={body.form} onChange={(form) => setBody({ form })} keyPlaceholder="Key" valueLabel="Value" vars={vars} />
      </div>
    );
  }
  if (body.mode === 'file') {
    return <FileBody body={body} setBody={setBody} />;
  }
  if (body.mode === 'graphql') {
    const g = body.graphql ?? { query: '', variables: '' };
    const setG = (patch: Partial<typeof g>) => setBody({ graphql: { ...g, ...patch } });
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-[2] flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Query</Label>
          <CodeEditor value={g.query} onChange={(query) => setG({ query })} placeholder={'query {\n  field\n}'} vars={vars} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Variables</Label>
          <CodeEditor value={g.variables} onChange={(variables) => setG({ variables })} placeholder={'{\n  "id": 1\n}'} vars={vars} />
        </div>
      </div>
    );
  }
  // raw text modes (json / xml / text / sparql)
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <CodeEditor
        value={body.raw}
        onChange={(raw) => setBody({ raw })}
        placeholder={RAW_PLACEHOLDER[body.mode]}
        vars={vars}
      />
    </div>
  );
}

function FileBody({ body, setBody }: { body: ApiRequest['body']; setBody: (p: Partial<ApiRequest['body']>) => void }) {
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] ?? '';
        setBody({ fileName: file.name, fileType: file.type, fileContent: base64 });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div className="space-y-3 text-xs">
      {body.fileName ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{body.fileName}</span>
          {body.fileType && <span className="text-muted-foreground">{body.fileType}</span>}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7" onClick={pick}>Change</Button>
            <button
              onClick={() => setBody({ fileName: undefined, fileType: undefined, fileContent: undefined })}
              className="rounded p-1 text-muted-foreground/60 hover:text-destructive"
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={pick}>Choose file…</Button>
      )}
    </div>
  );
}

