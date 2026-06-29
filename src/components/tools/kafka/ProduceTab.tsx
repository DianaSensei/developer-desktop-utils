import { useState, useEffect, useRef } from 'react';
import { Plus, X, Loader2, CheckCircle, AlertCircle, History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePersistentState } from '@/hooks/usePersistentState';
import { kafkaApi, type PartitionInfo, type BatchRecord } from './types';
import { CodeEditor } from '@/components/tools/apiclient/CodeEditor';
import { produceDraft, type ProduceHeader as Header } from './produceDraft';
import { kafkaInputHistory } from './kafkaInputHistoryStore';

interface RecentSend { key: string; value: string; headers: Header[]; at: number }

// Kafka's default partitioner: murmur2(keyBytes) → toPositive → % numPartitions.
// Lets us preview which partition a keyed message will land in (auto mode).
function murmur2(data: Uint8Array): number {
  const length = data.length;
  const m = 0x5bd1e995;
  const r = 24;
  let h = (0x9747b28c ^ length) | 0;
  const len4 = length & ~3;
  for (let i = 0; i < len4; i += 4) {
    let k = (data[i] & 0xff) | ((data[i + 1] & 0xff) << 8) | ((data[i + 2] & 0xff) << 16) | ((data[i + 3] & 0xff) << 24);
    k = Math.imul(k, m); k ^= k >>> r; k = Math.imul(k, m);
    h = Math.imul(h, m); h ^= k;
  }
  const left = length & 3;
  if (left >= 3) h ^= (data[len4 + 2] & 0xff) << 16;
  if (left >= 2) h ^= (data[len4 + 1] & 0xff) << 8;
  if (left >= 1) { h ^= (data[len4] & 0xff); h = Math.imul(h, m); }
  h ^= h >>> 13; h = Math.imul(h, m); h ^= h >>> 15;
  return h | 0;
}
function partitionForKey(key: string, numPartitions: number): number {
  if (numPartitions <= 0) return 0;
  return (murmur2(new TextEncoder().encode(key)) & 0x7fffffff) % numPartitions;
}

interface ProduceTabProps {
  brokerId: string;
  topic: string;
  partitions: PartitionInfo[];
}

export function ProduceTab({ brokerId, topic, partitions }: ProduceTabProps) {
  // Seeded from the in-memory draft so the form survives tab/tool/topic switches.
  const [partitionMode, setPartitionMode] = useState<'auto' | 'manual'>(() => produceDraft.partitionMode);
  const [partition, setPartition] = useState(() => produceDraft.partition);
  const [key, setKey] = useState(() => produceDraft.key);
  const [headers, setHeaders] = useState<Header[]>(() => produceDraft.headers);
  const [value, setValue] = useState(() => produceDraft.value);
  const [valueFormat, setValueFormat] = useState<'json' | 'plain'>(() => produceDraft.valueFormat);
  const [batch, setBatch] = useState(() => produceDraft.batch);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ partition: number; offset: number } | null>(null);
  const [batchResult, setBatchResult] = useState<number | null>(null);
  const [error, setError] = useState('');
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Send-again history (per broker+topic), newest first, capped at 10.
  const [recent, setRecent] = usePersistentState<RecentSend[]>(`devtool:kafka:${brokerId}:${topic}:recentSends`, []);

  // Preview which partition a keyed message routes to in auto mode.
  const previewPartition = (!batch && partitionMode === 'auto' && key.trim() && partitions.length > 0)
    ? partitionForKey(key, partitions.length)
    : null;

  // Clear status after 5 s
  useEffect(() => {
    if (result || error || batchResult !== null) {
      clearTimer.current = setTimeout(() => { setResult(null); setError(''); setBatchResult(null); }, 5000);
    }
    return () => { if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, [result, error, batchResult]);

  // Mirror the form into the in-memory draft on every render so it survives remounts.
  useEffect(() => {
    Object.assign(produceDraft, { key, value, headers, batch, partitionMode, partition, valueFormat });
  });

  // Keep a manual partition selection within range when the topic changes.
  useEffect(() => { if (partition >= partitions.length) setPartition(0); }, [partitions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pretty-print the value as JSON in place; no-op if it isn't valid JSON. */
  const formatValue = () => {
    try { setValue(JSON.stringify(JSON.parse(value), null, 2)); } catch { /* leave as typed */ }
  };

  const rememberSend = () => {
    setRecent((prev) => [
      { key, value, headers: headers.filter((h) => h.key.trim()), at: Date.now() },
      ...prev.filter((r) => !(r.key === key && r.value === value)),
    ].slice(0, 10));
  };

  const loadRecent = (r: RecentSend) => {
    setKey(r.key);
    setValue(r.value);
    setHeaders(r.headers);
    setBatch(false);
  };

  const addHeader = () => setHeaders((h) => [...h, { key: '', value: '' }]);
  const removeHeader = (i: number) => setHeaders((h) => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setHeaders((h) => h.map((hdr, idx) => idx === i ? { ...hdr, [field]: val } : hdr));

  const handleSend = async () => {
    if (!value.trim()) { setError('Value is required'); return; }
    setSending(true);
    setResult(null);
    setBatchResult(null);
    setError('');
    const targetPartition = partitionMode === 'manual' ? partition : null;
    try {
      if (batch) {
        // Value must be a JSON array of records: ["raw", {value, key?, headers?}, …]
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { throw new Error('Batch value must be valid JSON'); }
        if (!Array.isArray(parsed)) throw new Error('Batch value must be a JSON array');
        const records: BatchRecord[] = parsed.map((item, i) => {
          if (typeof item === 'string') return { key: null, value: item };
          if (item && typeof item === 'object' && 'value' in item) {
            const o = item as Record<string, unknown>;
            return {
              key: o.key == null ? null : String(o.key),
              value: typeof o.value === 'string' ? o.value : JSON.stringify(o.value),
              headers: (o.headers && typeof o.headers === 'object')
                ? Object.fromEntries(Object.entries(o.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
                : undefined,
            };
          }
          throw new Error(`Item ${i} must be a string or an object with a "value"`);
        });
        const offsets = await kafkaApi.produceBatch(brokerId, topic, targetPartition, records);
        setBatchResult(offsets.length);
        kafkaInputHistory.add(brokerId, 'topic', topic);
      } else {
        const headersMap = Object.fromEntries(
          headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])
        );
        const r = await kafkaApi.produce(brokerId, topic, targetPartition, key.trim() || null, value, headersMap);
        setResult(r);
        rememberSend();
        kafkaInputHistory.add(brokerId, 'topic', topic);
        if (key.trim()) kafkaInputHistory.add(brokerId, 'key', key);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="px-4 py-4 space-y-4 max-w-2xl">
        {/* Topic label + Single/Batch */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Sending to <span className="font-mono font-medium text-foreground">{topic}</span>
          </div>
          <Segmented
            value={batch ? 'batch' : 'single'}
            onValueChange={(v) => setBatch(v === 'batch')}
            size="sm"
            options={[{ value: 'single', label: 'Single' }, { value: 'batch', label: 'Batch' }]}
            aria-label="Produce mode"
          />
        </div>

        {/* Recent sends — quick "send again" */}
        {!batch && recent.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <History className="w-3 h-3" /> Recent
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recent.slice(0, 6).map((r, i) => (
                <button
                  key={i}
                  onClick={() => loadRecent(r)}
                  title={r.value}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-w-[14rem]"
                >
                  <RotateCcw className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{r.key ? `${r.key}: ` : ''}{r.value || '(empty)'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Partition */}
        <div className="flex items-center gap-3">
          <div>
            <Label className="text-xs">Partition</Label>
            <div className="flex rounded-md border border-input overflow-hidden text-xs h-8 mt-1">
              <button
                className={`px-3 py-1 transition-colors ${partitionMode === 'auto' ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted'}`}
                onClick={() => setPartitionMode('auto')}
              >
                Auto
              </button>
              <button
                className={`px-3 py-1 transition-colors ${partitionMode === 'manual' ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted'}`}
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
          {previewPartition !== null && (
            <span className="mt-auto mb-1 text-xs text-muted-foreground" title="Computed with Kafka's murmur2 default partitioner">
              key routes to <span className="font-mono font-medium text-primary">P{previewPartition}</span>
            </span>
          )}
        </div>

        {/* Key */}
        {!batch && (
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
        )}

        {/* Headers */}
        {!batch && (
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
                className="h-7 text-xs font-mono flex-1"
              />
              <Input
                value={h.value}
                onChange={(e) => updateHeader(i, 'value', e.target.value)}
                placeholder="value"
                className="h-7 text-xs font-mono flex-[2]"
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
        )}

        {/* Value */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">{batch ? 'Records (JSON array)' : 'Value'}</Label>
            <div className="flex items-center gap-2">
              {valueFormat === 'json' && (
                <button
                  type="button"
                  onClick={formatValue}
                  disabled={!value.trim()}
                  className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  title="Pretty-print as JSON"
                >
                  Format
                </button>
              )}
              <Segmented<'json' | 'plain'>
                value={valueFormat}
                onValueChange={setValueFormat}
                size="sm"
                aria-label="Value format"
                options={[{ value: 'json', label: 'JSON' }, { value: 'plain', label: 'Plain' }]}
              />
            </div>
          </div>
          {batch && (
            <p className="mb-1 text-[11px] text-muted-foreground">
              An array of strings or <span className="font-mono">{'{ value, key?, headers? }'}</span> objects — produced to one partition.
            </p>
          )}
          {/* key on format so CodeMirror swaps grammar cleanly (language is fixed at mount). */}
          <CodeEditor
            key={valueFormat}
            value={value}
            onChange={setValue}
            language={valueFormat === 'json' ? 'json' : 'text'}
            placeholder={batch ? '[\n  "first message",\n  { "key": "k2", "value": "second" }\n]' : '{"key": "value"}'}
            className="min-h-40"
          />
        </div>

        {/* Send + status */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSend} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {sending ? 'Sending…' : batch ? 'Send Batch' : 'Send Message'}
          </Button>

          {result && (
            <div className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              partition {result.partition} @ offset {result.offset.toLocaleString()}
            </div>
          )}

          {batchResult !== null && (
            <div className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              produced {batchResult.toLocaleString()} message{batchResult !== 1 ? 's' : ''}
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
