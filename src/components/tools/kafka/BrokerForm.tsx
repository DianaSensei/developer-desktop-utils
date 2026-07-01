import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { X, Info, ChevronDown, ChevronRight } from 'lucide-react';
import type { BrokerConfig, SecurityProtocol, SaslMechanism } from './types';

interface BrokerFormProps {
  initial?: BrokerConfig | null;
  onSave: (config: BrokerConfig) => Promise<void>;
  onCancel: () => void;
}

const EMPTY: BrokerConfig = {
  id: '',
  name: '',
  bootstrapServers: 'localhost:9092',
  securityProtocol: 'PLAINTEXT',
};

const SECURITY_PROTOCOLS: { value: SecurityProtocol; label: string }[] = [
  { value: 'PLAINTEXT', label: 'PLAINTEXT — no auth, unencrypted' },
  { value: 'SSL', label: 'SSL — TLS only' },
  { value: 'SASL_PLAINTEXT', label: 'SASL_PLAINTEXT — user/pass, unencrypted' },
  { value: 'SASL_SSL', label: 'SASL_SSL — user/pass over TLS' },
];

const SASL_MECHANISMS: { value: SaslMechanism; label: string }[] = [
  { value: 'PLAIN', label: 'PLAIN' },
  { value: 'SCRAM-SHA-256', label: 'SCRAM-SHA-256' },
  { value: 'SCRAM-SHA-512', label: 'SCRAM-SHA-512' },
];

export function BrokerForm({ initial, onSave, onCancel }: BrokerFormProps) {
  const [form, setForm] = useState<BrokerConfig>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showTls, setShowTls] = useState(false);

  useEffect(() => {
    setForm(initial ?? EMPTY);
    setError('');
    setShowTls(false);
  }, [initial]);

  const set = <K extends keyof BrokerConfig>(k: K, v: BrokerConfig[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const usesSasl = form.securityProtocol === 'SASL_PLAINTEXT' || form.securityProtocol === 'SASL_SSL';
  const usesTls = form.securityProtocol === 'SSL' || form.securityProtocol === 'SASL_SSL';

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.bootstrapServers.trim()) { setError('Bootstrap servers is required'); return; }
    if (usesSasl && !form.saslUsername?.trim()) { setError('SASL username is required'); return; }
    setSaving(true);
    setError('');
    try {
      // Only persist fields relevant to the chosen security protocol, so
      // switching away from SASL/SSL doesn't leave stale credentials behind.
      await onSave({
        id: form.id,
        name: form.name,
        bootstrapServers: form.bootstrapServers,
        securityProtocol: form.securityProtocol,
        saslMechanism: usesSasl ? (form.saslMechanism ?? 'PLAIN') : undefined,
        saslUsername: usesSasl ? form.saslUsername : undefined,
        saslPassword: usesSasl ? form.saslPassword : undefined,
        sslCaPem: usesTls ? form.sslCaPem : null,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Portal to <body> so the fixed overlay escapes the tool's entrance-animation
  // wrapper (an animating `transform` ancestor would offset a fixed child).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-base">
            {form.id ? 'Edit Broker' : 'Add Broker'}
          </h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="kf-name">Name</Label>
            <Input
              id="kf-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My Kafka Cluster"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="kf-brokers">Bootstrap Servers</Label>
            <Input
              id="kf-brokers"
              value={form.bootstrapServers}
              onChange={(e) => set('bootstrapServers', e.target.value)}
              placeholder="localhost:9092"
              className="mt-1 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">Kafka broker ports only — not ZooKeeper (2181)</p>
          </div>

          <div>
            <Label htmlFor="kf-protocol">Security Protocol</Label>
            <Select
              value={form.securityProtocol}
              onValueChange={(v) => set('securityProtocol', v as SecurityProtocol)}
            >
              <SelectTrigger id="kf-protocol" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECURITY_PROTOCOLS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {usesSasl && (
            <div className="rounded-md border px-3 py-3 space-y-3">
              <div>
                <Label htmlFor="kf-mechanism" className="text-xs">SASL Mechanism</Label>
                <Select
                  value={form.saslMechanism ?? 'PLAIN'}
                  onValueChange={(v) => set('saslMechanism', v as SaslMechanism)}
                >
                  <SelectTrigger id="kf-mechanism" className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SASL_MECHANISMS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="kf-user" className="text-xs">Username</Label>
                  <Input
                    id="kf-user"
                    value={form.saslUsername ?? ''}
                    onChange={(e) => set('saslUsername', e.target.value)}
                    className="mt-1 font-mono text-sm h-8"
                  />
                </div>
                <div>
                  <Label htmlFor="kf-pass" className="text-xs">Password</Label>
                  <Input
                    id="kf-pass"
                    type="password"
                    value={form.saslPassword ?? ''}
                    onChange={(e) => set('saslPassword', e.target.value)}
                    className="mt-1 font-mono text-sm h-8"
                  />
                </div>
              </div>
            </div>
          )}

          {usesTls && (
            <div className="rounded-md border">
              <button
                type="button"
                onClick={() => setShowTls((s) => !s)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showTls ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Advanced / TLS
                <span className="text-[11px] font-normal text-muted-foreground/70">— custom CA</span>
              </button>
              {showTls && (
                <div className="px-3 pb-3 border-t pt-3">
                  <Label htmlFor="kf-ca" className="text-xs">Trust CA certificate (PEM)</Label>
                  <Textarea
                    id="kf-ca"
                    value={form.sslCaPem ?? ''}
                    onChange={(e) => set('sslCaPem', e.target.value || null)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    className="mt-1 font-mono text-[11px] min-h-16"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    For self-signed / private brokers. Leave empty to trust the OS certificate store.
                  </p>
                </div>
              )}
            </div>
          )}

          {form.securityProtocol === 'PLAINTEXT' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Connections are <span className="font-medium">plaintext</span> with no authentication.
                Switch the security protocol above if the broker requires encryption or credentials.
              </p>
            </div>
          )}

          {usesSasl && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                Credentials are stored on this device{usesTls ? '' : ' and sent unencrypted (SASL_PLAINTEXT)'}.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
