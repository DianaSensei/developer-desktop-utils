import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { X, Info, CheckCircle2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Callout } from '@/components/ui/callout';
import { EMPTY_CONNECTION, redisApi, type RedisConnection } from './types';

interface ConnectionFormProps {
  initial?: RedisConnection | null;
  onSave: (config: RedisConnection) => Promise<void>;
  onCancel: () => void;
}

export function ConnectionForm({ initial, onSave, onCancel }: ConnectionFormProps) {
  const [form, setForm] = useState<RedisConnection>(initial ?? EMPTY_CONNECTION);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<'ok' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(initial ?? EMPTY_CONNECTION);
    setError('');
    setTested(null);
  }, [initial]);

  const set = (k: keyof RedisConnection, v: string | number | boolean | null) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTested(null);
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Name is required';
    if (!form.host.trim()) return 'Host is required';
    if (!form.port || form.port < 1 || form.port > 65535) return 'Port must be 1–65535';
    return null;
  };

  const handleTest = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setTesting(true);
    setError('');
    setTested(null);
    try {
      await redisApi.testConnection(form);
      setTested('ok');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-bg border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base">
            {form.id ? 'Edit Connection' : 'Add Connection'}
          </h2>
          <button onClick={onCancel} className="text-fg-mute hover:text-fg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="rd-name">Name</Label>
            <Input
              id="rd-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Local Redis"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label htmlFor="rd-host">Host</Label>
              <Input
                id="rd-host"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="localhost"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="rd-port">Port</Label>
              <Input
                id="rd-port"
                type="number"
                value={form.port}
                onChange={(e) => set('port', Number(e.target.value))}
                className="mt-1 font-mono text-sm w-24"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rd-user">Username <span className="font-normal text-fg-mute">— optional</span></Label>
              <Input
                id="rd-user"
                value={form.username ?? ''}
                onChange={(e) => set('username', e.target.value || null)}
                placeholder="default"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="rd-pass">Password</Label>
              <Input
                id="rd-pass"
                type="password"
                value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value || null)}
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="rd-tls" className="cursor-pointer">Use TLS</Label>
              <p className="text-[11px] text-fg-mute mt-0.5">
                Connect over <span className="font-mono">rediss</span> using the OS trust store.
              </p>
            </div>
            <Switch checked={form.useTls} onCheckedChange={(v) => set('useTls', v)} aria-label="Use TLS" />
          </div>

          <Callout tone="warning" size="sm" icon={Info}>
            Credentials are stored on this device and used only to connect to this Redis server.
          </Callout>

          {error && <Callout tone="error" size="sm">{error}</Callout>}
          {tested === 'ok' && <Callout tone="success" size="sm" icon={CheckCircle2}>Connection successful</Callout>}
        </div>

        <div className="flex justify-between gap-2 mt-6">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing ? <><Spinner className="mr-1.5" />Testing…</> : 'Test'}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
