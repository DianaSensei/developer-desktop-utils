import { useEffect, useRef, useState } from 'react';
import {
  Radio, Play, Pause, Square, Loader2, AlertCircle, ChevronDown, ChevronRight, Check, RefreshCw, Trash, Search, ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import { kafkaApi, type ConsumeFrom, type KafkaConsumedMessage } from './types';
import { kafkaConsumerStore, useKafkaConsumers, type KafkaConsumerSession } from './kafkaConsumerStore';
import { kafkaInputHistory, useKafkaRecentMatches } from './kafkaInputHistoryStore';
import { RecentSuggestions } from './RecentSuggestions';
import { ResponseViewer } from '@/components/tools/apiclient/ResponseViewer';
import type { TopicPrefill } from './useKafkaState';

type ValueFormat = 'json' | 'plain' | 'hex';

interface ConsumeViewProps {
  brokerId: string;
  refreshKey: number;
  onRefresh: () => void;
  prefill?: TopicPrefill | null;
  /** Topic of the consumer to show in detail; null = the consumer list. */
  detailTopic: string | null;
  onOpenConsumer: (topic: string) => void;
  onCloseDetail: () => void;
}

export function ConsumeView({ brokerId, refreshKey, onRefresh, prefill, detailTopic, onOpenConsumer, onCloseDetail }: ConsumeViewProps) {
  const sessions = useKafkaConsumers().filter((s) => s.brokerId === brokerId);
  const detail = detailTopic ? sessions.find((s) => s.topic === detailTopic) : undefined;

  // Detail panel for a single consumer (when one is selected and still running).
  if (detailTopic && detail) {
    return <ConsumerDetail session={detail} onBack={onCloseDetail} />;
  }

  // Master: the list of consumers + the start form.
  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Consume (realtime)</h2>
            <p className="text-[11px] text-muted-foreground">{sessions.length} active · anonymous, no offsets committed</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="tool-scrollable px-5 py-5">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <StartConsumerForm
            brokerId={brokerId}
            refreshKey={refreshKey}
            sessions={sessions}
            prefill={prefill}
            onStarted={onOpenConsumer}
          />

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Active consumers</h3>
            {sessions.length === 0
              ? <p className="text-sm text-muted-foreground">No consumers running. Start one above to watch a topic in realtime.</p>
              : (
                <div className="rounded-lg border divide-y divide-border/40 overflow-hidden">
                  {sessions.map((s) => <ConsumerListRow key={s.topic} session={s} onOpen={() => onOpenConsumer(s.topic)} />)}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact row in the consumer list — click to open its detail panel. */
function ConsumerListRow({ session: s, onOpen }: { session: KafkaConsumerSession; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/40"
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', s.paused ? 'bg-amber-500' : 'bg-emerald-500')} title={s.starting ? 'starting' : s.paused ? 'paused' : 'live'} />
      <span className="font-mono text-sm truncate">{s.topic}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide shrink-0">
        {s.from === 'latest' ? 'new only' : 'from start'}
      </span>
      {s.paused && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 uppercase tracking-wide shrink-0">paused</span>
      )}
      <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
        {s.starting ? 'starting…' : `${s.received.toLocaleString()} received`}
      </span>
      <span onClick={(e) => e.stopPropagation()} className="shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" title="Stop consumer" onClick={() => kafkaConsumerStore.stop(s.brokerId, s.topic)}>
          <Square className="h-3 w-3" />
        </Button>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}

function StartConsumerForm({ brokerId, refreshKey, sessions, prefill, onStarted }: {
  brokerId: string; refreshKey: number; sessions: KafkaConsumerSession[]; prefill?: TopicPrefill | null; onStarted: (topic: string) => void;
}) {
  const [topic, setTopic] = useState('');
  const [from, setFrom] = useState<ConsumeFrom>('latest');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    kafkaApi.listTopics(brokerId)
      .then((ts) => { if (alive) setTopics(ts.map((t) => t.name).sort((a, b) => a.localeCompare(b))); })
      .catch(() => { if (alive) setTopics([]); });
    return () => { alive = false; };
  }, [brokerId, refreshKey]);

  useEffect(() => {
    if (prefill?.topic) { setTopic(prefill.topic); setError(null); }
  }, [prefill?.token]);

  const alreadyRunning = sessions.some((s) => s.topic === topic.trim());

  const start = async () => {
    if (!topic.trim()) { setError('Pick or type a topic'); return; }
    if (alreadyRunning) { setError('A consumer is already running on this topic'); return; }
    setError(null);
    setBusy(true);
    const started = topic.trim();
    try {
      await kafkaConsumerStore.start(brokerId, started, from);
      kafkaInputHistory.add(brokerId, 'topic', started); // remember for the combobox
      setTopic('');
      onStarted(started); // jump straight to the new consumer's detail panel
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-semibold">Start a consumer</h3>
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <Label className="text-xs">Topic</Label>
          <TopicCombobox brokerId={brokerId} value={topic} topics={topics} onChange={(v) => { setTopic(v); setError(null); }} />
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <div className="mt-1">
            <Segmented<ConsumeFrom>
              value={from}
              onValueChange={setFrom}
              size="sm"
              options={[
                { value: 'latest', label: 'New only' },
                { value: 'earliest', label: 'Beginning' },
              ]}
            />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {from === 'latest'
          ? 'Streams only messages produced after you start (all partitions).'
          : 'Replays from the earliest retained offset, then follows new messages (all partitions).'}
        {' '}Anonymous: no consumer group is joined and no offsets are committed, so real consumers are unaffected.
      </p>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={start} disabled={busy || !topic.trim() || alreadyRunning}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Start consumer
        </Button>
        {alreadyRunning && <span className="text-[11px] text-amber-600 dark:text-amber-400">Already consuming this topic</span>}
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{error}</span>
        </div>
      )}
    </div>
  );
}

/** Full-panel detail view for a single consumer: status, controls, search, messages. */
function ConsumerDetail({ session: s, onBack }: { session: KafkaConsumerSession; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<ValueFormat>('json');

  const q = query.trim().toLowerCase();
  const matches = q
    ? s.messages.filter((m) =>
        (m.value ?? '').toLowerCase().includes(q)
        || (m.key ?? '').toLowerCase().includes(q)
        || String(m.partition).includes(q)
        || String(m.offset).includes(q))
    : s.messages;
  const shown = matches.slice(0, 200);
  const buffered = s.messages.length;
  const capped = s.received > buffered;

  return (
    <div className="tool-full-height">
      {/* Header: back · topic · status · controls */}
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => onBack()} className="text-muted-foreground hover:text-foreground shrink-0" title="Back to consumers">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className={cn('h-2 w-2 rounded-full shrink-0', s.paused ? 'bg-amber-500' : 'bg-emerald-500')} title={s.starting ? 'starting' : s.paused ? 'paused' : 'live'} />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm font-mono truncate">{s.topic}</h2>
            <p className="text-[11px] text-muted-foreground">
              {s.from === 'latest' ? 'new only' : 'from start'}
              {' · '}
              {s.starting ? 'starting…' : `${s.received.toLocaleString()} received`}
              {capped && ` · keeping last ${buffered.toLocaleString()}`}
              {s.paused && s.bufferedWhilePaused > 0 && ` · +${s.bufferedWhilePaused.toLocaleString()} buffered`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline" size="sm"
            title={s.paused ? 'Resume — apply buffered messages and follow live' : 'Pause — freeze the view to inspect (keeps buffering)'}
            onClick={() => kafkaConsumerStore.setPaused(s.brokerId, s.topic, !s.paused)}
            disabled={s.starting}
          >
            {s.paused ? <Play className="h-3.5 w-3.5 mr-1.5" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
            {s.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" title="Clear buffer" onClick={() => kafkaConsumerStore.clear(s.brokerId, s.topic)} disabled={s.received === 0}>
            <Trash className="h-3.5 w-3.5" />
          </Button>
          <Button variant="destructive" size="sm" onClick={() => { kafkaConsumerStore.stop(s.brokerId, s.topic); onBack(); }}>
            <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
          </Button>
        </div>
      </div>

      {/* Search + value format */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b shrink-0">
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search value, key, partition, offset…"
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Segmented<ValueFormat>
          value={format}
          onValueChange={setFormat}
          size="sm"
          options={[
            { value: 'json', label: 'JSON' },
            { value: 'plain', label: 'Plain' },
            { value: 'hex', label: 'Hex' },
          ]}
        />
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums shrink-0">
          {q ? `${matches.length.toLocaleString()} match${matches.length === 1 ? '' : 'es'}` : `${buffered.toLocaleString()} buffered`}
          {capped && ' · capped'}
        </span>
      </div>

      {/* Messages */}
      <div className="tool-scrollable">
        {shown.length === 0
          ? <p className="px-5 py-4 text-sm text-muted-foreground">{q ? 'No messages match your search.' : (s.starting ? 'Starting…' : 'Waiting for messages…')}</p>
          : (
            <div className="divide-y divide-border/40">
              {shown.map((m) => <MessageRow key={`${m.partition}-${m.offset}`} m={m} format={format} />)}
              {matches.length > shown.length && (
                <p className="px-5 py-2 text-[11px] text-muted-foreground">
                  Showing first 200 of {matches.length.toLocaleString()}{q ? ' matches' : ''}. Narrow your search to see more.
                </p>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

function MessageRow({ m, format }: { m: KafkaConsumedMessage; format: ValueFormat }) {
  const [expanded, setExpanded] = useState(false);
  const headerEntries = Object.entries(m.headers ?? {});

  return (
    <div>
      {/* Compact, scannable row — click to expand the full payload. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((x) => !x); } }}
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/40"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-[5.5rem]" title={m.timestamp}>{fmtTime(m.timestamp)}</span>
        <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">p{m.partition}</span>
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0 w-14">@{m.offset}</span>
        {m.key != null && m.key !== '' && (
          <span className="text-[11px] font-mono text-primary/80 truncate max-w-[9rem] shrink-0" title={`key: ${m.key}`}>{m.key}</span>
        )}
        <span className="flex-1 min-w-0 font-mono text-xs text-foreground/80 truncate">{previewValue(m, format)}</span>
        {headerEntries.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0" title={`${headerEntries.length} header(s)`}>⌗{headerEntries.length}</span>
        )}
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <CopyButton value={m.value ?? ''} iconClassName="h-3.5 w-3.5" />
        </span>
      </div>

      {/* Expanded detail — full value, key, and headers for tracing. */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2.5 bg-muted/10 border-t border-border/30">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] font-mono text-muted-foreground pt-1">
            <span>partition <span className="text-foreground">{m.partition}</span></span>
            <span>offset <span className="text-foreground">{m.offset}</span></span>
            <span>{m.timestamp}</span>
          </div>

          {m.key != null && m.key !== '' && (
            <DetailField label="Key" value={m.key} />
          )}

          {headerEntries.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1">Headers</div>
              <div className="rounded-md border divide-y divide-border/40 overflow-hidden">
                {headerEntries.map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-2.5 py-1 text-[11px] font-mono">
                    <span className="text-muted-foreground shrink-0">{k}</span>
                    <span className="text-foreground break-all flex-1 min-w-0">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-muted-foreground">Value</span>
              <CopyButton value={m.value ?? ''} iconClassName="h-3.5 w-3.5" />
            </div>
            {format === 'hex' ? (
              <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded-md border bg-background px-2.5 py-2">{formatValue(m, format)}</pre>
            ) : (
              <div className="flex h-64 rounded-md border bg-background overflow-hidden">
                <ResponseViewer value={formatValue(m, format)} language={format === 'json' ? 'json' : 'text'} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <CopyButton value={value} iconClassName="h-3.5 w-3.5" />
      </div>
      <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-md border bg-background px-2.5 py-1.5">{value}</pre>
    </div>
  );
}

/** Local HH:MM:SS.mmm for quick scanning (falls back to the raw timestamp). */
function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** One-line, whitespace-collapsed preview of the value for the compact row. */
function previewValue(m: KafkaConsumedMessage, format: ValueFormat): string {
  if (format === 'hex') {
    if (!m.valueB64) return m.value === null ? '(null)' : '(empty)';
    try { return `${base64ToBytes(m.valueB64).length} bytes (hex)`; } catch { return '(binary)'; }
  }
  if (m.value === null) return m.valueB64 ? '(binary — switch to Hex)' : '(null)';
  return m.value.replace(/\s+/g, ' ').trim() || '(empty)';
}

/** Render the record value per the chosen format. */
function formatValue(m: KafkaConsumedMessage, format: ValueFormat): string {
  if (format === 'hex') {
    if (!m.valueB64) return m.value === null ? '(null)' : '(empty)';
    try { return hexDump(base64ToBytes(m.valueB64)); } catch { return '(unable to decode)'; }
  }
  if (m.value === null) return m.valueB64 ? '(binary — switch to Hex)' : '(null)';
  if (format === 'json') {
    try { return JSON.stringify(JSON.parse(m.value), null, 2); } catch { return m.value; }
  }
  return m.value; // plain
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Classic 16-byte-per-row hex dump with an ASCII gutter. */
function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.subarray(i, i + 16);
    const hex = Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(16 * 3 - 1, ' ');
    const ascii = Array.from(slice).map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return lines.join('\n') || '(empty)';
}

/** Searchable topic picker that also accepts a typed (custom) topic name. */
function TopicCombobox({ brokerId, value, topics, onChange }: {
  brokerId: string; value: string; topics: string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recent = useKafkaRecentMatches(brokerId, 'topic', value);
  const q = value.trim().toLowerCase();
  const matches = topics.filter((t) => t.toLowerCase().includes(q) && !recent.includes(t)).slice(0, 50);

  const pick = (v: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="relative mt-1">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="topic name — type to search"
        className="font-mono text-sm h-9"
      />
      {open && (recent.length > 0 || matches.length > 0) && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md-premium max-h-64 overflow-y-auto py-1">
          <RecentSuggestions items={recent} brokerId={brokerId} field="topic" value={value} onPick={pick} />
          {matches.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(t); }}
              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/60', value === t && 'text-primary')}
            >
              <span className="font-mono text-sm flex-1 truncate">{t}</span>
              {value === t && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
