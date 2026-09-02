import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Stat } from '@/components/ui/stat';
import { SectionLabel } from '@/components/ui/section-label';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import {
  containerApi,
  type ContainerConnection, type DiskUsageSummary, type SystemDataUsageResponse, type SystemInfo,
} from './types';
import { PruneButton, type PruneVariant } from './PruneButton';
import { formatBytes } from './format';

export function OverviewView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  // Disk usage is a separate, much slower call than system info (the daemon
  // walks every image layer and container to compute it), so it loads on its
  // own and the stats above it render immediately.
  const [usage, setUsage] = useState<SystemDataUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    containerApi.systemInfo(connection)
      .then(setInfo)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));

    setUsageLoading(true);
    containerApi.systemDf(connection)
      .then(setUsage)
      .catch(() => setUsage(null))
      .finally(() => setUsageLoading(false));
  }, [connection]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const afterPrune = (message: string) => { setNotice(message); setError(null); load(); };
  const onPruneError = (message: string) => { setNotice(null); setError(message); };

  // Deliberately not a single "prune everything" button: each of these
  // destroys a different class of thing, and one of them (images -a) can cost
  // a long re-pull, so they stay separate and separately confirmed.
  const pruneVariants: PruneVariant[] = [
    {
      label: 'Prune stopped containers',
      description: 'Remove every container that is not running (docker container prune). Their writable layers and any data not on a volume are lost.',
      run: () => containerApi.prune(connection),
    },
    {
      label: 'Prune dangling images',
      description: 'Remove every untagged image layer left behind by rebuilds (docker image prune). Tagged images are kept.',
      run: () => containerApi.imagePrune(connection, true),
    },
    {
      label: 'Prune unused networks',
      description: 'Remove every user-defined network no container is attached to (docker network prune).',
      run: () => containerApi.networkPrune(connection),
    },
    {
      label: 'Prune unused volumes',
      danger: true,
      description: 'Remove every volume no container is using, and all data in them (docker volume prune). This cannot be undone.',
      run: () => containerApi.volumePrune(connection),
    },
  ];

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Gauge}
        title="Overview"
        subtitle={connection.name}
        actions={(
          <>
            <PruneButton noun="items" variants={pruneVariants} onDone={afterPrune} onError={onPruneError} />
            <Button variant="outline" size="sm" busy={loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />
      <div className="tool-scrollable px-5 py-4 space-y-5">
        {loading && !info && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {notice && !error && <Callout tone="info">{notice}</Callout>}
        {info && !error && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Containers" value={String(info.Containers ?? 0)} sub={`${info.ContainersRunning ?? 0} running`} />
            <Stat label="Images" value={String(info.Images ?? 0)} />
            <Stat label="CPUs" value={String(info.NCPU ?? 0)} />
            <Stat label="Memory" value={formatBytes(info.MemTotal)} />
            <Stat label="Server version" value={info.ServerVersion ?? '—'} />
            <Stat label="OS" value={info.OperatingSystem ?? '—'} />
            <Stat label="Architecture" value={info.Architecture ?? '—'} />
            <Stat label="Host name" value={info.Name ?? '—'} />
          </div>
        )}

        {(usage || usageLoading) && (
          <div className="space-y-2">
            <SectionLabel>Disk usage</SectionLabel>
            {usageLoading && !usage ? <LoadingRow /> : usage && (
              <DataTable density="compact">
                <Thead>
                  <Tr>
                    <Th>Type</Th>
                    <Th align="right">Active</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Size</Th>
                    <Th align="right">Reclaimable</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  <UsageRow label="Images" usage={usage.ImageUsage} />
                  <UsageRow label="Containers" usage={usage.ContainerUsage} />
                  <UsageRow label="Local volumes" usage={usage.VolumeUsage} />
                  <UsageRow label="Build cache" usage={usage.BuildCacheUsage} />
                </Tbody>
              </DataTable>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row of `docker system df`. The daemon reports `Reclaimable` as bytes;
 *  the share it represents is what tells you whether pruning is worth it, so
 *  it's shown alongside rather than left to be worked out. */
function UsageRow({ label, usage }: { label: string; usage?: DiskUsageSummary }) {
  const total = usage?.TotalSize ?? 0;
  const reclaimable = usage?.Reclaimable ?? 0;
  const share = total > 0 ? Math.round((reclaimable / total) * 100) : 0;
  return (
    <Tr>
      <Td>{label}</Td>
      <Td numeric>{usage?.ActiveCount ?? 0}</Td>
      <Td numeric>{usage?.TotalCount ?? 0}</Td>
      <Td numeric>{formatBytes(total)}</Td>
      <Td numeric>
        {reclaimable > 0 ? `${formatBytes(reclaimable)} (${share}%)` : '—'}
      </Td>
    </Tr>
  );
}
