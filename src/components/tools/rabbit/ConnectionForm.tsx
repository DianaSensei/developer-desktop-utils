import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { X, Info, Loader2, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { EMPTY_CONNECTION, rabbitApi, type RabbitConnection } from './types';
import { rabbitMgmt } from './api';

interface ConnectionFormProps {
  initial?: RabbitConnection | null;
  onSave: (config: RabbitConnection) => Promise<void>;
  onCancel: () => void;
}

export function ConnectionForm({ initial, onSave, onCancel }: ConnectionFormProps) {
  const [form, setForm] = useState<RabbitConnection>(initial ?? EMPTY_CONNECTION);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<'ok' | null>(null);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uri, setUri] = useState('');

  useEffect(() => {
    setForm(initial ?? EMPTY_CONNECTION);
    setError('');
    setTested(null);
  }, [initial]);

  const set = (k: keyof RabbitConnection, v: string | number | boolean | null) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTested(null);
  };

  /** Parse an amqp(s):// URI into the AMQP fields (host, port, creds, vhost, TLS). */
  const applyUri = () => {
    try {
      const u = new URL(uri.trim());
      if (u.protocol !== 'amqp:' && u.protocol !== 'amqps:') throw new Error('scheme');
      const tls = u.protocol === 'amqps:';
      const vh = decodeURIComponent(u.pathname.replace(/^\//, '')) || '/';
      setForm((f) => ({
        ...f,
        host: u.hostname || f.host,
        amqpPort: u.port ? Number(u.port) : (tls ? 5671 : 5672),
        username: u.username ? decodeURIComponent(u.username) : f.username,
        password: u.password ? decodeURIComponent(u.password) : f.password,
        vhost: vh,
        useTls: tls,
      }));
      setError('');
      setTested(null);
    } catch {
      setError('Could not parse AMQP URI — expected amqp(s)://user:pass@host:port/vhost');
    }
  };

  const amqpOnly = !!form.amqpOnly;

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Name is required';
    if (!form.host.trim()) return 'Host is required';
    if (!amqpOnly && (!form.port || form.port < 1 || form.port > 65535)) return 'Port must be 1–65535';
    if (!form.amqpPort || form.amqpPort < 1 || form.amqpPort > 65535) return 'AMQP port must be 1–65535';
    return null;
  };

  const handleTest = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setTesting(true);
    setError('');
    setTested(null);
    try {
      // The AMQP connection is the core path — always verify it. If the optional
      // management API is enabled, verify that too (it needs the plugin).
      await rabbitApi.amqpTest(form);
      if (!amqpOnly) await rabbitMgmt.testConnection(form);
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

  // Portal to <body> so the fixed overlay escapes the tool's entrance-animation
  // wrapper (an animating `transform` ancestor would offset a fixed child).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base">
            {form.id ? 'Edit Connection' : 'Add Connection'}
          </h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="rb-name">Name</Label>
            <Input
              id="rb-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Local RabbitMQ"
              className="mt-1"
            />
          </div>

          {/* AMQP connection — the only required part. */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label htmlFor="rb-host">Host</Label>
              <Input
                id="rb-host"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="localhost"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div className="w-24">
              <Label htmlFor="rb-amqpport">AMQP port</Label>
              <Input
                id="rb-amqpport"
                type="number"
                value={form.amqpPort}
                onChange={(e) => set('amqpPort', Number(e.target.value))}
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Used by publish / consume / request-response — default <span className="font-mono">5672</span> ({form.useTls ? 'amqps' : 'amqp'}).
          </p>

          <div>
            <Label htmlFor="rb-uri">Paste AMQP URI <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="mt-1 flex gap-1">
              <Input
                id="rb-uri"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder="amqp://user:pass@host:5672/vhost"
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="sm" onClick={applyUri} disabled={!uri.trim()}>Fill</Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Fills host, AMQP port, credentials, vhost and TLS from the URI.</p>
          </div>

          <div>
            <Label htmlFor="rb-vhost">Virtual host</Label>
            <Input
              id="rb-vhost"
              value={form.vhost}
              onChange={(e) => set('vhost', e.target.value)}
              placeholder="/"
              className="mt-1 font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rb-user">Username</Label>
              <Input
                id="rb-user"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder="guest"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="rb-pass">Password</Label>
              <Input
                id="rb-pass"
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="guest"
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="rb-tls" className="cursor-pointer">Use TLS</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Connect over <span className="font-mono">amqps</span> (and <span className="font-mono">https</span> for the management API).
              </p>
            </div>
            <Switch checked={form.useTls} onCheckedChange={(v) => set('useTls', v)} aria-label="Use TLS" />
          </div>

          {/* Management API — optional. Powers browse-all lists, overview and
              connections; never required to publish/consume/request over AMQP. */}
          <div className="rounded-md border">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="pr-2">
                <Label className="cursor-pointer">Management API <span className="font-normal text-muted-foreground">— optional</span></Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Adds browse-all queues &amp; exchanges, the overview dashboard and connections — needs the RabbitMQ <span className="font-medium">management</span> plugin. Leave off to work over AMQP with typed names.
                </p>
              </div>
              <Switch checked={!amqpOnly} onCheckedChange={(v) => set('amqpOnly', !v)} aria-label="Enable management API" />
            </div>
            {!amqpOnly && (
              <div className="px-3 pb-3 border-t pt-3">
                <Label htmlFor="rb-port" className="text-xs">Management port</Label>
                <Input
                  id="rb-port"
                  type="number"
                  value={form.port}
                  onChange={(e) => set('port', Number(e.target.value))}
                  className="mt-1 font-mono text-sm h-8 w-32"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Default <span className="font-mono">15672</span> on <span className="font-mono">{form.host || 'host'}</span> ({form.useTls ? 'https' : 'http'}).
                </p>
              </div>
            )}
          </div>

          {/* Advanced / TLS */}
          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Advanced / TLS
              <span className="text-[11px] font-normal text-muted-foreground/70">— CA, client cert, heartbeat, name</span>
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 space-y-3 border-t pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="rb-hb" className="text-xs">Heartbeat (s)</Label>
                    <Input
                      id="rb-hb" type="number" value={form.heartbeat ?? ''}
                      onChange={(e) => set('heartbeat', e.target.value ? Number(e.target.value) : null)}
                      placeholder="30" className="mt-1 font-mono text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label htmlFor="rb-cn" className="text-xs">Connection name</Label>
                    <Input
                      id="rb-cn" value={form.connectionName ?? ''}
                      onChange={(e) => set('connectionName', e.target.value || null)}
                      placeholder="devtool" className="mt-1 font-mono text-xs h-8"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="rb-hosts" className="text-xs">Additional hosts <span className="font-normal text-muted-foreground">(HA failover)</span></Label>
                  <Textarea
                    id="rb-hosts"
                    value={(form.extraHosts ?? []).join('\n')}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(/[\n,]/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setForm((f) => ({ ...f, extraHosts: list.length ? list : null }));
                      setTested(null);
                    }}
                    placeholder={'node2.broker\nnode3.broker:5672'}
                    className="mt-1 font-mono text-[11px] min-h-16"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Tried in order if the primary host is unreachable. One per line — <span className="font-mono">host</span> or <span className="font-mono">host:port</span> (defaults to the AMQP port). Applies to AMQP (publish / consume / request-response).
                  </p>
                </div>
                <div>
                  <Label htmlFor="rb-ca" className="text-xs">Trust CA certificate (PEM)</Label>
                  <Textarea
                    id="rb-ca" value={form.tlsCaPem ?? ''}
                    onChange={(e) => set('tlsCaPem', e.target.value || null)}
                    placeholder="-----BEGIN CERTIFICATE-----" className="mt-1 font-mono text-[11px] min-h-16"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">For self-signed / private brokers (amqps). The proper alternative to disabling verification.</p>
                </div>
                <div>
                  <Label htmlFor="rb-p12" className="text-xs">Client identity — PKCS#12 (base64)</Label>
                  <Textarea
                    id="rb-p12" value={form.clientPkcs12B64 ?? ''}
                    onChange={(e) => set('clientPkcs12B64', e.target.value || null)}
                    placeholder="MII… (base64 of a .p12/.pfx for mutual TLS)" className="mt-1 font-mono text-[11px] min-h-16"
                  />
                </div>
                <div>
                  <Label htmlFor="rb-p12pw" className="text-xs">PKCS#12 password</Label>
                  <Input
                    id="rb-p12pw" type="password" value={form.clientPkcs12Password ?? ''}
                    onChange={(e) => set('clientPkcs12Password', e.target.value || null)}
                    className="mt-1 font-mono text-xs h-8"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              Credentials are stored on this device. {amqpOnly
                ? <>They're used only over AMQP ({form.useTls ? 'amqps' : 'amqp'}); no management API is contacted.</>
                : <>They're used over AMQP and also sent as HTTP Basic auth to the management API.</>}
            </p>
          </div>

          {error && <p className="text-sm text-destructive break-words">{error}</p>}
          {tested === 'ok' && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Connection successful
            </p>
          )}
        </div>

        <div className="flex justify-between gap-2 mt-6">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Testing…</> : 'Test'}
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
