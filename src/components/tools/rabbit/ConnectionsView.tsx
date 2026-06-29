import { Loader2, RefreshCw, AlertCircle, Plug, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import type { RabbitConnection, ConnectionRow, ChannelRow } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { formatBytes, formatNumber } from './format';

interface ConnectionsViewProps {
  conn: RabbitConnection;
  refreshKey: number;
  onRefresh: () => void;
}

type Tab = 'connections' | 'channels';

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 text-left font-medium text-muted-foreground', className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2 whitespace-nowrap', className)}>{children}</td>;
}

function StateBadge({ state }: { state?: string }) {
  return (
    <span className={cn(
      'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase',
      state === 'running' ? 'bg-emerald-500/15 text-emerald-500'
        : state === 'flow' ? 'bg-amber-500/15 text-amber-500'
        : 'bg-muted text-muted-foreground',
    )}>
      {state ?? '—'}
    </span>
  );
}

export function ConnectionsView({ conn, refreshKey, onRefresh }: ConnectionsViewProps) {
  const [tab, setTab] = usePersistentState<Tab>('devtool:rabbit:connTab', 'connections');
  const conns = useRabbitData<ConnectionRow[]>(() => rabbitMgmt.connections(conn), [conn.id, refreshKey]);
  const chans = useRabbitData<ChannelRow[]>(() => rabbitMgmt.channels(conn), [conn.id, refreshKey]);

  const active = tab === 'connections' ? conns : chans;

  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
        <Segmented<Tab>
          value={tab}
          onValueChange={setTab}
          size="sm"
          options={[
            { value: 'connections', label: `Connections${conns.data ? ` (${conns.data.length})` : ''}`, icon: Plug },
            { value: 'channels', label: `Channels${chans.data ? ` (${chans.data.length})` : ''}`, icon: Network },
          ]}
        />
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {active.loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {active.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-words">{active.error}</span>
          </div>
        )}

        {tab === 'connections' && conns.data && (
          conns.data.length === 0
            ? <p className="text-sm text-muted-foreground">No active connections.</p>
            : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      <Th>Name</Th><Th>User</Th><Th>State</Th><Th>Protocol</Th>
                      <Th>Channels</Th><Th>Peer</Th><Th>TLS</Th>
                      <Th className="text-right">From client</Th><Th className="text-right">To client</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {conns.data.map((c) => (
                      <tr key={c.name} className="hover:bg-muted/20">
                        <Td className="font-mono">{c.client_properties?.connection_name || c.name}</Td>
                        <Td>{c.user ?? '—'}</Td>
                        <Td><StateBadge state={c.state} /></Td>
                        <Td>{c.protocol ?? '—'}</Td>
                        <Td className="tabular-nums">{formatNumber(c.channels)}</Td>
                        <Td className="font-mono text-muted-foreground">{c.peer_host}:{c.peer_port}</Td>
                        <Td>{c.ssl ? 'Yes' : 'No'}</Td>
                        <Td className="text-right tabular-nums">{formatBytes(c.recv_oct)}</Td>
                        <Td className="text-right tabular-nums">{formatBytes(c.send_oct)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {tab === 'channels' && chans.data && (
          chans.data.length === 0
            ? <p className="text-sm text-muted-foreground">No active channels.</p>
            : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      <Th>Name</Th><Th>User</Th><Th>State</Th>
                      <Th className="text-right">Consumers</Th><Th className="text-right">Unacked</Th>
                      <Th className="text-right">Unconfirmed</Th><Th className="text-right">Prefetch</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {chans.data.map((c) => (
                      <tr key={c.name} className="hover:bg-muted/20">
                        <Td className="font-mono">{c.name}</Td>
                        <Td>{c.user ?? '—'}</Td>
                        <Td><StateBadge state={c.state} /></Td>
                        <Td className="text-right tabular-nums">{formatNumber(c.consumer_count)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(c.messages_unacknowledged)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(c.messages_unconfirmed)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(c.prefetch_count)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </div>
  );
}
