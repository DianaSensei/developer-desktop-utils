import { useState } from 'react';
import { RefreshCw, Send, Headphones, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Stat } from '@/components/ui/stat';
import { Field } from '@/components/ui/tool-section';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { usePersistentState } from '@/hooks/usePersistentState';
import type { RabbitConnection, QueueInfo, BindingInfo, QueueAmqpInfo } from './types';
import { rabbitApi } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { formatBytes, formatNumber, formatRate } from './format';

interface QueueViewProps {
  conn: RabbitConnection;
  queueName: string;
  refreshKey: number;
  onRefresh: () => void;
  onBack: () => void;
  onPublish: (exchange: string, routingKey: string) => void;
  onConsume: (queue: string) => void;
}

type Tab = 'overview' | 'bindings';

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}

export function QueueView({ conn, queueName, refreshKey, onRefresh, onBack, onPublish, onConsume }: QueueViewProps) {
  const [tab, setTab] = usePersistentState<Tab>('devtool:rabbit:queueTab', 'overview');
  // Tolerate stale values ('publish', 'messages', 'consume') persisted before those tabs were removed.
  const activeTab: Tab = tab === 'overview' || tab === 'bindings' ? tab : 'overview';

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Inbox}
        onBack={onBack}
        title={<span className="font-mono">{queueName}</span>}
        subtitle={`Queue · vhost ${conn.vhost}`}
        actions={(
          <>
            {/* Publish opens the Send/Request panel pre-targeted at this queue. */}
            <Button variant="outline" size="sm" onClick={() => onPublish('', queueName)}>
              <Send className="h-3.5 w-3.5 mr-1.5" /> Publish
            </Button>
            {/* Consume opens the Consumers panel pre-targeted at this queue. */}
            <Button variant="outline" size="sm" onClick={() => onConsume(queueName)}>
              <Headphones className="h-3.5 w-3.5 mr-1.5" /> Consume
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <Segmented<Tab>
          value={activeTab}
          onValueChange={setTab}
          size="sm"
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'bindings', label: 'Bindings' },
          ]}
        />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {activeTab === 'overview' && (
          conn.amqpOnly
            ? <AmqpOverviewTab conn={conn} queueName={queueName} refreshKey={refreshKey} />
            : <MgmtOverviewTab conn={conn} queueName={queueName} refreshKey={refreshKey} />
        )}
        {activeTab === 'bindings' && <BindingsTab conn={conn} queueName={queueName} refreshKey={refreshKey} />}
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function MgmtOverviewTab({ conn, queueName, refreshKey }: { conn: RabbitConnection; queueName: string; refreshKey: number }) {
  const { data: q, loading, error } = useRabbitData<QueueInfo>(() => rabbitMgmt.queue(conn, queueName), [conn.id, queueName, refreshKey]);
  if (loading) return <LoadingRow />;
  if (error) return <Callout tone="error">{error}</Callout>;
  if (!q) return null;

  const s = q.message_stats;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Ready" value={formatNumber(q.messages_ready)} />
        <Stat label="Unacked" value={formatNumber(q.messages_unacknowledged)} />
        <Stat label="Total" value={formatNumber(q.messages)} />
        <Stat label="Consumers" value={formatNumber(q.consumers)} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs rounded-lg border bg-card/40 px-4 py-3">
        <KV label="State" value={q.state ?? '—'} />
        <KV label="Node" value={<span className="font-mono">{q.node ?? '—'}</span>} />
        <KV label="Durable" value={q.durable ? 'Yes' : 'No'} />
        <KV label="Auto-delete" value={q.auto_delete ? 'Yes' : 'No'} />
        <KV label="Exclusive" value={q.exclusive ? 'Yes' : 'No'} />
        <KV label="Memory" value={formatBytes(q.memory)} />
        <KV label="Incoming rate" value={formatRate(s?.publish_details?.rate)} />
        <KV label="Deliver rate" value={formatRate(s?.deliver_get_details?.rate)} />
      </dl>
    </div>
  );
}

/** AMQP-only overview: a passive declare gives existence + ready/consumer counts only. */
function AmqpOverviewTab({ conn, queueName, refreshKey }: { conn: RabbitConnection; queueName: string; refreshKey: number }) {
  const { data, loading, error } = useRabbitData<QueueAmqpInfo[]>(() => rabbitApi.amqpQueuesInfo(conn.id, [queueName]), [conn.id, queueName, refreshKey]);
  if (loading) return <LoadingRow />;
  if (error) return <Callout tone="error">{error}</Callout>;
  const i = data?.[0];
  if (!i) return null;

  if (!i.exists) {
    return (
      <div className="space-y-3">
        {i.error
          ? <Callout tone="error">{i.error}</Callout>
          : <Callout tone="warning">Queue <span className="font-mono">{queueName}</span> does not exist on the broker.</Callout>}
        <p className="text-[11px] text-muted-foreground">Use New queue to declare it, or Publish/Consume to work with it once it exists.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Ready" value={formatNumber(i.messages ?? 0)} />
        <Stat label="Consumers" value={formatNumber(i.consumers ?? 0)} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        AMQP-only mode: counts come from a passive declare. Unacked totals, rates, node and memory require the management API and aren't shown.
      </p>
    </div>
  );
}

// ── Bindings tab ──────────────────────────────────────────────────────────────

function BindingsTab({ conn, queueName, refreshKey }: { conn: RabbitConnection; queueName: string; refreshKey: number }) {
  if (conn.amqpOnly) return <AmqpBindingsTab conn={conn} queueName={queueName} />;
  return <MgmtBindingsTab conn={conn} queueName={queueName} refreshKey={refreshKey} />;
}

/** AMQP-only: bindings can't be listed; only created. */
function AmqpBindingsTab({ conn, queueName }: { conn: RabbitConnection; queueName: string }) {
  return (
    <div className="space-y-3">
      <NewBindingForm
        sourceLabel="From exchange"
        sourcePlaceholder="my.exchange"
        onBind={async (source, key) => { await rabbitApi.amqpBindQueue(conn.id, queueName, source, key); }}
      />
      <p className="text-[11px] text-muted-foreground">
        AMQP can't list existing bindings — you can create one above, but they aren't enumerable without the management API.
      </p>
    </div>
  );
}

function MgmtBindingsTab({ conn, queueName, refreshKey }: { conn: RabbitConnection; queueName: string; refreshKey: number }) {
  const b = useRabbitData<BindingInfo[]>(() => rabbitMgmt.queueBindings(conn, queueName), [conn.id, queueName, refreshKey]);
  return (
    <div className="space-y-4">
      <NewBindingForm
        sourceLabel="From exchange"
        sourcePlaceholder="my.exchange"
        onBind={async (source, key) => { await rabbitMgmt.createBinding(conn, source, 'q', queueName, key); b.reload(); }}
      />
      {b.loading ? <LoadingRow />
        : b.error ? <Callout tone="error">{b.error}</Callout>
        : !b.data || b.data.length === 0 ? <p className="text-sm text-muted-foreground">No bindings.</p>
        : (
          <DataTable>
            <Thead>
              <Tr>
                <Th>Source exchange</Th>
                <Th>Routing key</Th>
              </Tr>
            </Thead>
            <Tbody>
              {b.data.map((x, i) => (
                <Tr key={i} className="hover:bg-muted/40">
                  <Td mono>{x.source || '(default)'}</Td>
                  <Td mono>{x.routing_key || '—'}</Td>
                </Tr>
              ))}
            </Tbody>
          </DataTable>
        )}
    </div>
  );
}

/** Inline "create binding" form shared by the queue and exchange bindings tabs. */
export function NewBindingForm({ sourceLabel, sourcePlaceholder, onBind }: {
  sourceLabel: string; sourcePlaceholder: string;
  onBind: (source: string, routingKey: string) => Promise<void>;
}) {
  const [source, setSource] = useState('');
  const [routingKey, setRoutingKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bind = async () => {
    if (!source.trim()) { setError(`${sourceLabel} is required`); return; }
    setBusy(true);
    setError(null);
    try {
      await onBind(source.trim(), routingKey);
      setSource('');
      setRoutingKey('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-end gap-2">
        <Field label={sourceLabel} className="flex-1">
          <Input value={source} onChange={(e) => { setSource(e.target.value); setError(null); }} placeholder={sourcePlaceholder} className="font-mono text-xs h-ctl" />
        </Field>
        <Field label="Routing key" className="flex-1">
          <Input value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} placeholder="(optional)" className="font-mono text-xs h-ctl" />
        </Field>
        <Button size="sm" onClick={bind} disabled={busy}>{busy ? 'Binding…' : 'Bind'}</Button>
      </div>
      {error && <Callout tone="error" size="sm">{error}</Callout>}
    </div>
  );
}

