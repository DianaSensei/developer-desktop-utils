import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { SectionLabel } from '@/components/ui/section-label';
import { Stat, StatGrid } from '@/components/ui/stat';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import type { RedisConnection } from './types';
import { redisApi, type RedisOverview } from './types';
import { useRedisData } from './useRedisData';
import { parseInfo, formatUptime, formatNumber, hitRate } from './format';

interface OverviewViewProps {
  conn: RedisConnection;
  db: number;
  refreshKey: number;
  onRefresh: () => void;
}

export function OverviewView({ conn, db, refreshKey, onRefresh }: OverviewViewProps) {
  const ov = useRedisData<RedisOverview>(() => redisApi.overview(conn.id, db), [conn.id, db, refreshKey]);
  const sections = ov.data ? parseInfo(ov.data.info) : {};
  const server = sections.Server ?? {};
  const clients = sections.Clients ?? {};
  const memory = sections.Memory ?? {};
  const stats = sections.Stats ?? {};
  const replication = sections.Replication ?? {};

  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate">Overview</h2>
          <p className="text-[11px] text-fg-mute truncate">
            Redis {server.redis_version ?? ''} · {replication.role ?? 'standalone'} · db{db}
          </p>
        </div>
        <Button variant="outline" size="sm" busy={ov.loading} onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="tool-scrollable px-5 py-4 space-y-5">
        {ov.loading && !ov.data && <LoadingRow />}
        {ov.error && <Callout tone="error">{ov.error}</Callout>}

        {ov.data && (
          <>
            <StatGrid columns={4}>
              <Stat label="Keys (this db)" value={formatNumber(ov.data.dbsize)} />
              <Stat label="Connected clients" value={formatNumber(clients.connected_clients)} />
              <Stat label="Used memory" value={memory.used_memory_human ?? '—'} />
              <Stat label="Uptime" value={formatUptime(server.uptime_in_seconds)} />
            </StatGrid>

            <div>
              <SectionLabel as="h3" size="sm" className="mb-2">Throughput</SectionLabel>
              <StatGrid columns={4}>
                <Stat label="Ops / sec" value={formatNumber(stats.instantaneous_ops_per_sec)} />
                <Stat label="Hit rate" value={hitRate(stats.keyspace_hits, stats.keyspace_misses)} />
                <Stat label="Total commands" value={formatNumber(stats.total_commands_processed)} />
                <Stat label="Total connections" value={formatNumber(stats.total_connections_received)} />
              </StatGrid>
            </div>

            <div>
              <SectionLabel as="h3" size="sm" className="mb-2">Server</SectionLabel>
              <StatGrid columns={4}>
                <Stat label="Mode" value={server.redis_mode ?? '—'} />
                <Stat label="Role" value={replication.role ?? '—'} />
                <Stat label="Replicas" value={formatNumber(replication.connected_slaves)} />
                <Stat label="Process ID" value={server.process_id ?? '—'} mono />
              </StatGrid>
            </div>

            <div className="divide-y divide-line/40 rounded-lg border border-line/50">
              {Object.entries(sections).map(([name, kv]) => (
                <CollapsibleSection key={name} title={name} defaultOpen={false} headerClassName="px-3" bodyClassName="px-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 gap-y-1 text-xs">
                    {Object.entries(kv).map(([k, v]) => (
                      <div key={k} className="contents">
                        <span className="text-fg-mute font-mono truncate">{k}</span>
                        <span className="font-mono truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
