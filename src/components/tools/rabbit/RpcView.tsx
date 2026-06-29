import { useEffect, useRef, useState } from 'react';
import { Repeat, Loader2, AlertCircle, AlertTriangle, RefreshCw, Send, CheckCircle2, ChevronDown, ChevronRight, Timer, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/segmented';
import { CopyButton } from '@/components/ui/copy-button';
// Read-only CodeMirror viewer (line numbers, folding, JSON/plain highlighting) —
// reused so the reply renders like a code editor.
import { ResponseViewer } from '@/components/tools/apiclient/ResponseViewer';
// Editable CodeMirror editor for the request payload (same highlighting).
import { CodeEditor } from '@/components/tools/apiclient/CodeEditor';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import type { RabbitConnection, RpcReply, PublishOutcome, MessageProperties, ExchangeInfo, QueueInfo, BindingInfo } from './types';
import { rabbitApi } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { useKnownNames } from './knownNamesStore';
import type { RpcPrefill } from './useRabbitState';

interface RpcViewProps {
  conn: RabbitConnection;
  prefill: RpcPrefill | null;
}

type Mode = 'request' | 'send';

/**
 * The single publish surface for the tool. "Publish" is a full AMQP publish (all
 * message properties, mandatory + publisher confirms); "Request/Response" awaits a
 * correlated reply via direct reply-to. Entry points (queue/exchange Publish
 * buttons) open this panel pre-filled via `prefill`.
 */
export function RpcView({ conn, prefill }: RpcViewProps) {
  const [mode, setMode] = usePersistentState<Mode>('devtool:rabbit:rpcMode', 'request');
  const [exchange, setExchange] = useState('');
  const [routingKey, setRoutingKey] = useState('');
  const [payload, setPayload] = useState('');
  // Payload editor: JSON highlighting (+ Format action) or plain text.
  const [payloadFormat, setPayloadFormat] = usePersistentState<'json' | 'plain'>('devtool:rabbit:payloadFormat', 'json');

  // Message properties
  const [contentType, setContentType] = useState('application/json');
  const [contentEncoding, setContentEncoding] = useState('');
  const [persistent, setPersistent] = useState(true);
  const [priority, setPriority] = useState('');
  const [expiration, setExpiration] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [messageId, setMessageId] = useState('');
  const [type, setType] = useState('');
  const [appId, setAppId] = useState('');
  const [userId, setUserId] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [showOptions, setShowOptions] = useState(false);

  // Delivery (publish mode) / wait (request mode)
  const [mandatory, setMandatory] = useState(false);
  const [confirm, setConfirm] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(5000);

  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<RpcReply | null>(null);
  // Reply rendering: pretty-printed + highlighted JSON, or plain text.
  const [replyFormat, setReplyFormat] = usePersistentState<'json' | 'plain'>('devtool:rabbit:replyFormat', 'json');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqGen = useRef(0);

  // Exchange suggestions: the broker's list (management) or the tracked names (AMQP-only).
  const knownExchanges = useKnownNames(conn.id).exchanges;
  const exchanges = useRabbitData<ExchangeInfo[]>(
    async () => conn.amqpOnly
      ? knownExchanges.map((name) => ({ name, vhost: conn.vhost } as ExchangeInfo))
      : rabbitMgmt.listExchanges(conn),
    [conn.id, conn.amqpOnly, knownExchanges.join(' ')],
  );

  const reset = () => { setReply(null); setElapsed(null); setOutcome(null); setStopped(false); setError(null); };

  /** Pretty-print the payload as JSON in place; no-op if it isn't valid JSON. */
  const formatPayload = () => {
    try { setPayload(JSON.stringify(JSON.parse(payload), null, 2)); reset(); } catch { /* leave as typed */ }
  };

  // Apply a prefill from an entry point (e.g. a queue/exchange Publish button).
  useEffect(() => {
    if (!prefill) return;
    setMode(prefill.mode);
    setExchange(prefill.exchange);
    setRoutingKey(prefill.routingKey);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.token]);

  const send = async () => {
    const myGen = ++reqGen.current;
    setSending(true);
    reset();

    let headers: Record<string, string> | undefined;
    if (headersText.trim()) {
      try {
        const parsed = JSON.parse(headersText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
      } catch {
        setError('Headers must be a JSON object, e.g. {"__TypeId__": "..."}');
        setSending(false);
        return;
      }
    }

    const trim = (v: string) => (v.trim() ? v.trim() : undefined);
    const started = performance.now();
    try {
      if (mode === 'send') {
        const properties: MessageProperties = { persistent };
        properties.contentType = trim(contentType);
        properties.contentEncoding = trim(contentEncoding);
        properties.correlationId = trim(correlationId);
        properties.replyTo = trim(replyTo);
        properties.messageId = trim(messageId);
        properties.type = trim(type);
        properties.appId = trim(appId);
        properties.userId = trim(userId);
        properties.expiration = trim(expiration);
        if (priority.trim()) properties.priority = Math.max(0, Math.min(255, Number(priority)));
        if (headers) properties.headers = headers;
        const o = await rabbitApi.publish({ configId: conn.id, exchange, routingKey, payload, properties, mandatory, confirm });
        if (reqGen.current !== myGen) return;
        setOutcome(o);
      } else {
        const r = await rabbitApi.rpcCall({
          configId: conn.id, exchange, routingKey, payload,
          correlationId: correlationId.trim() || null,
          contentType: contentType.trim() || null,
          headers: headers ?? null,
          timeoutMs,
        });
        if (reqGen.current !== myGen) return;
        setReply(r);
        // Default to JSON view when the reply looks like JSON (by content type or
        // by parsing); otherwise plain. The user can still flip it.
        const ct = r.contentType?.toLowerCase() ?? '';
        setReplyFormat(ct.includes('json') || isJsonParseable(r.payload) ? 'json' : 'plain');
        setElapsed(Math.round(performance.now() - started));
      }
    } catch (e) {
      if (reqGen.current !== myGen) return;
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (reqGen.current === myGen) setSending(false);
    }
  };

  const cancel = () => { reqGen.current++; setSending(false); setStopped(true); };

  // The reply as shown: pretty-printed when JSON view is on (falls back to raw if
  // it doesn't parse), else the raw payload.
  const replyText = reply ? (replyFormat === 'json' ? prettyJsonOrRaw(reply.payload) : reply.payload) : '';

  const routingHint = exchange === ''
    ? <>Default exchange — the message goes to the queue <span className="font-mono text-foreground">named exactly the routing key</span>.</>
    : <>Routes via <span className="font-mono text-foreground">{exchange}</span> by its type (direct/topic/fanout/headers).</>;

  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Repeat className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Send / Request</h2>
            <p className="text-[11px] text-muted-foreground truncate">
              AMQP ({conn.useTls ? 'amqps' : 'amqp'}://{conn.host}:{conn.amqpPort}) · vhost {conn.vhost}
            </p>
          </div>
        </div>
        <Segmented<Mode>
          value={mode}
          onValueChange={(m) => { setMode(m); reset(); }}
          size="sm"
          options={[
            { value: 'send', label: 'Publish' },
            { value: 'request', label: 'Request/Response' },
          ]}
        />
      </div>

      <div className="tool-scrollable px-5 py-5">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          {/* Destination */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Exchange</Label>
              <ExchangeCombobox value={exchange} exchanges={exchanges.data ?? []} onChange={(v) => { setExchange(v); reset(); }} />
            </div>
            <div>
              <Label className="text-xs">Routing key</Label>
              <RoutingKeyCombobox
                conn={conn}
                exchange={exchange}
                value={routingKey}
                onChange={(v) => { setRoutingKey(v); reset(); }}
              />
            </div>
          </div>
          <p className="-mt-2.5 text-[11px] text-muted-foreground leading-relaxed">{routingHint}</p>

          {/* Payload */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <Label className="text-xs">Payload</Label>
              <div className="flex items-center gap-2">
                {payloadFormat === 'json' && (
                  <button
                    type="button"
                    onClick={formatPayload}
                    disabled={!payload.trim()}
                    className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                    title="Pretty-print as JSON"
                  >
                    Format
                  </button>
                )}
                <Segmented<'json' | 'plain'>
                  value={payloadFormat}
                  onValueChange={setPayloadFormat}
                  size="sm"
                  aria-label="Payload format"
                  options={[
                    { value: 'json', label: 'JSON' },
                    { value: 'plain', label: 'Plain' },
                  ]}
                />
              </div>
            </div>
            {/* key on format so CodeMirror swaps grammar cleanly (language is fixed at mount). */}
            <CodeEditor
              key={payloadFormat}
              value={payload}
              onChange={(v) => { setPayload(v); reset(); }}
              language={payloadFormat === 'json' ? 'json' : 'text'}
              placeholder={'{"hello": "world"}'}
              className="min-h-40"
            />
          </div>

          {/* Delivery toggles (publish only) */}
          {mode === 'send' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer">
                <span className="text-xs">
                  <span className="font-medium">Mandatory</span>
                  <span className="block text-[11px] text-muted-foreground">Return if unroutable</span>
                </span>
                <Switch checked={mandatory} onCheckedChange={(v) => { setMandatory(v); reset(); }} aria-label="Mandatory" />
              </label>
              <label className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer">
                <span className="text-xs">
                  <span className="font-medium">Publisher confirm</span>
                  <span className="block text-[11px] text-muted-foreground">Wait for broker ack</span>
                </span>
                <Switch checked={confirm} onCheckedChange={(v) => { setConfirm(v); reset(); }} aria-label="Publisher confirm" />
              </label>
            </div>
          )}

          {/* Message options (collapsible) */}
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowOptions((s) => !s)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showOptions ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Message options
              <span className="text-[11px] font-normal text-muted-foreground/70">
                {mode === 'send' ? '— properties, headers' : '— content type, correlation id, headers'}
              </span>
            </button>
            {showOptions && (
              <div className="px-3 pb-3 space-y-3 border-t pt-3">
                {mode === 'send' && (
                  <label className="flex items-center justify-between">
                    <span className="text-xs font-medium">Persistent (delivery mode 2)</span>
                    <Switch checked={persistent} onCheckedChange={(v) => { setPersistent(v); reset(); }} aria-label="Persistent" />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Content type" value={contentType} onChange={setContentType} reset={reset} placeholder="application/json" />
                  <div>
                    <Label className="text-xs">Correlation ID</Label>
                    <div className="mt-1 flex gap-1">
                      <Input value={correlationId} onChange={(e) => { setCorrelationId(e.target.value); reset(); }} placeholder="(auto)" className="font-mono text-xs h-8" />
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Generate" onClick={() => { setCorrelationId(crypto.randomUUID()); reset(); }}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {mode === 'send' && <>
                    <Field label="Content encoding" value={contentEncoding} onChange={setContentEncoding} reset={reset} placeholder="utf-8 / gzip" />
                    <Field label="Priority (0–255)" value={priority} onChange={setPriority} reset={reset} placeholder="(none)" />
                    <Field label="Expiration (ms)" value={expiration} onChange={setExpiration} reset={reset} placeholder="60000" />
                    <Field label="Reply to" value={replyTo} onChange={setReplyTo} reset={reset} placeholder="reply queue" />
                    <Field label="Message ID" value={messageId} onChange={setMessageId} reset={reset} placeholder="(optional)" />
                    <Field label="Type" value={type} onChange={setType} reset={reset} placeholder="(optional)" />
                    <Field label="App ID" value={appId} onChange={setAppId} reset={reset} placeholder="(optional)" />
                    <Field label="User ID" value={userId} onChange={setUserId} reset={reset} placeholder="must match login" />
                  </>}
                </div>
                <div>
                  <Label htmlFor="rpc-headers" className="text-xs">Headers (JSON object)</Label>
                  <Textarea id="rpc-headers" value={headersText} onChange={(e) => { setHeadersText(e.target.value); reset(); }} placeholder={'{"__TypeId__": "com.example.MyRequest"}'} className="mt-1 font-mono text-xs min-h-16" />
                </div>
              </div>
            )}
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 flex-wrap">
            {mode === 'request' && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Timer className="h-3.5 w-3.5" />
                timeout
                <Input type="number" min={100} value={timeoutMs} onChange={(e) => setTimeoutMs(Math.max(100, Number(e.target.value)))} className="h-7 w-20 font-mono text-xs" />
                ms
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {sending && mode === 'request' && (
                <Button variant="outline" onClick={cancel}><X className="h-4 w-4 mr-1.5" /> Cancel</Button>
              )}
              <Button onClick={send} disabled={sending || !payload}>
                {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                {sending ? (mode === 'send' ? 'Sending…' : 'Awaiting reply…') : (mode === 'send' ? 'Publish' : 'Send & await reply')}
              </Button>
            </div>
          </div>

          {/* Status chips */}
          {(elapsed != null || outcome || stopped) && (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              {elapsed != null && (
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" /> Replied in {elapsed} ms
                </span>
              )}
              {outcome && (
                outcome.routed ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Check className="h-4 w-4" /> {outcome.confirmed ? 'Sent & confirmed · routed' : 'Sent · routed'}
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" /> Sent but unroutable{outcome.returnReason ? ` (${outcome.returnReason})` : ''}
                  </span>
                )
              )}
              {stopped && <span className="text-muted-foreground">Stopped waiting for a reply.</span>}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {reply && (
            <div className="rounded-lg border bg-card/40 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-muted/20 border-b text-[11px] text-muted-foreground">
                <span className="font-mono truncate">
                  Reply{reply.contentType ? ` · ${reply.contentType}` : ''}
                  {reply.correlationId ? ` · correlation_id: ${reply.correlationId}` : ''}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <Segmented<'json' | 'plain'>
                    value={replyFormat}
                    onValueChange={setReplyFormat}
                    size="sm"
                    aria-label="Reply format"
                    options={[
                      { value: 'json', label: 'JSON' },
                      { value: 'plain', label: 'Plain' },
                    ]}
                  />
                  <CopyButton value={replyText} iconClassName="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex h-72 flex-col">
                <ResponseViewer value={replyText} language={replyFormat === 'json' ? 'json' : 'text'} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function isJsonParseable(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

/** Pretty-print JSON for the reply viewer; return the raw text if it doesn't parse. */
function prettyJsonOrRaw(payload: string): string {
  try { return JSON.stringify(JSON.parse(payload), null, 2); } catch { return payload; }
}

function Field({ label, value, onChange, reset, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; reset: () => void; placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => { onChange(e.target.value); reset(); }} placeholder={placeholder} className="mt-1 font-mono text-xs h-8" />
    </div>
  );
}

interface RkSuggestion { key: string; hint: string }

/**
 * Routing-key input with suggestions derived from the broker: queue names for the
 * default exchange (the key routes to the queue of that name), or the routing keys
 * of the chosen exchange's bindings otherwise. Free typing is always allowed.
 */
function RoutingKeyCombobox({ conn, exchange, value, onChange }: {
  conn: RabbitConnection; exchange: string; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ex = exchange.trim();
  const isDefault = ex === '';
  const knownQueues = useKnownNames(conn.id).queues;

  const suggestions = useRabbitData<RkSuggestion[]>(async () => {
    if (conn.amqpOnly) {
      // The key routes to a queue (default exchange) — suggest tracked queues.
      // Bindings of a named exchange can't be enumerated over AMQP.
      if (isDefault) return knownQueues.map((name) => ({ key: name, hint: 'queue' }));
      return [];
    }
    if (isDefault) {
      const qs = await rabbitMgmt.listQueues(conn);
      return qs.map((q: QueueInfo) => ({ key: q.name, hint: 'queue' }));
    }
    const bs = await rabbitMgmt.exchangeBindings(conn, ex);
    // Distinct routing keys (drop empty keys, e.g. fanout/headers bindings).
    const seen = new Set<string>();
    const out: RkSuggestion[] = [];
    for (const b of bs as BindingInfo[]) {
      const k = b.routing_key;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, hint: `→ ${b.destination}` });
    }
    return out;
  }, [conn.id, ex, conn.amqpOnly, knownQueues.join(' ')]);

  const q = value.trim().toLowerCase();
  const all = suggestions.data ?? [];
  const matches = all
    .filter((s) => s.key.toLowerCase().includes(q))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 50);

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
        placeholder={isDefault ? 'queue name' : 'e.g. orders.created'}
        className="font-mono text-sm h-9"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md-premium max-h-64 overflow-y-auto py-1">
          {matches.map((s) => (
            <button
              key={s.key}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(s.key); }}
              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/60', value === s.key && 'text-primary')}
            >
              <span className="font-mono text-sm flex-1 truncate">{s.key}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 truncate max-w-[45%]">{s.hint}</span>
              {value === s.key && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Searchable exchange picker that also accepts a typed (custom) exchange name. */
function ExchangeCombobox({ value, exchanges, onChange }: {
  value: string; exchanges: ExchangeInfo[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = value.trim().toLowerCase();
  const matches = exchanges
    .filter((e) => e.name !== '' && e.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50);

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
        placeholder="(default exchange) — type to search"
        className="font-mono text-sm h-9"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md-premium max-h-64 overflow-y-auto py-1">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); pick(''); }}
            className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left hover:bg-muted/60', value === '' && 'text-primary')}
          >
            <span className="flex-1">(default exchange)</span>
            {value === '' && <Check className="h-3.5 w-3.5" />}
          </button>
          {matches.map((e) => (
            <button
              key={e.name}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(e.name); }}
              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/60', value === e.name && 'text-primary')}
            >
              <span className="font-mono text-sm flex-1 truncate">{e.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{e.type}</span>
              {value === e.name && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
          {q !== '' && matches.length === 0 && (
            <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
              No match — <span className="font-mono text-foreground">{value}</span> will be used as a custom exchange.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
