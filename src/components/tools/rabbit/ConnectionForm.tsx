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

const defaultPort = (tls: boolean) => (tls ? 5671 : 5672);

/**
 * Parse a comma/newline-separated host list ("127.0.0.1:5672, broker2:5672")
 * into the canonical fields: the first entry is the primary host+port, the rest
 * are failover endpoints (`extraHosts`). A bare host falls back to the AMQP
 * default port for the current TLS setting.
 */
function parseHostsText(text: string, tls: boolean): { host: string; amqpPort: number; extraHosts: string[] } {
  const one = (e: string): { host: string; port: number } => {
    const i = e.lastIndexOf(':');
    if (i > 0) {
      const h = e.slice(0, i).trim();
      const p = Number(e.slice(i + 1).trim());
      if (h && Number.isInteger(p) && p > 0 && p <= 65535) return { host: h, port: p };
    }
    return { host: e, port: defaultPort(tls) };
  };
  const entries = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map(one);
  if (entries.length === 0) return { host: '', amqpPort: defaultPort(tls), extraHosts: [] };
  return {
    host: entries[0].host,
    amqpPort: entries[0].port,
    extraHosts: entries.slice(1).map((x) => `${x.host}:${x.port}`),
  };
}

/** Render the canonical host fields back into the editable "host:port, …" string. */
function hostsToText(c: { host: string; amqpPort: number; extraHosts?: string[] | null }): string {
  return [c.host ? `${c.host}:${c.amqpPort}` : '', ...(c.extraHosts ?? [])].filter(Boolean).join(', ');
}

export function ConnectionForm({ initial, onSave, onCancel }: ConnectionFormProps) {
  const [form, setForm] = useState<RabbitConnection>(initial ?? EMPTY_CONNECTION);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<'ok' | null>(null);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uri, setUri] = useState('');
  const [showUri, setShowUri] = useState(false);
  // The editable "host:port, host:port" string; parsed into form.host/amqpPort/extraHosts.
  const [hostsText, setHostsText] = useState(() => hostsToText(initial ?? EMPTY_CONNECTION));

  useEffect(() => {
    const c = initial ?? EMPTY_CONNECTION;
    setForm(c);
    setHostsText(hostsToText(c));
    setError('');
    setTested(null);
  }, [initial]);

  const set = (k: keyof RabbitConnection, v: string | number | boolean | null) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTested(null);
  };

  const onHostsChange = (text: string) => {
    setHostsText(text);
    setForm((f) => ({ ...f, ...parseHostsText(text, f.useTls) }));
    setTested(null);
  };

  // Re-default portless host entries when TLS flips (5672 ↔ 5671).
  const onTlsChange = (v: boolean) => {
    setForm((f) => ({ ...f, useTls: v, ...parseHostsText(hostsText, v) }));
    setTested(null);
  };

  /**
   * Parse an amqp(s):// URI — including a comma-separated multi-host authority
   * (amqp://u:p@h1:5672,h2:5672/vhost) — into the host list, credentials, vhost
   * and TLS, and reflect it in the visible Host(s) field.
   */
  const applyUri = () => {
    const m = /^(amqps?):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/]+)(?:\/(.*))?$/i.exec(uri.trim());
    if (!m) {
      setError('Could not parse AMQP URI — expected amqp(s)://user:pass@host:port[,host:port]/vhost');
      return;
    }
    const tls = m[1].toLowerCase() === 'amqps';
    const parsed = parseHostsText(m[4], tls);
    setHostsText(hostsToText(parsed));
    setForm((f) => ({
      ...f,
      ...parsed,
      username: m[2] ? decodeURIComponent(m[2]) : f.username,
      password: m[3] ? decodeURIComponent(m[3]) : f.password,
      vhost: m[5] != null && m[5] !== '' ? decodeURIComponent(m[5]) : f.vhost,
      useTls: tls,
    }));
    setUri('');
    setShowUri(false);
    setError('');
    setTested(null);
  };

  const amqpOnly = !!form.amqpOnly;

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Name is required';
    if (!form.host.trim()) return 'At least one host is required';
    if (!amqpOnly && (!form.port || form.port < 1 || form.port > 65535)) return 'Management port must be 1–65535';
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

          {/* AMQP addresses — the only required part. Accepts a comma-separated list. */}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="rb-hosts">Addresses</Label>
              <button
                type="button"
                onClick={() => setShowUri((s) => !s)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
                title="Fill the fields from an amqp:// URI"
              >
                {showUri ? 'Hide URI' : 'Paste URI'}
              </button>
            </div>
            <Input
              id="rb-hosts"
              value={hostsText}
              onChange={(e) => onHostsChange(e.target.value)}
              placeholder="127.0.0.1:5672, broker2:5672"
              className="mt-1 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-mono">host:port</span>, comma-separated. The first is primary; the rest are tried on failover. Default port <span className="font-mono">{defaultPort(form.useTls)}</span> ({form.useTls ? 'amqps' : 'amqp'}).
            </p>
            {showUri && (
              <div className="mt-2 flex gap-1">
                <Input
                  id="rb-uri"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="amqp://user:pass@host1:5672,host2:5672/vhost"
                  className="font-mono text-xs"
                  autoFocus
                />
                <Button type="button" variant="outline" size="sm" onClick={applyUri} disabled={!uri.trim()}>Fill</Button>
              </div>
            )}
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
            <Switch checked={form.useTls} onCheckedChange={onTlsChange} aria-label="Use TLS" />
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
              <span className="text-[11px] font-normal text-muted-foreground/70">— vhost, heartbeat, name, CA, client cert</span>
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
                  <Label htmlFor="rb-vhost" className="text-xs">Virtual host</Label>
                  <Input
                    id="rb-vhost"
                    value={form.vhost}
                    onChange={(e) => set('vhost', e.target.value)}
                    placeholder="/"
                    className="mt-1 font-mono text-xs h-8"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Default <span className="font-mono">/</span>. Add multiple hosts in the Addresses field above for HA failover.</p>
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
