import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { BrokerConfig } from './types';

interface BrokerFormProps {
  initial?: BrokerConfig | null;
  onSave: (config: BrokerConfig) => Promise<void>;
  onCancel: () => void;
}

const EMPTY: BrokerConfig = {
  id: '',
  name: '',
  bootstrapServers: 'localhost:9092',
  sslEnabled: false,
};

export function BrokerForm({ initial, onSave, onCancel }: BrokerFormProps) {
  const [form, setForm] = useState<BrokerConfig>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(initial ?? EMPTY);
    setError('');
  }, [initial]);

  const set = (k: keyof BrokerConfig, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.bootstrapServers.trim()) { setError('Bootstrap servers is required'); return; }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
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

          <div className="flex items-center gap-2">
            <input
              id="kf-ssl"
              type="checkbox"
              checked={form.sslEnabled}
              onChange={(e) => set('sslEnabled', e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="kf-ssl">SSL / TLS</Label>
          </div>

          <div>
            <Label htmlFor="kf-sasl">SASL Mechanism</Label>
            <select
              id="kf-sasl"
              value={form.saslMechanism ?? ''}
              onChange={(e) => set('saslMechanism', e.target.value || '')}
              className={cn(
                'mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1',
                'text-sm shadow-sm transition-colors focus-visible:outline-none',
                'focus-visible:ring-1 focus-visible:ring-ring',
              )}
            >
              <option value="">None</option>
              <option value="PLAIN">PLAIN</option>
              <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
              <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
            </select>
          </div>

          {form.saslMechanism && (
            <>
              <div>
                <Label htmlFor="kf-user">SASL Username</Label>
                <Input
                  id="kf-user"
                  value={form.saslUsername ?? ''}
                  onChange={(e) => set('saslUsername', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="kf-pass">SASL Password</Label>
                <Input
                  id="kf-pass"
                  type="password"
                  value={form.saslPassword ?? ''}
                  onChange={(e) => set('saslPassword', e.target.value)}
                  className="mt-1"
                />
              </div>
            </>
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
    </div>
  );
}
