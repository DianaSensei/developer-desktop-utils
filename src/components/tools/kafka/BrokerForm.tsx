import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Info } from 'lucide-react';
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
      // Only persist fields the app actually uses. TLS/SASL aren't supported yet,
      // so we never collect or store credentials — and editing a config that was
      // saved by an older build drops any previously stored password here.
      await onSave({
        id: form.id,
        name: form.name,
        bootstrapServers: form.bootstrapServers,
        sslEnabled: false,
      });
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

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              Connections are <span className="font-medium">plaintext</span>. TLS/SSL and SASL
              authentication are not yet supported — don't point this at a broker that requires
              encryption or credentials.
            </p>
          </div>

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
