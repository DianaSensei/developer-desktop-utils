import { useEffect, useMemo, useState } from 'react';
import { Box, RefreshCw, MoreHorizontal, Play, Square, RotateCw, Trash2, Pause, PlayCircle, Check, Info } from 'lucide-react';
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
import { containerApi, type ContainerConnection, type ContainerSummary } from './types';
import { LogsPanel } from './LogsPanel';
import { useSort } from './useSort';
import { ContainerDetailsDialog } from './ContainerDetailsDialog';

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
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [logsTarget, setLogsTarget] = useState<ContainerSummary | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ContainerSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContainerSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    containerApi.list(connection, showAll)
      .then((cs) => setContainers(cs))
      .catch((e) => { setContainers([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); setSelected(new Set()); }, [connection, showAll, refreshKey]); // eslint-disable-line

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
  });

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

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = rows.length > 0 && rows.every((c) => selected.has(c.Id));
  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        rows.forEach((c) => next.delete(c.Id));
        return next;
      }
      const next = new Set(prev);
      rows.forEach((c) => next.add(c.Id));
      return next;
    });
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Box}
        title="Containers"
        subtitle={containers ? `${containers.length} containers` : connection.name}
        actions={<Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>}
      />

      <div className="px-5 pt-3 shrink-0 flex items-center gap-3">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search containers…" className="h-ctl text-sm" containerClassName="max-w-sm" />
        <label className="flex items-center gap-1.5 text-[11px] text-fg-mute shrink-0">
          <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="Show all containers" />
          Show stopped
        </label>
      </div>

      {selected.size > 0 && (
        <div className="mx-5 mt-3 shrink-0 flex items-center justify-between gap-2 rounded-md border border-acc/30 bg-acc/5 px-3 py-2">
          <span className="text-xs text-fg-mute">{selected.size.toLocaleString()} selected</span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-ctl" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button
              size="sm" variant="outline" className="h-ctl"
              onClick={() => runBulk(Array.from(selected), (id) => containerApi.start(connection, id))}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" /> Start
            </Button>
            <Button
              size="sm" variant="outline" className="h-ctl"
              onClick={() => runBulk(Array.from(selected), (id) => containerApi.stop(connection, id))}
            >
              <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
            </Button>
            <Button
              size="sm" variant="outline" className="h-ctl"
              onClick={() => runBulk(Array.from(selected), (id) => containerApi.restart(connection, id))}
            >
              <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Restart
            </Button>
            <Button size="sm" variant="destructive" className="h-ctl" onClick={() => setBulkRemoveOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove {selected.size.toLocaleString()}
            </Button>
          </div>
        </div>
      )}

      <div className="tool-scrollable px-5 py-4">
        {loading && !containers && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {containers && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching containers.' : 'No containers.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th className="w-8">
                      <RowCheckbox checked={allVisibleSelected} onClick={toggleSelectAllVisible} title="Select all shown" />
                    </Th>
                    <Th sortDirection={directionFor('name')} onSortClick={() => toggleSort('name')}>Name</Th>
                    <Th sortDirection={directionFor('image')} onSortClick={() => toggleSort('image')}>Image</Th>
                    <Th sortDirection={directionFor('state')} onSortClick={() => toggleSort('state')}>State</Th>
                    <Th sortDirection={directionFor('status')} onSortClick={() => toggleSort('status')}>Status</Th>
                    <Th sortDirection={directionFor('ports')} onSortClick={() => toggleSort('ports')}>Ports</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((c) => (
                    <Tr key={c.Id} interactive selected={selected.has(c.Id)} onClick={() => setDetailsTarget(c)}>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox checked={selected.has(c.Id)} onClick={() => toggleSelected(c.Id)} title="Select container" />
                      </Td>
                      <Td mono>{containerName(c)}</Td>
                      <Td mono>{c.Image}</Td>
                      <Td><Badge tone={stateTone(c.State)}>{c.State ?? 'unknown'}</Badge></Td>
                      <Td>{c.Status}</Td>
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

      {logsTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) setLogsTarget(null); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">{containerName(logsTarget)}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-end gap-1">
                {logsTarget.State === 'running' ? (
                  <Button variant="outline" size="sm" onClick={() => runAction(logsTarget.Id, () => containerApi.stop(connection, logsTarget.Id))}>
                    <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => runAction(logsTarget.Id, () => containerApi.start(connection, logsTarget.Id))}>
                    <Play className="h-3.5 w-3.5 mr-1.5" /> Start
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => runAction(logsTarget.Id, () => containerApi.restart(connection, logsTarget.Id))}>
                  <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Restart
                </Button>
                {logsTarget.State === 'running' ? (
                  <Button variant="outline" size="sm" onClick={() => runAction(logsTarget.Id, () => containerApi.pause(connection, logsTarget.Id))}>
                    <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                  </Button>
                ) : logsTarget.State === 'paused' ? (
                  <Button variant="outline" size="sm" onClick={() => runAction(logsTarget.Id, () => containerApi.unpause(connection, logsTarget.Id))}>
                    <PlayCircle className="h-3.5 w-3.5 mr-1.5" /> Unpause
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="hover:text-bad" onClick={() => setRemoveTarget(logsTarget)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
                </Button>
              </div>
              <div className="h-[50vh] flex flex-col">
                <LogsPanel
                  start={(onLog) => containerApi.logsStart(connection, logsTarget.Id, '500', onLog)}
                  stop={containerApi.logsStop}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

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
        title={`Remove ${selected.size} containers?`}
        description={`Remove ${selected.size.toLocaleString()} selected container(s). This cannot be undone.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          const ids = Array.from(selected);
          await runBulk(ids, (id) => containerApi.remove(connection, id, true));
          setSelected(new Set());
        }}
      />

      <ContainerDetailsDialog
        open={!!detailsTarget}
        onOpenChange={(o) => { if (!o) setDetailsTarget(null); }}
        connection={connection}
        container={detailsTarget}
      />
    </div>
  );
}

function RowCheckbox({ checked, onClick, title }: { checked: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
        checked ? 'border-acc bg-acc text-acc-fg' : 'border-sunk',
      )}
    >
      {checked && <Check className="h-2.5 w-2.5" />}
    </button>
  );
}
