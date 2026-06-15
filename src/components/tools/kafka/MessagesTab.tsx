import { useState } from 'react';
import { Loader2, AlertCircle, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { kafkaApi, type KafkaMessage, type PartitionInfo } from './types';

type FetchMode = 'tail' | 'from' | 'range';
type ValueMode = 'text' | 'json' | 'hex';
type FieldTab = 'partition' | 'offset' | 'key' | 'value' | 'timestamp' | 'headers';

const LIMITS = [20, 50, 100, 200] as const;

interface MessagesTabProps {
  brokerId: string;
  topic: string;
  partitions: PartitionInfo[];
}

// ── Value renderers ───────────────────────────────────────────────────────────

function tryFormatJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function toHexView(s: string): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length === 0) return '(empty)';
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
      .join('');
    const hexPad = hex.padEnd(16 * 3 - 1, ' ');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hexPad}  |${ascii}|`);
  }
  return lines.join('\n');
}

function renderValue(value: string | null, mode: ValueMode): string {
  if (value === null) return '(null)';
  if (mode === 'json') return tryFormatJson(value);
  if (mode === 'hex') return toHexView(value);
  return value;
}

// ── Field-tab detail panel ────────────────────────────────────────────────────

function PinnedPanel({ msg, onClose }: { msg: KafkaMessage; onClose: () => void }) {
  const [fieldTab, setFieldTab] = useState<FieldTab>('value');
  const [valueMode, setValueMode] = useState<ValueMode>('json');

  const hasHeaders = Object.keys(msg.headers).length > 0;
  const ts = (() => { try { return new Date(msg.timestamp).toLocaleString(); } catch { return msg.timestamp; } })();

  const fieldTabs: { id: FieldTab; label: string }[] = [
    { id: 'partition', label: 'Partition' },
    { id: 'offset', label: 'Offset' },
    { id: 'key', label: 'Key' },
    { id: 'value', label: 'Value' },
    { id: 'timestamp', label: 'Timestamp' },
    ...(hasHeaders ? [{ id: 'headers' as FieldTab, label: 'Headers' }] : []),
  ];

  const getFieldContent = (): string => {
    switch (fieldTab) {
      case 'partition': return String(msg.partition);
      case 'offset': return String(msg.offset);
      case 'key': return msg.key ?? '(null)';
      case 'value': return renderValue(msg.value, valueMode);
      case 'timestamp': return ts;
      default: return '';
    }
  };

  return (
    <div className="border-t bg-background flex flex-col shrink-0" style={{ height: '260px' }}>
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b bg-muted/20 shrink-0">
        <div className="flex overflow-x-auto">
          {fieldTabs.map(({ id, label }) => (
            <button
              key={id}
              className={cn(
                'px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition-colors shrink-0',
                fieldTab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setFieldTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 shrink-0">
          {fieldTab === 'value' && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">View Data As</span>
              <div className="flex rounded border border-input overflow-hidden">
                {(['text', 'json', 'hex'] as ValueMode[]).map((m) => (
                  <button
                    key={m}
                    className={cn(
                      'px-2 py-0.5 text-xs uppercase transition-colors',
                      valueMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                    )}
                    onClick={() => setValueMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            onClick={onClose}
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {fieldTab === 'headers' ? (
          hasHeaders ? (
            <div className="divide-y divide-border/40">
              <div className="grid gap-4 px-4 py-1.5 text-xs font-medium text-muted-foreground bg-muted/10 sticky top-0"
                style={{ gridTemplateColumns: '8rem 1fr' }}>
                <span>Key</span>
                <span>Value</span>
              </div>
              {Object.entries(msg.headers).map(([k, v]) => (
                <div key={k} className="grid gap-4 px-4 py-2" style={{ gridTemplateColumns: '8rem 1fr' }}>
                  <span className="text-xs font-mono text-muted-foreground truncate">{k}</span>
                  <span className="text-xs font-mono break-all">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-muted-foreground italic">No headers</p>
          )
        ) : (
          <pre className="px-4 py-3 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
            {getFieldContent()}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MessagesTab({ brokerId, topic, partitions }: MessagesTabProps) {
  const [partition, setPartition] = useState<number>(partitions[0]?.id ?? 0);
  const [mode, setMode] = useState<FetchMode>('tail');
  const [fromOffset, setFromOffset] = useState('0');
  const [toOffset, setToOffset] = useState('100');
  const [limit, setLimit] = useState<number>(50);
  const [keyword, setKeyword] = useState('');
  const [messages, setMessages] = useState<KafkaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState(false);
  const [pinnedMsg, setPinnedMsg] = useState<KafkaMessage | null>(null);

  const doFetch = async () => {
    setLoading(true);
    setError('');
    setPinnedMsg(null);
    try {
      let startOffset: number;
      let fetchLimit: number;
      if (mode === 'tail') {
        startOffset = -1;
        fetchLimit = limit;
      } else if (mode === 'from') {
        startOffset = parseInt(fromOffset, 10) || 0;
        fetchLimit = limit;
      } else {
        const from = parseInt(fromOffset, 10) || 0;
        const to = parseInt(toOffset, 10) || 0;
        startOffset = from;
        fetchLimit = Math.min(Math.max(to - from, 1), 500);
      }
      const msgs = await kafkaApi.fetchMessages(brokerId, topic, partition, startOffset, fetchLimit);
      setMessages(msgs);
      setFetched(true);
    } catch (e) {
      setError(String(e));
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = keyword
    ? messages.filter((m) =>
        [m.key, m.value, ...Object.values(m.headers)]
          .some((v) => v?.toLowerCase().includes(keyword.toLowerCase()))
      )
    : messages;

  const selectedPartition = partitions.find((p) => p.id === partition);

  const COL = '2.5rem 5.5rem 7rem 1fr 9rem';

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-2.5 border-b shrink-0 bg-muted/10">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Partition</Label>
          <select
            value={partition}
            onChange={(e) => setPartition(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {partitions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.earliestOffset >= 0 ? p.earliestOffset.toLocaleString() : '?'}–{p.latestOffset >= 0 ? p.latestOffset.toLocaleString() : '?'})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs">Start from</Label>
          <div className="flex rounded-md border border-input overflow-hidden text-xs h-8">
            {(['tail', 'from', 'range'] as FetchMode[]).map((m) => (
              <button
                key={m}
                className={cn(
                  'px-2.5 py-1 transition-colors',
                  mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
                onClick={() => setMode(m)}
              >
                {m === 'tail' ? 'Latest' : m === 'from' ? 'Offset' : 'Range'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'from' && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Offset</Label>
            <Input
              type="number"
              min="0"
              value={fromOffset}
              onChange={(e) => setFromOffset(e.target.value)}
              placeholder={selectedPartition ? String(selectedPartition.earliestOffset) : '0'}
              className="h-8 w-28 text-xs font-mono"
            />
          </div>
        )}

        {mode === 'range' && (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">From offset</Label>
              <Input type="number" min="0" value={fromOffset} onChange={(e) => setFromOffset(e.target.value)} className="h-8 w-24 text-xs font-mono" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">To offset</Label>
              <Input type="number" min="0" value={toOffset} onChange={(e) => setToOffset(e.target.value)} className="h-8 w-24 text-xs font-mono" />
            </div>
          </>
        )}

        {mode !== 'range' && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Limit</Label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {LIMITS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}

        <Button size="sm" className="h-8 gap-1.5 self-end" onClick={doFetch} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
        </Button>
      </div>

      {/* ── Keyword filter ── */}
      {fetched && (
        <div className="px-4 py-1.5 border-b shrink-0 flex items-center gap-2 bg-muted/5">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Filter by keyword in key / value / headers…"
            className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
          />
          {keyword && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filtered.length} of {messages.length}
            </span>
          )}
        </div>
      )}

      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Fetching messages…
          </div>
        )}
        {!loading && error && (
          <div className="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
        {!loading && !error && !fetched && (
          <div className="px-4 py-10 text-sm text-muted-foreground text-center">
            Choose a partition and click Fetch
          </div>
        )}
        {!loading && !error && fetched && filtered.length === 0 && (
          <div className="px-4 py-10 text-sm text-muted-foreground text-center">
            {keyword ? 'No messages match the filter' : 'No messages in this range'}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            {/* Table header */}
            <div
              className="grid gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground border-b bg-muted/20 sticky top-0"
              style={{ gridTemplateColumns: COL }}
            >
              <span className="text-right">P</span>
              <span>Offset</span>
              <span>Key</span>
              <span>Value</span>
              <span>Timestamp</span>
            </div>

            {/* Table rows */}
            {filtered.map((msg) => {
              const isPinned = pinnedMsg?.partition === msg.partition && pinnedMsg?.offset === msg.offset;
              const ts = (() => { try { return new Date(msg.timestamp).toLocaleString(); } catch { return msg.timestamp; } })();
              return (
                <button
                  key={`${msg.partition}-${msg.offset}`}
                  className={cn(
                    'w-full grid gap-2 px-3 py-1.5 text-left border-b border-border/40 transition-colors',
                    isPinned ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/40',
                  )}
                  style={{ gridTemplateColumns: COL }}
                  onClick={() => setPinnedMsg(isPinned ? null : msg)}
                >
                  <span className="text-right text-xs text-muted-foreground tabular-nums">{msg.partition}</span>
                  <span className="tabular-nums font-mono text-xs text-muted-foreground">{msg.offset.toLocaleString()}</span>
                  <span className="font-mono text-xs truncate">
                    {msg.key ?? <span className="italic text-muted-foreground/50">null</span>}
                  </span>
                  <span className="font-mono text-xs truncate">
                    {msg.value ?? <span className="italic text-muted-foreground/50">null</span>}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">{ts}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* ── Field detail panel ── */}
      {pinnedMsg && (
        <PinnedPanel msg={pinnedMsg} onClose={() => setPinnedMsg(null)} />
      )}
    </div>
  );
}
