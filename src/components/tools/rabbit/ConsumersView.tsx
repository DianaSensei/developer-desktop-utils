import { useEffect, useRef, useState } from 'react';
import {
  Headphones, Play, Pause, Square, Loader2, AlertCircle, ChevronDown, ChevronRight, Check, RefreshCw, Trash, Search, ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/segmented';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import type { RabbitConnection, QueueInfo, ConsumeAckMode } from './types';
import { rabbitApi } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { useKnownNames } from './knownNamesStore';
import { inputHistory, useRecentMatches } from './inputHistoryStore';
import { RecentSuggestions } from './RecentSuggestions';
import { consumerStore, useConsumers, type ConsumerSession } from './consumerStore';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConsumerPrefill } from './useRabbitState';

interface ConsumersViewProps {
  conn: RabbitConnection;
  refreshKey: number;
  onRefresh: () => void;
  prefill?: ConsumerPrefill | null;
  /** Queue of the consumer to show in detail; null = the consumer list. */
  detailQueue: string | null;
  onOpenConsumer: (queue: string) => void;
  onCloseDetail: () => void;
}

const MODE_LABEL: Record<ConsumeAckMode, string> = {
  peek: 'Peek (keep)',
  consume: 'Consume (ack)',
  respond: 'Respond (reply)',
};

export function ConsumersView({ conn, refreshKey, onRefresh, prefill, detailQueue, onOpenConsumer, onCloseDetail }: ConsumersViewProps) {
  const sessions = useConsumers().filter((s) => s.connId === conn.id);
  const detail = detailQueue ? sessions.find((s) => s.queue === detailQueue) : undefined;

  // Queue choices: the broker's queue list (management) or the tracked names
  // (AMQP-only), with live counts from a passive declare.
  const known = useKnownNames(conn.id).queues;
  const queues = useRabbitData<QueueInfo[]>(
    async () => {
      if (conn.amqpOnly) {
        if (!known.length) return [];
        const infos = await rabbitApi.amqpQueuesInfo(conn.id, known);
        return infos.map((i) => ({
          name: i.name,
          vhost: conn.vhost,
          messages: i.messages ?? undefined,
          consumers: i.consumers ?? undefined,
        } as QueueInfo));
      }
      return rabbitMgmt.listQueues(conn);
    },
    [conn.id, refreshKey, conn.amqpOnly, known.join(' ')],
  );

  // Detail panel for a single consumer (when one is selected and still running).
  if (detailQueue && detail) {
    return <ConsumerDetail session={detail} onBack={onCloseDetail} />;
  }

  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Headphones className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Consumers</h2>
            <p className="text-[11px] text-muted-foreground">{sessions.length} active · vhost {conn.vhost}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="tool-scrollable px-5 py-5">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <StartConsumerForm conn={conn} queues={queues.data ?? []} sessions={sessions} prefill={prefill} onStarted={onOpenConsumer} />

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Active consumers</h3>
            {sessions.length === 0
              ? <p className="text-sm text-muted-foreground">No consumers running. Start one above.</p>
              : (
                <div className="rounded-lg border divide-y divide-border/40 overflow-hidden">
                  {sessions.map((s) => <ConsumerListRow key={s.queue} session={s} onOpen={() => onOpenConsumer(s.queue)} />)}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact row in the consumer list — click to open its detail panel. */
function ConsumerListRow({ session: s, onOpen }: { session: ConsumerSession; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/40"
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', s.paused ? 'bg-amber-500' : 'bg-emerald-500')} title={s.starting ? 'starting' : s.paused ? 'paused' : 'live'} />
      <span className="font-mono text-sm truncate">{s.queue}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide shrink-0">{MODE_LABEL[s.mode]}</span>
      {s.paused && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 uppercase tracking-wide shrink-0">paused</span>
      )}
      <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
        {s.starting ? 'starting…' : `${s.received.toLocaleString()} received`}
      </span>
      <span onClick={(e) => e.stopPropagation()} className="shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" title="Stop consumer" onClick={() => consumerStore.stop(s.connId, s.queue)}>
          <Square className="h-3 w-3" />
        </Button>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}

function StartConsumerForm({ conn, queues, sessions, prefill, onStarted }: {
  conn: RabbitConnection; queues: QueueInfo[]; sessions: ConsumerSession[]; prefill?: ConsumerPrefill | null; onStarted: (queue: string) => void;
}) {
  const [queue, setQueue] = useState('');
  const [mode, setMode] = useState<ConsumeAckMode>('peek');
  const [prefetch, setPrefetch] = useState(20);
  const [echo, setEcho] = useState(true);
  const [replyPayload, setReplyPayload] = useState('');
  const [replyContentType, setReplyContentType] = useState('application/json');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Pre-fill the queue when opened from a queue's Consume button (token bumps on re-click).
  useEffect(() => {
    if (prefill?.queue) { setQueue(prefill.queue); setError(null); }
  }, [prefill?.token]);

  const alreadyRunning = sessions.some((s) => s.queue === queue.trim());

  // Warn when the target queue already has consumers: RabbitMQ delivers each
  // message to only one consumer, so a new one competes for (and can withhold)
  // messages from the existing workers — even in peek mode.
  const matched = queues.find((x) => x.name === queue.trim());
  const existingConsumers = matched?.consumers ?? 0;

  // Clicking Start opens a confirmation that spells out the effect on the
  // broker; the consumer only starts once it's confirmed.
  const requestStart = () => {
    if (!queue.trim()) { setError('Pick or type a queue'); return; }
    if (alreadyRunning) { setError('A consumer is already running on this queue'); return; }
    setError(null);
    setConfirmOpen(true);
  };

  const doStart = async () => {
    setBusy(true);
    const started = queue.trim();
    try {
      const reply = mode === 'respond' ? { echo, payload: replyPayload, contentType: replyContentType.trim() || undefined } : null;
      await consumerStore.start(conn.id, started, mode, prefetch, reply);
      inputHistory.add(conn.id, 'queue', started); // remember for the combobox
      setQueue('');
      onStarted(started); // jump to the new consumer's detail panel
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // Plain-language summary of what starting this consumer does to the broker.
  const effectByMode: Record<ConsumeAckMode, string> = {
    peek: `It opens a real AMQP subscription on "${queue.trim()}". Up to ${prefetch} message${prefetch > 1 ? 's' : ''} will be delivered unacked and held in flight; they stay in the queue and are requeued (flagged redelivered) when you stop. Nothing is removed.`,
    consume: `It opens a real AMQP subscription on "${queue.trim()}" and acknowledges every message it receives — those messages are permanently removed from the queue. This cannot be undone.`,
    respond: `It opens a real AMQP subscription on "${queue.trim()}", acknowledges (removes) each request, and publishes a reply to the request's reply_to. The tool acts as an RPC server for this queue.`,
  };
  const confirmDescription = existingConsumers > 0
    ? `${effectByMode[mode]} This queue already has ${existingConsumers} other consumer${existingConsumers > 1 ? 's' : ''} — messages go to only one consumer, so this one will take a share of them.`
    : effectByMode[mode];

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="text-sm font-semibold">Start a consumer</h3>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <Label className="text-xs">Queue</Label>
          <QueueCombobox connId={conn.id} value={queue} queues={queues} onChange={(v) => { setQueue(v); setError(null); }} />
        </div>
        <div className="w-24">
          <Label htmlFor="cs-prefetch" className="text-xs">Prefetch</Label>
          <Input id="cs-prefetch" type="number" min={1} max={500} value={prefetch}
            onChange={(e) => setPrefetch(Math.max(1, Math.min(500, Number(e.target.value))))}
            className="mt-1 h-9" />
        </div>
      </div>

      <div>
        <Label className="text-xs">Mode</Label>
        <div className="mt-1">
          <Segmented<ConsumeAckMode>
            value={mode}
            onValueChange={setMode}
            size="sm"
            options={[
              { value: 'peek', label: 'Peek (keep)' },
              { value: 'consume', label: 'Consume (ack)' },
              { value: 'respond', label: 'Respond (reply)' },
            ]}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {mode === 'peek' && 'Leaves messages in the queue (delivered unacked, bounded by prefetch; requeued on stop).'}
          {mode === 'consume' && 'Acknowledges (removes) each message from the queue.'}
          {mode === 'respond' && 'Acts as an RPC server: acks each request and publishes a reply to its reply_to with the same correlation id.'}
        </p>
      </div>

      {existingConsumers > 0 && !alreadyRunning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="break-words">
            This queue already has {existingConsumers} consumer{existingConsumers > 1 ? 's' : ''}. RabbitMQ delivers each
            message to only one consumer, so this one will take a share of them.
            {mode === 'peek'
              ? ` In peek mode up to ${prefetch} message${prefetch > 1 ? 's' : ''} are held unacked (withheld from the others) and requeued as redelivered when you stop.`
              : mode === 'consume'
                ? ' In consume mode the messages it receives are acked (removed) and will not reach the others.'
                : ' Requests it handles will be answered by this tool instead of the existing consumers.'}
          </span>
        </div>
      )}

      {mode === 'respond' && (
        <div className="rounded-md border bg-muted/10 p-3 space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-xs">
              <span className="font-medium">Echo request</span>
              <span className="block text-[11px] text-muted-foreground">Reply with the request body</span>
            </span>
            <Switch checked={echo} onCheckedChange={setEcho} aria-label="Echo request" />
          </label>
          {!echo && (
            <div>
              <Label className="text-xs">Reply payload</Label>
              <Textarea value={replyPayload} onChange={(e) => setReplyPayload(e.target.value)} placeholder='{"status":"ok"}' className="mt-1 font-mono text-xs min-h-20" />
            </div>
          )}
          <div>
            <Label className="text-xs">Reply content type</Label>
            <Input value={replyContentType} onChange={(e) => setReplyContentType(e.target.value)} placeholder="application/json" className="mt-1 font-mono text-xs h-8" />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={requestStart} disabled={busy || !queue.trim() || alreadyRunning}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Start consumer
        </Button>
        {alreadyRunning && <span className="text-[11px] text-amber-600 dark:text-amber-400">Already consuming this queue</span>}
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{error}</span>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Start ${MODE_LABEL[mode]} consumer?`}
        description={confirmDescription}
        confirmLabel="Start consumer"
        destructive={mode !== 'peek'}
        onConfirm={doStart}
      />
    </div>
  );
}

const RENDER_CAP = 200; // rows actually rendered; search runs across the full buffer.

type ValueFormat = 'json' | 'plain';

/** Full-panel detail view for a single consumer: status, controls, search, messages. */
function ConsumerDetail({ session: s, onBack }: { session: ConsumerSession; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<ValueFormat>('json');

  const q = query.trim().toLowerCase();
  const matches = q
    ? s.messages.filter((m) =>
        m.payload.toLowerCase().includes(q)
        || m.routingKey.toLowerCase().includes(q)
        || (m.exchange ?? '').toLowerCase().includes(q)
        || (m.correlationId ?? '').toLowerCase().includes(q))
    : s.messages;
  const shown = matches.slice(0, RENDER_CAP);
  const buffered = s.messages.length;
  const capped = s.received > buffered;

  return (
    <div className="tool-full-height">
      {/* Header: back · queue · mode · controls */}
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => onBack()} className="text-muted-foreground hover:text-foreground shrink-0" title="Back to consumers">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className={cn('h-2 w-2 rounded-full shrink-0', s.paused ? 'bg-amber-500' : 'bg-emerald-500')} title={s.starting ? 'starting' : s.paused ? 'paused' : 'live'} />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm font-mono truncate">{s.queue}</h2>
            <p className="text-[11px] text-muted-foreground">
              {MODE_LABEL[s.mode]}
              {s.mode === 'respond' && ` · ${s.reply?.echo ? 'echo' : 'static reply'}`}
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
            onClick={() => consumerStore.setPaused(s.connId, s.queue, !s.paused)}
            disabled={s.starting}
          >
            {s.paused ? <Play className="h-3.5 w-3.5 mr-1.5" /> : <Pause className="h-3.5 w-3.5 mr-1.5" />}
            {s.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" title="Clear buffer" onClick={() => consumerStore.clear(s.connId, s.queue)} disabled={s.received === 0}>
            <Trash className="h-3.5 w-3.5" />
          </Button>
          <Button variant="destructive" size="sm" onClick={() => { consumerStore.stop(s.connId, s.queue); onBack(); }}>
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
            placeholder="Search payload, routing key, exchange, correlation id…"
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
              {shown.map((m, i) => <MessageRow key={`${m.deliveryTag}-${i}`} m={m} format={format} />)}
              {matches.length > shown.length && (
                <p className="px-5 py-2 text-[11px] text-muted-foreground">
                  Showing first {RENDER_CAP} of {matches.length.toLocaleString()}{q ? ' matches' : ''}. Narrow your search to see more.
                </p>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

function MessageRow({ m, format }: { m: import('./types').ConsumedMessage; format: ValueFormat }) {
  const [expanded, setExpanded] = useState(false);
  const headerEntries = Object.entries(m.headers ?? {});
  const body = format === 'json' ? tryPretty(m.payload) : m.payload;
  const preview = m.payload.replace(/\s+/g, ' ').trim() || '(empty)';

  return (
    <div>
      {/* Compact, scannable row — click to expand the full payload. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((x) => !x); } }}
        className="flex items-center gap-2 px-5 py-1.5 cursor-pointer hover:bg-muted/40"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[12rem] shrink-0" title={`${m.exchange ? m.exchange + ' · ' : ''}${m.routingKey || '—'}`}>
          {m.exchange ? `${m.exchange}/` : ''}{m.routingKey || '—'}
        </span>
        {m.correlationId && <span className="text-[10px] font-mono text-primary/80 truncate max-w-[8rem] shrink-0" title={`correlation id: ${m.correlationId}`}>corr {m.correlationId}</span>}
        {m.redelivered && <span className="text-[10px] text-amber-500 shrink-0">redelivered</span>}
        <span className="flex-1 min-w-0 font-mono text-xs text-foreground/80 truncate">{preview}</span>
        {headerEntries.length > 0 && <span className="text-[10px] text-muted-foreground shrink-0" title={`${headerEntries.length} header(s)`}>⌗{headerEntries.length}</span>}
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <CopyButton value={m.payload} iconClassName="h-3.5 w-3.5" />
        </span>
      </div>

      {expanded && (
        <div className="px-5 pb-3 pt-1 space-y-2.5 bg-muted/10 border-t border-border/30">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] font-mono text-muted-foreground pt-1">
            <span>exchange <span className="text-foreground">{m.exchange || '(default)'}</span></span>
            <span>routing key <span className="text-foreground">{m.routingKey || '—'}</span></span>
            {m.correlationId && <span>correlation id <span className="text-foreground">{m.correlationId}</span></span>}
            {m.contentType && <span>content-type <span className="text-foreground">{m.contentType}</span></span>}
            {m.messageId && <span>message id <span className="text-foreground">{m.messageId}</span></span>}
            {m.redelivered && <span className="text-amber-500">redelivered</span>}
          </div>

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
              <span className="text-[11px] font-medium text-muted-foreground">Payload</span>
              <CopyButton value={m.payload} iconClassName="h-3.5 w-3.5" />
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded-md border bg-background px-2.5 py-2">{body}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pretty-print JSON payloads; fall back to the raw string. */
function tryPretty(payload: string): string {
  try { return JSON.stringify(JSON.parse(payload), null, 2); } catch { return payload; }
}

/** Searchable queue picker that also accepts a typed (custom) queue name. */
function QueueCombobox({ connId, value, queues, onChange }: {
  connId: string; value: string; queues: QueueInfo[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recent = useRecentMatches(connId, 'queue', value);
  const q = value.trim().toLowerCase();
  const matches = queues.filter((x) => x.name.toLowerCase().includes(q) && !recent.includes(x.name)).slice(0, 50);

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
        placeholder="queue name — type to search"
        className="font-mono text-sm h-9"
      />
      {open && (recent.length > 0 || matches.length > 0) && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md-premium max-h-64 overflow-y-auto py-1">
          <RecentSuggestions items={recent} connId={connId} field="queue" value={value} onPick={pick} />
          {matches.map((x) => (
            <button
              key={x.name}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(x.name); }}
              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/60', value === x.name && 'text-primary')}
            >
              <span className="font-mono text-sm flex-1 truncate">{x.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{x.messages ?? 0}</span>
              {value === x.name && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
