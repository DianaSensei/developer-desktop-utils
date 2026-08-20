import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, CheckCircle2, Search } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Callout } from '@/components/ui/callout';
import { EMPTY_CONNECTION, containerApi, type ContainerConnection, type DetectedSocket } from './types';

interface ConnectionFormProps {
  initial?: ContainerConnection | null;
  onSave: (config: ContainerConnection) => Promise<void>;
  onCancel: () => void;
}

export function ConnectionForm({ initial, onSave, onCancel }: ConnectionFormProps) {
  const [form, setForm] = useState<ContainerConnection>(initial ?? EMPTY_CONNECTION);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<'ok' | null>(null);
  const [error, setError] = useState('');
  const [detected, setDetected] = useState<DetectedSocket[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    setForm(initial ?? EMPTY_CONNECTION);
    setError('');
    setTested(null);
  }, [initial]);

  useEffect(() => {
    if (initial) return; // only auto-detect for a brand new connection
    setDetecting(true);
    containerApi.detectSockets().then(setDetected).catch(() => setDetected([])).finally(() => setDetecting(false));
  }, [initial]);

  const set = (k: keyof ContainerConnection, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTested(null);
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Name is required';
    if (!form.socketPath.trim()) return 'Socket path is required';
    return null;
  };

  const handleTest = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setTesting(true);
    setError('');
    setTested(null);
    try {
      await containerApi.testConnection(form);
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
            <Label htmlFor="cd-name">Name</Label>
            <Input
              id="cd-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Colima (default)"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="cd-socket">Socket path</Label>
            <Input
              id="cd-socket"
              value={form.socketPath}
              onChange={(e) => set('socketPath', e.target.value)}
              placeholder="/Users/me/.colima/default/docker.sock"
              className="mt-1 font-mono text-sm"
            />
            <p className="text-[11px] text-fg-mute mt-1">
              Unix socket path (or Windows named pipe, e.g. <span className="font-mono">\\.\pipe\docker_engine</span>) — not a host:port.
            </p>
          </div>

          {!initial && (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-fg-mute mb-1.5">
                <Search className="h-3 w-3" />
                {detecting ? 'Detecting sockets…' : detected && detected.length > 0 ? 'Detected on this machine' : 'No sockets detected'}
              </div>
              {detected && detected.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detected.map((d) => (
                    <button
                      key={d.socketPath}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, name: f.name || d.label, socketPath: d.socketPath }))}
                      className="text-[11px] px-2 py-1 rounded-md border border-line/60 hover:bg-bg-2/60 transition-colors"
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
