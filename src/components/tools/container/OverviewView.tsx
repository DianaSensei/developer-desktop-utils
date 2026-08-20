import { useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Stat } from '@/components/ui/stat';
import { containerApi, type ContainerConnection, type SystemInfo } from './types';

function formatBytes(n?: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function OverviewView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    containerApi.systemInfo(connection)
      .then(setInfo)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [connection, refreshKey]);

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Gauge}
        title="Overview"
        subtitle={connection.name}
        actions={<Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>}
      />
      <div className="tool-scrollable px-5 py-4">
        {loading && !info && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
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
      </div>
    </div>
  );
}
