import { useRef, useState } from 'react';
import { FlaskConical, Upload, FileDown, X, Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToolLabel, ToolHint } from '@/components/ui/tool-section';
import { JavaScriptEditor, JsonEditor, TextEditor } from '@/design-system';
import { KeyValueEditor } from '../apiclient/KeyValueEditor';
import { newKeyValue, type KeyValue } from '../apiclient/types';
import { MatcherEditor } from './MatcherEditor';
import { STUB_METHODS, type BodyType, type ResponseMode, type ScriptResult, type Stub, type StubMethod } from './types';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/mockserver/MockServer.messages';

interface Props {
  stub: Stub;
  onChange: (patch: Partial<Stub>) => void;
  testScript: (script: string, sample: Record<string, unknown>) => Promise<ScriptResult>;
}

// Replace (or add) a header by name, keeping it enabled.
function upsertHeader(headers: KeyValue[], key: string, value: string): KeyValue[] {
  const i = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
  if (i >= 0) {
    const copy = [...headers];
    copy[i] = { ...copy[i], value, enabled: true };
    return copy;
  }
  return [...headers, newKeyValue(key, value)];
}

function approxBytes(base64: string): number {
  const clean = base64.replace(/\s/g, '').replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StubEditor({ stub, onChange, testScript }: Props) {
  const m = useMessages(MESSAGES);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [jsonError, setJsonError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const formatJson = () => {
    try {
      onChange({ body: JSON.stringify(JSON.parse(stub.body), null, 2) });
      setJsonError(false);
    } catch {
      setJsonError(true);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await testScript(stub.script, {
        method: stub.method === 'ANY' ? 'GET' : stub.method,
        path: stub.path,
        query: {},
        headers: {},
        params: {},
        body: '',
      });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, status: 0, headers: [], body: '', error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const onPickFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      onChange({
        body: b64,
        fileName: file.name,
        headers: upsertHeader(stub.headers, 'Content-Type', file.type || 'application/octet-stream'),
      });
    };
    reader.readAsDataURL(file);
  };

  const delayField = (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-fg-mute">{m('delay')}</span>
      <Input
        type="number"
        value={stub.delayMs}
        onChange={(e) => onChange({ delayMs: Math.max(0, Number(e.target.value) || 0) })}
        className="h-ctl w-20 text-xs"
      />
      <span className="text-xs text-fg-mute">ms</span>
    </div>
  );

  return (
    <div className="tool-scrollable space-y-5 p-4">
      {/* Identity + enabled */}
      <div className="flex items-center gap-2">
        <Input
          value={stub.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={m('stubName')}
          className="h-ctl flex-1 text-sm font-medium"
        />
        <label className="flex shrink-0 items-center gap-2 text-xs text-fg-mute">
          {stub.enabled ? m('enabled') : m('disabled')}
          <Switch checked={stub.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        </label>
      </div>

      {/* Method + path — the primary request matcher */}
      <div className="flex items-center gap-1.5">
        <Select value={stub.method} onValueChange={(v) => onChange({ method: v as StubMethod })}>
          <SelectTrigger className="h-ctl w-[100px] shrink-0 text-xs font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STUB_METHODS.map((m) => (
              <SelectItem key={m} value={m} className="text-xs font-medium">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={stub.path}
          onChange={(e) => onChange({ path: e.target.value })}
          placeholder="/path/:id"
          className="h-ctl flex-1 font-mono text-sm"
        />
      </div>
      <ToolHint className="-mt-3">
        {m('pathHintA')} <code>:param</code> {m('pathHintB')} <code>*</code> {m('pathHintC')} <code>/users/:id</code>.
      </ToolHint>

      {/* Matchers */}
      <div className="space-y-2">
        <ToolLabel>{m('matchWhen')}</ToolLabel>
        <MatcherEditor matchers={stub.matchers} onChange={(matchers) => onChange({ matchers })} />
      </div>

      {/* Response */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <ToolLabel>{m('response')}</ToolLabel>
          <Segmented<ResponseMode>
            size="sm"
            value={stub.mode}
            onValueChange={(mode) => onChange({ mode })}
            options={[
              { value: 'static', label: m('static') },
              { value: 'script', label: m('script') },
            ]}
          />
        </div>

        {stub.mode === 'static' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-fg-mute">{m('status')}</span>
                <Input
                  type="number"
                  value={stub.status}
                  onChange={(e) => onChange({ status: Number(e.target.value) || 0 })}
                  className="h-ctl w-20 text-xs"
                />
              </div>
              {delayField}
            </div>

            <div className="space-y-1.5">
              <span className="text-xs text-fg-mute">{m('headers')}</span>
              <KeyValueEditor rows={stub.headers} onChange={(headers) => onChange({ headers })} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-mute">{m('body')}</span>
                  {stub.bodyType === 'json' && (
                    <>
                      <button
                        type="button"
                        onClick={formatJson}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg"
                        title={m('prettyPrint')}
                      >
                        <Braces className="h-3 w-3" />
                        {m('format')}
                      </button>
                      {jsonError && <span className="text-[11px] text-bad">{m('invalidJson')}</span>}
                    </>
                  )}
                </div>
                <Segmented<BodyType>
                  size="sm"
                  value={stub.bodyType}
                  onValueChange={(bodyType) => onChange({ bodyType })}
                  options={[
                    { value: 'text', label: m('text') },
                    { value: 'json', label: 'JSON' },
                    { value: 'base64', label: m('file') },
                  ]}
                />
              </div>

              {stub.bodyType === 'base64' ? (
                <div className="space-y-2 rounded-md border bg-bg-2/10 p-3">
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onPickFile(f);
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-ctl text-xs"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      {m('chooseFile')}
                    </Button>
                    {stub.body ? (
                      <span className="flex items-center gap-1.5 text-xs text-fg-mute">
                        <FileDown className="h-3.5 w-3.5" />
                        {humanSize(approxBytes(stub.body))}
                        <button
                          type="button"
                          onClick={() => onChange({ body: '', fileName: '' })}
                          className="text-fg-mute hover:text-bad"
                          aria-label={m('clearFile')}
                          title={m('clearFile')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-fg-mute">{m('orPasteBase64')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-xs text-fg-mute">{m('downloadName')}</span>
                    <Input
                      value={stub.fileName}
                      onChange={(e) => onChange({ fileName: e.target.value })}
                      placeholder="file.bin"
                      className="h-ctl flex-1 font-mono text-xs"
                    />
                  </div>
                  <textarea
                    value={stub.body}
                    onChange={(e) => onChange({ body: e.target.value })}
                    placeholder={m('base64Bytes')}
                    spellCheck={false}
                    className="h-20 w-full resize-y rounded-md border bg-card p-2 font-mono text-[11px] focus:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
                  />
                  <ToolHint>
                    {m('fileHintA')} <code>Content-Disposition: attachment</code> {m('fileHintB')} <code>Content-Type</code> {m('fileHintC')}
                  </ToolHint>
                </div>
              ) : (
                <>
                  {stub.bodyType === 'json' ? (
                    <JsonEditor
                      value={stub.body}
                      onChange={(body) => {
                        if (jsonError) setJsonError(false);
                        onChange({ body });
                      }}
                      placeholder={m('responseBody')}
                    />
                  ) : (
                    <TextEditor
                      value={stub.body}
                      onChange={(body) => {
                        if (jsonError) setJsonError(false);
                        onChange({ body });
                      }}
                      placeholder={m('responseBody')}
                    />
                  )}
                  <ToolHint>
                    Templates: <code>{'{{path.id}}'}</code>, <code>{'{{request.query.x}}'}</code>,{' '}
                    <code>{'{{request.header.x}}'}</code>, <code>{'{{request.body}}'}</code>,{' '}
                    <code>{'{{uuid}}'}</code>, <code>{'{{now.iso}}'}</code>, <code>{'{{randomInt(1,99)}}'}</code>.
                  </ToolHint>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {delayField}
            <ToolHint>
              <code>req</code> {m('scriptHintA')} <code>method</code>, <code>path</code>, <code>query</code>,{' '}
              <code>headers</code>, <code>params</code>, <code>body</code>{m('scriptHintB')}{' '}
              <code>{'#{ status, headers, body }'}</code>.
            </ToolHint>
            <JavaScriptEditor value={stub.script} onChange={(script) => onChange({ script })} placeholder={m('rhaiScript')} />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-ctl text-xs" onClick={runTest} disabled={testing}>
                <FlaskConical className="mr-1 h-3.5 w-3.5" />
                {testing ? m('runningScript') : m('testScript')}
              </Button>
            </div>
            {result && (
              <div className="rounded-md border bg-bg-2/20 p-2 text-xs">
                {result.ok ? (
                  <>
                    <div className="mb-1 text-fg-mute">
                      Status <span className="font-mono text-fg">{result.status}</span>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                      {result.body}
                    </pre>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-bad">
                    {result.error}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
