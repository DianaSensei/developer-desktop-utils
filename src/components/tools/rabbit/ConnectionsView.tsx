import { RefreshCw, Plug, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { usePersistentState } from '@/hooks/usePersistentState';
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

const STATE_TONE: Record<string, BadgeTone> = { running: 'success', flow: 'warning' };

function StateBadge({ state }: { state?: string }) {
  return <Badge tone={STATE_TONE[state ?? ''] ?? 'neutral'} uppercase>{state ?? '—'}</Badge>;
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
        {active.loading && <LoadingRow />}
        {active.error && <Callout tone="error">{active.error}</Callout>}

        {tab === 'connections' && conns.data && (
          conns.data.length === 0
            ? <p className="text-sm text-fg-mute">No active connections.</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th>Name</Th><Th>User</Th><Th>State</Th><Th>Protocol</Th>
                    <Th>Channels</Th><Th>Peer</Th><Th>TLS</Th>
                    <Th align="right">From client</Th><Th align="right">To client</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {conns.data.map((c) => (
                    <Tr key={c.name}>
                      <Td mono className="whitespace-nowrap">{c.client_properties?.connection_name || c.name}</Td>
                      <Td className="whitespace-nowrap">{c.user ?? '—'}</Td>
                      <Td><StateBadge state={c.state} /></Td>
                      <Td className="whitespace-nowrap">{c.protocol ?? '—'}</Td>
                      <Td className="tabular-nums">{formatNumber(c.channels)}</Td>
                      <Td mono className="whitespace-nowrap text-fg-mute">{c.peer_host}:{c.peer_port}</Td>
                      <Td>{c.ssl ? 'Yes' : 'No'}</Td>
                      <Td numeric>{formatBytes(c.recv_oct)}</Td>
                      <Td numeric>{formatBytes(c.send_oct)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}

        {tab === 'channels' && chans.data && (
          chans.data.length === 0
            ? <p className="text-sm text-fg-mute">No active channels.</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th>Name</Th><Th>User</Th><Th>State</Th>
                    <Th align="right">Consumers</Th><Th align="right">Unacked</Th>
                    <Th align="right">Unconfirmed</Th><Th align="right">Prefetch</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {chans.data.map((c) => (
                    <Tr key={c.name}>
                      <Td mono className="whitespace-nowrap">{c.name}</Td>
                      <Td className="whitespace-nowrap">{c.user ?? '—'}</Td>
                      <Td><StateBadge state={c.state} /></Td>
                      <Td numeric>{formatNumber(c.consumer_count)}</Td>
                      <Td numeric>{formatNumber(c.messages_unacknowledged)}</Td>
                      <Td numeric>{formatNumber(c.messages_unconfirmed)}</Td>
                      <Td numeric>{formatNumber(c.prefetch_count)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>
    </div>
  );
}
