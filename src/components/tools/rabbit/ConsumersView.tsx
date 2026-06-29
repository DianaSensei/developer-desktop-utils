import { useEffect, useRef, useState } from 'react';
import {
  Headphones, Play, Square, Loader2, AlertCircle, ChevronDown, ChevronRight, Check, RefreshCw, Trash, Search,
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
import { consumerStore, useConsumers, type ConsumerSession } from './consumerStore';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConsumerPrefill } from './useRabbitState';

interface ConsumersViewProps {
  conn: RabbitConnection;
  refreshKey: number;
  onRefresh: () => void;
  prefill?: ConsumerPrefill | null;
}

const MODE_LABEL: Record<ConsumeAckMode, string> = {
  peek: 'Peek (keep)',
  consume: 'Consume (ack)',
  respond: 'Respond (reply)',
};

export function ConsumersView({ conn, refreshKey, onRefresh, prefill }: ConsumersViewProps) {
  const sessions = useConsumers().filter((s) => s.connId === conn.id);
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
          <StartConsumerForm conn={conn} queues={queues.data ?? []} sessions={sessions} prefill={prefill} />

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Active consumers</h3>
            {sessions.length === 0
              ? <p className="text-sm text-muted-foreground">No consumers running. Start one above.</p>
              : <div className="space-y-3">{sessions.map((s) => <ConsumerCard key={s.queue} session={s} />)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StartConsumerForm({ conn, queues, sessions, prefill }: {
  conn: RabbitConnection; queues: QueueInfo[]; sessions: ConsumerSession[]; prefill?: ConsumerPrefill | null;
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
    try {
      const reply = mode === 'respond' ? { echo, payload: replyPayload, contentType: replyContentType.trim() || undefined } : null;
      await consumerStore.start(conn.id, queue.trim(), mode, prefetch, reply);
      setQueue('');
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
          <QueueCombobox value={queue} queues={queues} onChange={(v) => { setQueue(v); setError(null); }} />
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

function ConsumerCard({ session: s }: { session: ConsumerSession }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

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
    <div className="rounded-lg border bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title={s.starting ? 'starting' : 'live'} />
        <button className="flex items-center gap-1.5 min-w-0" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="font-mono text-sm truncate">{s.queue}</span>
        </button>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide shrink-0">{MODE_LABEL[s.mode]}</span>
        {s.mode === 'respond' && (
          <span className="text-[10px] text-muted-foreground shrink-0">{s.reply?.echo ? 'echo' : 'static reply'}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0" title={capped ? `Keeping the most recent ${buffered.toLocaleString()} of ${s.received.toLocaleString()}` : undefined}>
          {s.starting ? 'starting…' : `${s.received.toLocaleString()} received`}
        </span>
        <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => consumerStore.clear(s.connId, s.queue)} disabled={s.received === 0}>
          <Trash className="h-3 w-3" />
        </Button>
        <Button variant="destructive" size="sm" className="h-7 shrink-0" onClick={() => consumerStore.stop(s.connId, s.queue)}>
          <Square className="h-3 w-3 mr-1" /> Stop
        </Button>
      </div>

      {open && (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search payload, routing key, exchange, correlation id…"
                className="pl-8 h-8 text-xs"
              />
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {q ? `${matches.length.toLocaleString()} match${matches.length === 1 ? '' : 'es'}` : `${buffered.toLocaleString()} buffered`}
              {capped && ' · capped'}
            </span>
          </div>

          {shown.length === 0
            ? <p className="px-3 py-3 text-xs text-muted-foreground">{q ? 'No messages match your search.' : (s.starting ? 'Starting…' : 'Waiting for messages…')}</p>
            : (
              <div className="divide-y divide-border/40 max-h-96 overflow-y-auto">
                {shown.map((m, i) => (
                  <div key={`${m.deliveryTag}-${i}`} className="px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-0.5">
                      <span className="font-mono truncate">
                        {m.exchange ? `${m.exchange} · ` : ''}{m.routingKey || '—'}
                        {m.correlationId ? ` · corr ${m.correlationId}` : ''}
                        {m.redelivered && <span className="text-amber-500"> · redelivered</span>}
                      </span>
                      <CopyButton value={m.payload} iconClassName="h-3.5 w-3.5" />
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{m.payload}</pre>
                  </div>
                ))}
                {matches.length > shown.length && (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">
                    Showing first {RENDER_CAP} of {matches.length.toLocaleString()}{q ? ' matches' : ''}. Narrow your search to see more.
                  </p>
                )}
              </div>
            )}
        </>
      )}
    </div>
  );
}

/** Searchable queue picker that also accepts a typed (custom) queue name. */
function QueueCombobox({ value, queues, onChange }: {
  value: string; queues: QueueInfo[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = value.trim().toLowerCase();
  const matches = queues.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 50);

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
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md-premium max-h-64 overflow-y-auto py-1">
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
