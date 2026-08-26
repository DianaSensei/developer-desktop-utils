import { useEffect, useRef, useState } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { containerApi, type ContainerConnection, type ContainerDetails, type ContainerResources, type ContainerSummary, type StatsFrame } from './types';
import { DetailField, DetailGrid, KeyValueTable, envEntries, labelEntries } from './DetailRows';
import { formatBytes } from './format';

function stateTone(state?: string): BadgeTone {
  switch (state) {
    case 'running': return 'success';
    case 'paused': return 'warning';
    case 'exited':
    case 'dead': return 'danger';
    default: return 'neutral';
  }
}

function healthTone(status?: string): BadgeTone {
  switch (status) {
    case 'healthy': return 'success';
    case 'unhealthy': return 'danger';
    case 'starting': return 'warning';
    default: return 'neutral';
  }
}

export function ContainerDetailsDialog({ open, onOpenChange, connection, container, onEditLimits }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  container: ContainerSummary | null;
  /** Opens the resource editor for this container — the dialog only renders
   *  the "Edit limits" button when the parent view can handle it. */
  onEditLimits?: (container: ContainerSummary) => void;
}) {
  const [details, setDetails] = useState<ContainerDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !container) { setDetails(null); return; }
    setLoading(true);
    setError(null);
    containerApi.details(connection, container.Id)
      .then(setDetails)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, container, connection]);

  const title = details?.name || container?.Names?.[0]?.replace(/^\//, '') || container?.Id.slice(0, 12) || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
          {loading && <LoadingRow />}
          {error && <Callout tone="error">{error}</Callout>}
          {details && !loading && (
            <>
              <DetailGrid>
                <DetailField label="Status" value={(
                  <span className="flex items-center gap-1.5">
                    <Badge tone={stateTone(details.status)}>{details.status ?? 'unknown'}</Badge>
                    {details.healthStatus && details.healthStatus !== 'none' && (
                      <Badge tone={healthTone(details.healthStatus)}>{details.healthStatus}</Badge>
                    )}
                  </span>
                )} />
                <DetailField label="Container ID" value={details.id.slice(0, 20)} mono copy={details.id} />
                <DetailField label="Image" value={details.image.replace('sha256:', '').slice(0, 20)} mono copy={details.image} />
                <DetailField label="Platform" value={details.platform || '—'} />
                <DetailField label="Created" value={details.created ? new Date(details.created).toLocaleString() : '—'} />
                {details.running ? (
                  <DetailField label="Started" value={details.startedAt ? new Date(details.startedAt).toLocaleString() : '—'} />
                ) : (
                  <>
                    <DetailField label="Finished" value={details.finishedAt ? new Date(details.finishedAt).toLocaleString() : '—'} />
                    <DetailField label="Exit code" value={details.exitCode ?? '—'} />
                  </>
                )}
                <DetailField
                  label="Restart policy"
                  value={details.restartPolicy ? (
                    details.restartPolicy === 'on-failure' && details.restartMaxRetry
                      ? `${details.restartPolicy} (max ${details.restartMaxRetry})`
                      : details.restartPolicy
                  ) : 'no'}
                />
              </DetailGrid>

              {(details.entrypoint.length > 0 || details.command) && (
                <DetailGrid>
                  {details.entrypoint.length > 0 && (
                    <DetailField className="col-span-full" label="Entrypoint" value={details.entrypoint.join(' ')} mono copy={details.entrypoint.join(' ')} />
                  )}
                  {details.command && (
                    <DetailField className="col-span-full" label="Command" value={details.command} mono copy={details.command} />
                  )}
                </DetailGrid>
              )}

              {details.running && (
                <CollapsibleSection title="Live usage" variant="bordered" defaultOpen hint="streaming">
                  <LiveStats connection={connection} containerId={details.id} />
                </CollapsibleSection>
              )}

              <CollapsibleSection
                title="Resource limits"
                variant="bordered"
                defaultOpen
                hint={describeLimits(details.resources)}
              >
                <div className="space-y-3">
                  <DetailGrid>
                    <DetailField label="CPU limit" value={details.resources.nanoCpus ? `${Number((details.resources.nanoCpus / 1_000_000_000).toFixed(3))} cores` : 'unlimited'} />
                    <DetailField label="CPU shares" value={details.resources.cpuShares || 'default (1024)'} />
                    <DetailField label="CPU set" value={details.resources.cpusetCpus || 'all cores'} mono />
                    <DetailField label="Memory limit" value={details.resources.memoryBytes ? formatBytes(details.resources.memoryBytes) : 'unlimited'} />
                    <DetailField label="Memory reservation" value={details.resources.memoryReservationBytes ? formatBytes(details.resources.memoryReservationBytes) : '—'} />
                    <DetailField
                      label="Memory + swap"
                      value={details.resources.memorySwapBytes === -1
                        ? 'unlimited swap'
                        : details.resources.memorySwapBytes ? formatBytes(details.resources.memorySwapBytes) : '—'}
                    />
                    <DetailField label="PIDs limit" value={details.resources.pidsLimit && details.resources.pidsLimit > 0 ? details.resources.pidsLimit : 'unlimited'} />
                    <DetailField label="Block IO weight" value={details.resources.blkioWeight || 'default'} />
                  </DetailGrid>
                  {onEditLimits && container && (
                    <Button variant="outline" size="sm" onClick={() => onEditLimits(container)}>
                      <Cpu className="h-3.5 w-3.5 mr-1.5" /> Edit limits
                    </Button>
                  )}
                </div>
              </CollapsibleSection>

              {details.ports.length > 0 && (
                <CollapsibleSection title="Ports" variant="bordered" defaultOpen hint={`${details.ports.length}`}>
                  <DataTable density="compact">
                    <Thead><Tr><Th>Container</Th><Th>Host</Th></Tr></Thead>
                    <Tbody>
                      {details.ports.map((p, i) => (
                        <Tr key={`${p.containerPort}-${i}`}>
                          <Td mono>{p.containerPort}</Td>
                          <Td mono>{p.hostIp && p.hostPort ? `${p.hostIp}:${p.hostPort}` : p.hostPort || '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                </CollapsibleSection>
              )}

              {details.networks.length > 0 && (
                <CollapsibleSection title="Networks" variant="bordered" defaultOpen hint={`${details.networks.length}`}>
                  <DataTable density="compact">
                    <Thead><Tr><Th>Name</Th><Th>IP address</Th><Th>Gateway</Th><Th>MAC</Th></Tr></Thead>
                    <Tbody>
                      {details.networks.map((n) => (
                        <Tr key={n.name}>
                          <Td mono>{n.name}</Td>
                          <Td mono>{n.ipAddress || '—'}</Td>
                          <Td mono>{n.gateway || '—'}</Td>
                          <Td mono>{n.macAddress || '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                </CollapsibleSection>
              )}

              {details.mounts.length > 0 && (
                <CollapsibleSection title="Mounts" variant="bordered" defaultOpen={false} hint={`${details.mounts.length}`}>
                  <DataTable density="compact">
                    <Thead><Tr><Th>Type</Th><Th>Source</Th><Th>Destination</Th><Th>Mode</Th></Tr></Thead>
                    <Tbody>
                      {details.mounts.map((m, i) => (
                        <Tr key={i}>
                          <Td>{m.type || '—'}</Td>
                          <Td mono className="break-all">{m.name || m.source || '—'}</Td>
                          <Td mono className="break-all">{m.destination || '—'}</Td>
                          <Td mono>{m.rw === false ? 'ro' : m.mode || 'rw'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                </CollapsibleSection>
              )}

              <CollapsibleSection title="Environment" variant="bordered" defaultOpen={false} hint={`${details.env.length}`}>
                <KeyValueTable entries={envEntries(details.env)} />
              </CollapsibleSection>

              <CollapsibleSection title="Labels" variant="bordered" defaultOpen={false} hint={`${Object.keys(details.labels).length}`}>
                <KeyValueTable entries={labelEntries(details.labels)} />
              </CollapsibleSection>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One-line summary of what is actually capped, for the section header. */
function describeLimits(r: ContainerResources): string {
  const parts: string[] = [];
  if (r.nanoCpus) parts.push(`${Number((r.nanoCpus / 1_000_000_000).toFixed(3))} CPU`);
  if (r.memoryBytes) parts.push(formatBytes(r.memoryBytes));
  return parts.length > 0 ? parts.join(' · ') : 'unlimited';
}

/** Live CPU / memory / network for a running container, over the streaming
 *  stats endpoint (one open stream for the one container on screen — the
 *  table's columns use the cheaper polled snapshot instead). */
function LiveStats({ connection, containerId }: { connection: ContainerConnection; containerId: string }) {
  const [frame, setFrame] = useState<StatsFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const channel = new Channel<StatsFrame>();
    channel.onmessage = (f) => { if (!cancelled) setFrame(f); };
    containerApi.statsStart(connection, containerId, channel)
      .then((id) => {
        // Unmounted while the stream was starting — stop it right away rather
        // than leaving an orphaned task running against the daemon.
        if (cancelled) { void containerApi.statsStop(id); return; }
        streamIdRef.current = id;
      })
      .catch((e) => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); });
    return () => {
      cancelled = true;
      const id = streamIdRef.current;
      streamIdRef.current = null;
      if (id) void containerApi.statsStop(id);
    };
  }, [connection, containerId]);

  if (error) return <Callout tone="error" size="sm">{error}</Callout>;
  if (!frame) return <p className="text-xs text-fg-mute">Waiting for the first sample…</p>;

  const memPct = frame.memLimitBytes > 0 ? (frame.memUsageBytes / frame.memLimitBytes) * 100 : 0;
  return (
    <DetailGrid>
      <DetailField label="CPU" value={`${frame.cpuPercent.toFixed(1)}%`} mono />
      <DetailField
        label="Memory"
        value={`${formatBytes(frame.memUsageBytes)}${frame.memLimitBytes > 0 ? ` / ${formatBytes(frame.memLimitBytes)} (${memPct.toFixed(0)}%)` : ''}`}
        mono
      />
      <DetailField label="Network RX / TX" value={`${formatBytes(frame.netRxBytes)} / ${formatBytes(frame.netTxBytes)}`} mono />
    </DetailGrid>
  );
}
