// Request builder: method + URL bar, Send button, and the Params / Headers /
// Body / Auth editor tabs. Edits are written straight back to the store so the
// request is always saved (Postman-style autosave).

import { useState } from 'react';
import { Check, Code2, Plus, Send, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { KeyValueEditor } from './KeyValueEditor';
import { CodeEditor } from './CodeEditor';
import { methodColor } from './method-color';
import {
  type ApiRequest, type Assertion, type AssertOperator, type BodyMode, type AuthType,
  type VarDef, ASSERT_OPERATORS, HTTP_METHODS, newAssertion, newVarDef,
} from './types';

type Tab = 'params' | 'headers' | 'body' | 'auth' | 'script' | 'vars' | 'assert' | 'tests';

interface Props {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  getCurl: () => string;
}

const count = (n: number) => (n ? ` (${n})` : '');

export function RequestPanel({ request, onChange, onSend, onCancel, sending, getCurl }: Props) {
  const [tab, setTab] = useState<Tab>('params');
  const [curlCopied, setCurlCopied] = useState(false);

  const copyCurl = async () => {
    await copyToClipboard(getCurl());
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 1200);
  };

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
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* method + URL + send — one integrated bar */}
      <div className="p-3">
        <div className="flex items-center rounded-md border bg-background shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring/40">
          <Select value={request.method} onValueChange={(v) => onChange({ method: v as ApiRequest['method'] })}>
            <SelectTrigger className={cn('h-9 w-[6.5rem] shrink-0 border-0 bg-transparent font-bold shadow-none focus:ring-0', methodColor(request.method))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m}><span className={cn('font-bold', methodColor(m))}>{m}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="h-5 w-px shrink-0 bg-border" />
          <Input
            value={request.url}
            onChange={(e) => onChange({ url: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
            placeholder="https://api.example.com/endpoint  ·  {{var}} for environment values"
            className="h-9 flex-1 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0"
            spellCheck={false}
          />
          <button
            onClick={copyCurl}
            title="Copy as cURL"
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {curlCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Code2 className="h-4 w-4" />}
          </button>
          {sending ? (
            <Button variant="destructive" size="sm" onClick={onCancel} className="m-1 h-7 gap-1.5">
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onSend}
              disabled={!request.url.trim()}
              className="m-1 h-7 gap-1.5 bg-amber-400 text-neutral-900 shadow-sm hover:bg-amber-500"
            >
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          )}
        </div>
      </div>

      {/* tab bar */}
      <div className="flex items-center gap-4 overflow-x-auto border-b px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative -mb-px whitespace-nowrap border-b-2 py-2 text-xs font-medium transition-colors',
              tab === t.id ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* tab body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'params' && (
          <div className="overflow-y-auto p-3"><KeyValueEditor rows={request.params} onChange={(params) => onChange({ params })} keyPlaceholder="Parameter" /></div>
        )}
        {tab === 'headers' && (
          <div className="overflow-y-auto p-3"><KeyValueEditor rows={request.headers} onChange={(headers) => onChange({ headers })} keyPlaceholder="Header" /></div>
        )}
        {tab === 'body' && <div className="overflow-y-auto p-3"><BodyEditor request={request} onChange={onChange} /></div>}
        {tab === 'auth' && <div className="overflow-y-auto p-3"><AuthEditor request={request} onChange={onChange} /></div>}
        {tab === 'script' && <ScriptEditor request={request} onChange={onChange} />}
        {tab === 'vars' && <div className="overflow-y-auto p-3"><VarsEditor request={request} onChange={onChange} /></div>}
        {tab === 'assert' && <div className="overflow-y-auto p-3"><AssertEditor request={request} onChange={onChange} /></div>}
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

function VarsEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { vars } = request;
  return (
    <div className="space-y-4">
      <VarTable
        title="Pre Request"
        hint="Set before send. Value is a JS expression (or {{var}})."
        defs={vars.req}
        onChange={(req) => onChange({ vars: { ...vars, req } })}
      />
      <VarTable
        title="Post Response"
        hint="Set from the response. Value is a JS expression with res / bru in scope (e.g. res.body.id)."
        defs={vars.res}
        onChange={(res) => onChange({ vars: { ...vars, res } })}
      />
    </div>
  );
}

function VarTable({ title, hint, defs, onChange }: {
  title: string; hint: string; defs: VarDef[]; onChange: (defs: VarDef[]) => void;
}) {
  const update = (id: string, patch: Partial<VarDef>) => onChange(defs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{title}</Label>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <div className="divide-y rounded-md border">
        {defs.map((d) => (
          <div key={d.id} className="flex items-center gap-2 px-2 py-1">
            <input type="checkbox" checked={d.enabled} onChange={(e) => update(d.id, { enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
            <Input value={d.name} onChange={(e) => update(d.id, { name: e.target.value })} placeholder="name" className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0" />
            <Input value={d.value} onChange={(e) => update(d.id, { value: e.target.value })} placeholder="expression" className="h-7 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0" />
            <button onClick={() => onChange(defs.filter((x) => x.id !== d.id))} className="rounded p-1 text-muted-foreground/60 hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...defs, newVarDef()])} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> Add variable
        </button>
      </div>
    </div>
  );
}

// ─── assertions (declarative) ─────────────────────────────────────────────────

const OPERATOR_LABELS: Record<AssertOperator, string> = {
  eq: '== equals', neq: '!= not equals', gt: '> greater', gte: '>= greater/eq',
  lt: '< less', lte: '<= less/eq', contains: 'contains', notContains: 'not contains',
  matches: 'matches (regex)', length: 'length ==',
};

function AssertEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { assertions } = request;
  const update = (id: string, patch: Partial<Assertion>) =>
    onChange({ assertions: assertions.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        Each row asserts an expression against the response. Expressions use <code className="rounded bg-muted px-1">res</code> — e.g. <code className="rounded bg-muted px-1">res.status</code>, <code className="rounded bg-muted px-1">res.body.id</code>, <code className="rounded bg-muted px-1">res.responseTime</code>.
      </p>
      <div className="divide-y rounded-md border">
        {assertions.map((a) => (
          <div key={a.id} className="flex items-center gap-2 px-2 py-1">
            <input type="checkbox" checked={a.enabled} onChange={(e) => update(a.id, { enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
            <Input value={a.expr} onChange={(e) => update(a.id, { expr: e.target.value })} placeholder="res.status" className="h-7 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0" />
            <Select value={a.operator} onValueChange={(v) => update(a.id, { operator: v as AssertOperator })}>
              <SelectTrigger className="h-7 w-36 shrink-0 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSERT_OPERATORS.map((op) => <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={a.value} onChange={(e) => update(a.id, { value: e.target.value })} placeholder="200" className="h-7 w-28 shrink-0 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0" />
            <button onClick={() => onChange({ assertions: assertions.filter((x) => x.id !== a.id) })} className="rounded p-1 text-muted-foreground/60 hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button onClick={() => onChange({ assertions: [...assertions, newAssertion()] })} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> Add assertion
        </button>
      </div>
    </div>
  );
}

// ─── body ───────────────────────────────────────────────────────────────────

const BODY_MODES: { id: BodyMode; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Raw' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'form-data', label: 'Form Data' },
];

function BodyEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { body } = request;
  const setBody = (patch: Partial<typeof body>) => onChange({ body: { ...body, ...patch } });

  return (
    <div className="space-y-3">
      <Select value={body.mode} onValueChange={(v) => setBody({ mode: v as BodyMode })}>
        <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {BODY_MODES.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {(body.mode === 'json' || body.mode === 'raw') && (
        <Textarea
          value={body.raw}
          onChange={(e) => setBody({ raw: e.target.value })}
          placeholder={body.mode === 'json' ? '{\n  "key": "value"\n}' : 'Raw request body'}
          className="min-h-[200px] font-mono text-xs"
          spellCheck={false}
        />
      )}
      {(body.mode === 'urlencoded' || body.mode === 'form-data') && (
        <KeyValueEditor rows={body.form} onChange={(form) => setBody({ form })} keyPlaceholder="Field" />
      )}
      {body.mode === 'none' && (
        <p className="py-6 text-center text-xs text-muted-foreground">This request has no body.</p>
      )}
    </div>
  );
}

// ─── auth ───────────────────────────────────────────────────────────────────

const AUTH_TYPES: { id: AuthType; label: string }[] = [
  { id: 'none', label: 'No Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'basic', label: 'Basic Auth' },
];

function AuthEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { auth } = request;
  const setAuth = (patch: Partial<typeof auth>) => onChange({ auth: { ...auth, ...patch } });

  return (
    <div className="max-w-md space-y-3">
      <Select value={auth.type} onValueChange={(v) => setAuth({ type: v as AuthType })}>
        <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {AUTH_TYPES.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {auth.type === 'bearer' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Token</Label>
          <Input
            value={auth.token}
            onChange={(e) => setAuth({ token: e.target.value })}
            placeholder="Token or {{var}}"
            className="h-8 font-mono text-xs"
            spellCheck={false}
          />
        </div>
      )}
      {auth.type === 'basic' && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Username</Label>
            <Input value={auth.username} onChange={(e) => setAuth({ username: e.target.value })} className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input type="password" value={auth.password} onChange={(e) => setAuth({ password: e.target.value })} className="h-8 text-xs" />
          </div>
        </div>
      )}
      {auth.type === 'none' && (
        <p className="py-6 text-center text-xs text-muted-foreground">This request uses no authorization.</p>
      )}
    </div>
  );
}
