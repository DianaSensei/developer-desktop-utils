import { useState, useEffect, useRef } from 'react';
import { Plus, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { kafkaApi, type PartitionInfo } from './types';

interface Header { key: string; value: string; }

interface ProduceTabProps {
  brokerId: string;
  topic: string;
  partitions: PartitionInfo[];
}

export function ProduceTab({ brokerId, topic, partitions }: ProduceTabProps) {
  const [partitionMode, setPartitionMode] = useState<'auto' | 'manual'>('auto');
  const [partition, setPartition] = useState(0);
  const [key, setKey] = useState('');
  const [headers, setHeaders] = useState<Header[]>([]);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ partition: number; offset: number } | null>(null);
  const [error, setError] = useState('');
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear status after 5 s
  useEffect(() => {
    if (result || error) {
      clearTimer.current = setTimeout(() => { setResult(null); setError(''); }, 5000);
    }
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, [result, error]);

  const addHeader = () => setHeaders((h) => [...h, { key: '', value: '' }]);
  const removeHeader = (i: number) => setHeaders((h) => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setHeaders((h) => h.map((hdr, idx) => idx === i ? { ...hdr, [field]: val } : hdr));

  const handleSend = async () => {
    if (!value.trim()) { setError('Value is required'); return; }
    setSending(true);
    setResult(null);
    setError('');
    try {
      const headersMap = Object.fromEntries(
        headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])
      );
      const r = await kafkaApi.produce(
        brokerId,
        topic,
        partitionMode === 'manual' ? partition : null,
        key.trim() || null,
        value,
        headersMap,
      );
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="px-4 py-4 space-y-4 max-w-2xl">
        {/* Topic label */}
        <div className="text-xs text-muted-foreground">
          Sending to <span className="font-mono font-medium text-foreground">{topic}</span>
        </div>

        {/* Partition */}
        <div className="flex items-center gap-3">
          <div>
            <Label className="text-xs">Partition</Label>
            <div className="flex rounded-lg border border-input overflow-hidden text-xs h-8 mt-1">
              <button
                className={`px-3 py-1 transition-colors ${partitionMode === 'auto' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                onClick={() => setPartitionMode('auto')}
              >
                Auto
              </button>
              <button
                className={`px-3 py-1 transition-colors ${partitionMode === 'manual' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                onClick={() => setPartitionMode('manual')}
              >
                Manual
              </button>
            </div>
          </div>
          {partitionMode === 'manual' && (
            <div className="mt-auto">
              <Select value={String(partition)} onValueChange={(v) => setPartition(Number(v))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {partitions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>Partition {p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Key */}
        <div>
          <Label htmlFor="pk-key" className="text-xs">Key <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            id="pk-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="message key"
            className="mt-1 h-8 text-xs font-mono"
          />
        </div>

        {/* Headers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">Headers <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              onClick={addHeader}
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {headers.length === 0 && (
            <div className="text-xs text-muted-foreground">No headers</div>
          )}
          {headers.map((h, i) => (
            <div key={i} className="flex gap-1.5 mb-1.5">
              <Input
                value={h.key}
                onChange={(e) => updateHeader(i, 'key', e.target.value)}
                placeholder="key"
                className="h-8 text-xs font-mono flex-1"
              />
              <Input
                value={h.value}
                onChange={(e) => updateHeader(i, 'value', e.target.value)}
                placeholder="value"
                className="h-8 text-xs font-mono flex-[2]"
              />
              <button
                className="text-muted-foreground hover:text-destructive px-1"
                onClick={() => removeHeader(i)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Value */}
        <div>
          <Label htmlFor="pk-value" className="text-xs">Value</Label>
          <textarea
            id="pk-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='{"key": "value"}'
            rows={8}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Send + status */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSend} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {sending ? 'Sending…' : 'Send Message'}
          </Button>

          {result && (
            <div className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              partition {result.partition} @ offset {result.offset.toLocaleString()}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
