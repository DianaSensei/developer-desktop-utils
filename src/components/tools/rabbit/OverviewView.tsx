import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { SectionLabel } from '@/components/ui/section-label';
import { Stat } from '@/components/ui/stat';
import type { RabbitConnection, Overview, NodeInfo } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { formatBytes, formatNumber, formatRate, formatUptime } from './format';

interface OverviewViewProps {
  conn: RabbitConnection;
  refreshKey: number;
  onRefresh: () => void;
}

function NodeCard({ node }: { node: NodeInfo }) {
  const memPct = node.mem_used != null && node.mem_limit
    ? Math.min(100, Math.round((node.mem_used / node.mem_limit) * 100)) : null;
  return (
    <div className="rounded-lg border bg-card/40 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm truncate">{node.name}</span>
        <Badge tone={node.running ? 'success' : 'danger'} uppercase>
          {node.running ? 'Running' : 'Down'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-fg-mute">
        <span>Memory</span>
        <span className="text-right tabular-nums text-fg">
          {formatBytes(node.mem_used)}{memPct != null && ` (${memPct}%)`}
        </span>
        <span>Disk free</span>
        <span className="text-right tabular-nums text-fg">{formatBytes(node.disk_free)}</span>
        <span>File descriptors</span>
        <span className="text-right tabular-nums text-fg">
          {formatNumber(node.fd_used)} / {formatNumber(node.fd_total)}
        </span>
        <span>Sockets</span>
        <span className="text-right tabular-nums text-fg">
          {formatNumber(node.sockets_used)} / {formatNumber(node.sockets_total)}
        </span>
        <span>Uptime</span>
        <span className="text-right tabular-nums text-fg">{formatUptime(node.uptime)}</span>
      </div>
    </div>
  );
}

export function OverviewView({ conn, refreshKey, onRefresh }: OverviewViewProps) {
  const ov = useRabbitData<Overview>(() => rabbitMgmt.overview(conn), [conn.id, refreshKey]);
  const nodes = useRabbitData<NodeInfo[]>(() => rabbitMgmt.nodes(conn), [conn.id, refreshKey]);

  const o = ov.data;
  const stats = o?.message_stats;
  const totals = o?.object_totals;
  const qt = o?.queue_totals;

  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate">Overview</h2>
          <p className="text-[11px] text-fg-mute truncate">
            {o?.product_name ?? 'RabbitMQ'} {o?.rabbitmq_version ?? o?.product_version ?? ''}
            {o?.cluster_name ? ` · ${o.cluster_name}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="tool-scrollable px-5 py-4 space-y-5">
        {ov.loading && <LoadingRow />}
        {ov.error && <Callout tone="error">{ov.error}</Callout>}

        {o && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Ready" value={formatNumber(qt?.messages_ready)} />
              <Stat label="Unacked" value={formatNumber(qt?.messages_unacknowledged)} />
              <Stat label="Total messages" value={formatNumber(qt?.messages)} />
              <Stat label="Consumers" value={formatNumber(totals?.consumers)} />
            </div>

            <div>
              <SectionLabel as="h3" size="sm" className="mb-2">Message rates</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Publish" value={formatRate(stats?.publish_details?.rate)} sub={`${formatNumber(stats?.publish)} total`} />
                <Stat label="Deliver / get" value={formatRate(stats?.deliver_get_details?.rate)} sub={`${formatNumber(stats?.deliver_get)} total`} />
                <Stat label="Ack" value={formatRate(stats?.ack_details?.rate)} sub={`${formatNumber(stats?.ack)} total`} />
                <Stat label="Redeliver" value={formatRate(stats?.redeliver_details?.rate)} sub={`${formatNumber(stats?.redeliver)} total`} />
              </div>
            </div>

            <div>
              <SectionLabel as="h3" size="sm" className="mb-2">Totals</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Connections" value={formatNumber(totals?.connections)} />
                <Stat label="Channels" value={formatNumber(totals?.channels)} />
                <Stat label="Exchanges" value={formatNumber(totals?.exchanges)} />
                <Stat label="Queues" value={formatNumber(totals?.queues)} />
              </div>
            </div>

            {nodes.data && nodes.data.length > 0 && (
              <div>
                <SectionLabel as="h3" size="sm" className="mb-2">Nodes</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {nodes.data.map((n) => <NodeCard key={n.name} node={n} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
