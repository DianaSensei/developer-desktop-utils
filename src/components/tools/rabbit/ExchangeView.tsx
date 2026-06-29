import {
  Loader2, RefreshCw, AlertCircle, Send, Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { ViewHeader } from '@/components/ui/view-header';
import { usePersistentState } from '@/hooks/usePersistentState';
import type { RabbitConnection, ExchangeInfo, BindingInfo, ExchangeAmqpInfo } from './types';
import { rabbitApi } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { NewBindingForm } from './QueueView';
import { formatRate } from './format';

interface ExchangeViewProps {
  conn: RabbitConnection;
  exchangeName: string;
  refreshKey: number;
  onRefresh: () => void;
  onBack: () => void;
  onPublish: (exchange: string, routingKey: string) => void;
}

type Tab = 'overview' | 'bindings';

export function ExchangeView({ conn, exchangeName, refreshKey, onRefresh, onBack, onPublish }: ExchangeViewProps) {
  const [tab, setTab] = usePersistentState<Tab>('devtool:rabbit:exchangeTab', 'overview');
  // Tolerate stale persisted values (e.g. a removed 'publish' tab).
  const activeTab: Tab = tab === 'overview' || tab === 'bindings' ? tab : 'overview';
  const isDefault = exchangeName === '';

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Radio}
        onBack={onBack}
        title={<span className="font-mono">{isDefault ? '(AMQP default)' : exchangeName}</span>}
        subtitle={`Exchange · vhost ${conn.vhost}`}
        actions={(
          <>
            {/* Publish opens the Send/Request panel pre-targeted at this exchange. */}
            <Button variant="outline" size="sm" onClick={() => onPublish(exchangeName, '')}>
              <Send className="h-3.5 w-3.5 mr-1.5" /> Publish
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
            ? <AmqpOverviewTab conn={conn} exchangeName={exchangeName} refreshKey={refreshKey} />
            : <MgmtOverviewTab conn={conn} exchangeName={exchangeName} refreshKey={refreshKey} />
        )}
        {activeTab === 'bindings' && <BindingsTab conn={conn} exchangeName={exchangeName} refreshKey={refreshKey} />}
      </div>
    </div>
  );
}

function MgmtOverviewTab({ conn, exchangeName, refreshKey }: { conn: RabbitConnection; exchangeName: string; refreshKey: number }) {
  const { data: ex, loading, error } = useRabbitData<ExchangeInfo>(() => rabbitMgmt.exchange(conn, exchangeName), [conn.id, exchangeName, refreshKey]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!ex) return null;
  const s = ex.message_stats;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs rounded-lg border bg-card/40 px-4 py-3">
        <dt className="text-muted-foreground">Type</dt><dd className="text-right">{ex.type ?? '—'}</dd>
        <dt className="text-muted-foreground">Durable</dt><dd className="text-right">{ex.durable ? 'Yes' : 'No'}</dd>
        <dt className="text-muted-foreground">Auto-delete</dt><dd className="text-right">{ex.auto_delete ? 'Yes' : 'No'}</dd>
        <dt className="text-muted-foreground">Internal</dt><dd className="text-right">{ex.internal ? 'Yes' : 'No'}</dd>
        <dt className="text-muted-foreground">Publish rate</dt><dd className="text-right tabular-nums">{formatRate(s?.publish_details?.rate)}</dd>
      </dl>
    </div>
  );
}

/** AMQP-only overview: a passive declare can only confirm existence. */
function AmqpOverviewTab({ conn, exchangeName, refreshKey }: { conn: RabbitConnection; exchangeName: string; refreshKey: number }) {
  const { data, loading, error } = useRabbitData<ExchangeAmqpInfo[]>(() => rabbitApi.amqpExchangesInfo(conn.id, [exchangeName]), [conn.id, exchangeName, refreshKey]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const i = data?.[0];
  if (!i) return null;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs rounded-lg border bg-card/40 px-4 py-3">
        <dt className="text-muted-foreground">Exists</dt>
        <dd className="text-right">
          {i.exists ? <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
            : i.error ? <span className="text-destructive">Error</span>
            : <span className="text-amber-600 dark:text-amber-400">No</span>}
        </dd>
      </dl>
      {i.error && <ErrorBox message={i.error} />}
      <p className="text-[11px] text-muted-foreground">
        AMQP-only mode: type, durability and bindings require the management API and aren't queryable over AMQP. Use New exchange to declare one.
      </p>
    </div>
  );
}

function BindingsTab({ conn, exchangeName, refreshKey }: { conn: RabbitConnection; exchangeName: string; refreshKey: number }) {
  const isDefault = exchangeName === '';
  if (conn.amqpOnly) {
    return (
      <div className="space-y-3">
        {!isDefault && (
          <NewBindingForm
            sourceLabel="To queue"
            sourcePlaceholder="my.queue"
            onBind={async (dest, key) => { await rabbitApi.amqpBindQueue(conn.id, dest, exchangeName, key); }}
          />
        )}
        <p className="text-[11px] text-muted-foreground">
          AMQP can't list bindings — you can create one above, but they aren't enumerable without the management API.
        </p>
      </div>
    );
  }
  return <MgmtBindingsTab conn={conn} exchangeName={exchangeName} refreshKey={refreshKey} />;
}

function MgmtBindingsTab({ conn, exchangeName, refreshKey }: { conn: RabbitConnection; exchangeName: string; refreshKey: number }) {
  const b = useRabbitData<BindingInfo[]>(() => rabbitMgmt.exchangeBindings(conn, exchangeName), [conn.id, exchangeName, refreshKey]);
  const isDefault = exchangeName === '';
  return (
    <div className="space-y-4">
      {!isDefault && (
        <NewBindingForm
          sourceLabel="To queue"
          sourcePlaceholder="my.queue"
          onBind={async (dest, key) => { await rabbitMgmt.createBinding(conn, exchangeName, 'q', dest, key); b.reload(); }}
        />
      )}
      {b.loading ? <Loading />
        : b.error ? <ErrorBox message={b.error} />
        : !b.data || b.data.length === 0 ? <p className="text-sm text-muted-foreground">No bindings from this exchange.</p>
        : (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-xs">
              <thead className="bg-muted/20 border-b border-border/50">
                <tr>
                  <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Destination</th>
                  <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Routing key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {b.data.map((x, i) => (
                  <tr key={i} className="hover:bg-muted/40 transition-colors">
                    <td className="px-3.5 py-2.5 font-mono">{x.destination}</td>
                    <td className="px-3.5 py-2.5">{x.destination_type}</td>
                    <td className="px-3.5 py-2.5 font-mono">{x.routing_key || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}
