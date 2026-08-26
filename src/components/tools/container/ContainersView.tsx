import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, RefreshCw, MoreHorizontal, Play, Square, RotateCw, Trash2, Pause, PlayCircle, Info, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';
import { containerApi, type ContainerConnection, type ContainerSummary, type StatsFrame } from './types';
import { LogsPanel } from './LogsPanel';
import { useSort } from './useSort';
import { useRowSelection } from './useRowSelection';
import { RowCheckbox, SelectionBar } from './SelectionBar';
import { PruneButton } from './PruneButton';
import { ContainerDetailsDialog } from './ContainerDetailsDialog';
import { ContainerResourcesDialog } from './ContainerResourcesDialog';
import { formatBytes } from './format';

/** How often the live CPU/memory columns re-sample. Each tick is one
 *  `container_stats_snapshot` call covering every running container, and the
 *  daemon needs ~1s per sample internally, so anything faster would just
 *  overlap itself. */
const STATS_POLL_MS = 5000;

function stateTone(state?: string): BadgeTone {
  switch (state) {
    case 'running': return 'success';
    case 'paused': return 'warning';
    case 'exited':
    case 'dead': return 'danger';
    default: return 'neutral';
  }
}

function containerName(c: ContainerSummary): string {
  return c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
}

function formatPorts(c: ContainerSummary): string {
  if (!c.Ports || c.Ports.length === 0) return '—';
  return c.Ports
    .filter((p) => p.PublicPort)
    .map((p) => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`)
    .join(', ') || '—';
}

export function ContainersView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(true);
  const [liveStats, setLiveStats] = useState(false);
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [logsTarget, setLogsTarget] = useState<ContainerSummary | null>(null);
  // Kept one render behind `logsTarget`: the Dialog itself stays mounted and
  // driven by `open={!!logsTarget}` so Radix can play the exit animation
  // (matching ContainerDetailsDialog below) instead of the whole subtree
  // vanishing instantly when `logsTarget` goes back to null — this is what
  // used to make the logs dialog feel inconsistent/laggy next to Details.
  const [logsDialogTarget, setLogsDialogTarget] = useState<ContainerSummary | null>(null);
  useEffect(() => { if (logsTarget) setLogsDialogTarget(logsTarget); }, [logsTarget]);
  const [detailsTarget, setDetailsTarget] = useState<ContainerSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContainerSummary | null>(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  // Single-container edit; the bulk edit reuses the same dialog with every
  // selected container as its target.
  const [limitsTarget, setLimitsTarget] = useState<ContainerSummary | null>(null);
  const [bulkLimitsOpen, setBulkLimitsOpen] = useState(false);
  const [stats, setStats] = useState<Record<string, StatsFrame>>({});
  /** Result line from the last prune — informational, not an error. */
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    containerApi.list(connection, showAll)
      .then((cs) => setContainers(cs))
      .catch((e) => { setContainers([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  }, [connection, showAll]);

  const f = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (containers ?? []).filter((c) => containerName(c).toLowerCase().includes(f) || (c.Image ?? '').toLowerCase().includes(f)),
    [containers, f],
  );
  const { sorted: rows, toggleSort, directionFor } = useSort(filtered, {
    name: (c) => containerName(c),
    image: (c) => c.Image ?? '',
    state: (c) => c.State ?? '',
    status: (c) => c.Status ?? '',
    ports: (c) => formatPorts(c),
    cpu: (c) => stats[c.Id]?.cpuPercent ?? -1,
    mem: (c) => stats[c.Id]?.memUsageBytes ?? -1,
  });

  const selection = useRowSelection(rows, useCallback((c: ContainerSummary) => c.Id, []));
  const { prune, clear } = selection;

  useEffect(() => { load(); clear(); }, [load, refreshKey, clear]);
  useEffect(() => { if (containers) prune(containers.map((c) => c.Id)); }, [containers, prune]);

  // Live usage sampling. `runningIds` is recomputed from the list rather than
  // captured, so containers stopped/started between ticks drop in and out on
  // their own; a tick that overlaps the previous one is skipped instead of
  // queueing up more work against the daemon.
  const runningIds = useMemo(
    () => (containers ?? []).filter((c) => c.State === 'running').map((c) => c.Id),
    [containers],
  );
  const runningKey = runningIds.join(',');
  const inFlight = useRef(false);

  useEffect(() => {
    if (!liveStats) { setStats({}); return; }
    if (runningIds.length === 0) { setStats({}); return; }
    let cancelled = false;
    const sample = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const frames = await containerApi.statsSnapshot(connection, runningIds);
        if (!cancelled) setStats(frames);
      } catch {
        // A failed sample just leaves the previous numbers on screen — the
        // list itself is still valid, so this isn't worth an error banner.
      } finally {
        inFlight.current = false;
      }
    };
    sample();
    const timer = window.setInterval(sample, STATS_POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [liveStats, connection, runningKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyIds((s) => new Set(s).add(id));
    setError(null);
    try {
      await action();
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const runBulk = async (ids: string[], action: (id: string) => Promise<void>) => {
    setBusyIds((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n; });
    setError(null);
    const results = await Promise.allSettled(ids.map(action));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const first = failed[0].reason;
      setError(`${failed.length} of ${ids.length} failed — ${String(first instanceof Error ? first.message : first)}`);
    }
    setBusyIds((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    load();
  };

  const selectedContainers = useMemo(
    () => (containers ?? []).filter((c) => selection.isSelected(c.Id)),
    [containers, selection],
  );

  return (
    // `relative` anchors the floating SelectionBar (see SelectionBar.tsx).
    <div className="tool-full-height relative">
      <ViewHeader
        icon={Box}
        title="Containers"
        subtitle={containers ? `${containers.length} containers` : connection.name}
        actions={(
          <>
            <PruneButton
              noun="containers"
              variants={[{
                label: 'Prune stopped containers',
                description: 'Remove every container that is not running (docker container prune). Their writable layers and any data not on a volume are lost.',
                run: () => containerApi.prune(connection),
              }]}
              onDone={(m) => { setNotice(m); setError(null); load(); }}
              onError={(m) => { setNotice(null); setError(m); }}
            />
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0 flex items-center gap-3">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search containers…" className="h-ctl text-sm" containerClassName="max-w-sm" />
        <label className="flex items-center gap-1.5 text-[11px] text-fg-mute shrink-0">
          <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="Show all containers" />
          Show stopped
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-fg-mute shrink-0">
          <Switch checked={liveStats} onCheckedChange={setLiveStats} aria-label="Live CPU and memory usage" />
          Live usage
        </label>
      </div>

      <SelectionBar
        count={selection.count}
        unselectedVisibleCount={selection.unselectedVisibleCount}
        onSelectAllVisible={selection.selectAllVisible}
        onClear={selection.clear}
      >
        <Button
          size="sm" variant="outline" className="h-ctl"
          onClick={() => runBulk(selection.keys, (id) => containerApi.start(connection, id))}
        >
          <Play className="h-3.5 w-3.5 mr-1.5" /> Start
        </Button>
        <Button
          size="sm" variant="outline" className="h-ctl"
          onClick={() => runBulk(selection.keys, (id) => containerApi.stop(connection, id))}
        >
          <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
        </Button>
        <Button
          size="sm" variant="outline" className="h-ctl"
          onClick={() => runBulk(selection.keys, (id) => containerApi.restart(connection, id))}
        >
          <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Restart
        </Button>
        <Button size="sm" variant="outline" className="h-ctl" onClick={() => setBulkLimitsOpen(true)}>
          <Cpu className="h-3.5 w-3.5 mr-1.5" /> Limits
        </Button>
        <Button size="sm" variant="destructive" className="h-ctl" onClick={() => setBulkRemoveOpen(true)}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove {selection.count.toLocaleString()}
        </Button>
      </SelectionBar>

      <div className={cn('tool-scrollable px-5 py-4', selection.count > 0 && 'pb-20')}>
        {loading && !containers && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {notice && !error && <Callout tone="info" className="mb-3">{notice}</Callout>}
        {containers && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching containers.' : 'No containers.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th className="w-8">
                      <RowCheckbox
                        checked={selection.allVisibleSelected}
                        indeterminate={selection.someVisibleSelected}
                        onToggle={selection.toggleAllVisible}
                        title="Select all shown"
                      />
                    </Th>
                    <Th sortDirection={directionFor('name')} onSortClick={() => toggleSort('name')}>Name</Th>
                    <Th sortDirection={directionFor('image')} onSortClick={() => toggleSort('image')}>Image</Th>
                    <Th sortDirection={directionFor('state')} onSortClick={() => toggleSort('state')}>State</Th>
                    <Th sortDirection={directionFor('status')} onSortClick={() => toggleSort('status')}>Status</Th>
                    {liveStats && (
                      <>
                        <Th align="right" sortDirection={directionFor('cpu')} onSortClick={() => toggleSort('cpu')}>CPU</Th>
                        <Th align="right" sortDirection={directionFor('mem')} onSortClick={() => toggleSort('mem')}>Memory</Th>
                      </>
                    )}
                    <Th sortDirection={directionFor('ports')} onSortClick={() => toggleSort('ports')}>Ports</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((c, index) => (
                    <Tr key={c.Id} interactive selected={selection.isSelected(c.Id)} onClick={() => setDetailsTarget(c)}>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox
                          checked={selection.isSelected(c.Id)}
                          onToggle={(e) => selection.toggle(c.Id, index, e.shiftKey)}
                          title="Select container"
                        />
                      </Td>
                      <Td mono>{containerName(c)}</Td>
                      <Td mono>{c.Image}</Td>
                      <Td><Badge tone={stateTone(c.State)}>{c.State ?? 'unknown'}</Badge></Td>
                      <Td>{c.Status}</Td>
                      {liveStats && (
                        <>
                          <Td numeric><UsageCell frame={stats[c.Id]} kind="cpu" running={c.State === 'running'} /></Td>
                          <Td numeric><UsageCell frame={stats[c.Id]} kind="mem" running={c.State === 'running'} /></Td>
                        </>
                      )}
                      <Td mono>{formatPorts(c)}</Td>
                      <Td align="right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton size="sm" title="Details" onClick={() => setDetailsTarget(c)}>
                            <Info className="h-3.5 w-3.5" />
                          </IconButton>
                          {c.State === 'running' ? (
                            <IconButton size="sm" title="Stop" disabled={busyIds.has(c.Id)} onClick={() => runAction(c.Id, () => containerApi.stop(connection, c.Id))}>
                              <Square className="h-3.5 w-3.5" />
                            </IconButton>
                          ) : (
                            <IconButton size="sm" title="Start" disabled={busyIds.has(c.Id)} onClick={() => runAction(c.Id, () => containerApi.start(connection, c.Id))}>
                              <Play className="h-3.5 w-3.5" />
                            </IconButton>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              title="More actions"
                              className="inline-flex shrink-0 items-center justify-center rounded-sm h-ctl w-ctl text-fg-mute transition-colors hover:bg-acc hover:text-fg"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setLogsTarget(c)}>Logs</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setLimitsTarget(c)}>Resource limits…</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => runAction(c.Id, () => containerApi.restart(connection, c.Id))}>Restart</DropdownMenuItem>
                              {c.State === 'running' ? (
                                <DropdownMenuItem onClick={() => runAction(c.Id, () => containerApi.pause(connection, c.Id))}>Pause</DropdownMenuItem>
                              ) : c.State === 'paused' ? (
                                <DropdownMenuItem onClick={() => runAction(c.Id, () => containerApi.unpause(connection, c.Id))}>Unpause</DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-bad" onClick={() => setRemoveTarget(c)}>Remove</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>

      <Dialog open={!!logsTarget} onOpenChange={(o) => { if (!o) setLogsTarget(null); }}>
        <DialogContent className="max-w-3xl">
          {logsDialogTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-sm">{containerName(logsDialogTarget)}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-end gap-1">
                  {logsDialogTarget.State === 'running' ? (
                    <Button variant="outline" size="sm" onClick={() => runAction(logsDialogTarget.Id, () => containerApi.stop(connection, logsDialogTarget.Id))}>
                      <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => runAction(logsDialogTarget.Id, () => containerApi.start(connection, logsDialogTarget.Id))}>
                      <Play className="h-3.5 w-3.5 mr-1.5" /> Start
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => runAction(logsDialogTarget.Id, () => containerApi.restart(connection, logsDialogTarget.Id))}>
                    <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Restart
                  </Button>
                  {logsDialogTarget.State === 'running' ? (
                    <Button variant="outline" size="sm" onClick={() => runAction(logsDialogTarget.Id, () => containerApi.pause(connection, logsDialogTarget.Id))}>
                      <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                    </Button>
                  ) : logsDialogTarget.State === 'paused' ? (
                    <Button variant="outline" size="sm" onClick={() => runAction(logsDialogTarget.Id, () => containerApi.unpause(connection, logsDialogTarget.Id))}>
                      <PlayCircle className="h-3.5 w-3.5 mr-1.5" /> Unpause
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" className="hover:text-bad" onClick={() => setRemoveTarget(logsDialogTarget)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
                  </Button>
                </div>
                <div className="h-[50vh] flex flex-col">
                  <LogsPanel
                    key={logsDialogTarget.Id}
                    start={(tail, since, until, onLog) => containerApi.logsStart(connection, logsDialogTarget.Id, tail, since, until, onLog)}
                    stop={containerApi.logsStop}
                  />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove container?"
        description={removeTarget ? `Remove "${containerName(removeTarget)}". This cannot be undone.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeTarget) return;
          await runAction(removeTarget.Id, () => containerApi.remove(connection, removeTarget.Id, true));
          setLogsTarget(null);
          setRemoveTarget(null);
        }}
      />

      <ConfirmDialog
        open={bulkRemoveOpen}
        onOpenChange={setBulkRemoveOpen}
        title={`Remove ${selection.count} containers?`}
        description={`Remove ${selection.count.toLocaleString()} selected container(s). This cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          const ids = selection.keys;
          await runBulk(ids, (id) => containerApi.remove(connection, id, true));
          selection.clear();
        }}
      />

      <ContainerResourcesDialog
        open={!!limitsTarget}
        onOpenChange={(o) => { if (!o) setLimitsTarget(null); }}
        connection={connection}
        targets={limitsTarget ? [{ id: limitsTarget.Id, name: containerName(limitsTarget) }] : []}
        onApplied={load}
      />

      <ContainerResourcesDialog
        open={bulkLimitsOpen}
        onOpenChange={setBulkLimitsOpen}
        connection={connection}
        targets={selectedContainers.map((c) => ({ id: c.Id, name: containerName(c) }))}
        onApplied={load}
      />

      <ContainerDetailsDialog
        open={!!detailsTarget}
        onOpenChange={(o) => { if (!o) setDetailsTarget(null); }}
        connection={connection}
        container={detailsTarget}
        onEditLimits={(c) => { setDetailsTarget(null); setLimitsTarget(c); }}
      />
    </div>
  );
}

/** CPU / memory cell for the live-usage columns: the number plus a bar
 *  showing it against the container's own limit, so a container pinned at its
 *  cap is visible at a glance instead of needing the two numbers compared. */
function UsageCell({ frame, kind, running }: { frame?: StatsFrame; kind: 'cpu' | 'mem'; running: boolean }) {
  if (!running) return <span className="text-fg-mute">—</span>;
  if (!frame) return <span className="text-fg-mute">…</span>;

  const pct = kind === 'cpu'
    ? frame.cpuPercent
    : frame.memLimitBytes > 0 ? (frame.memUsageBytes / frame.memLimitBytes) * 100 : 0;
  const label = kind === 'cpu'
    ? `${frame.cpuPercent.toFixed(1)}%`
    : formatBytes(frame.memUsageBytes);
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="font-mono text-xs tabular-nums">{label}</span>
      <span className="h-0.5 w-14 overflow-hidden rounded-full bg-sunk">
        <span
          className={cn('block h-full', clamped >= 90 ? 'bg-bad' : clamped >= 70 ? 'bg-warn' : 'bg-acc')}
          style={{ width: `${clamped}%` }}
        />
      </span>
    </span>
  );
}
