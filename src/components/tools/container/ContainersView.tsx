import { useEffect, useMemo, useState } from 'react';
import { Box, RefreshCw, MoreHorizontal, Play, Square, RotateCw, Trash2, Pause, PlayCircle } from 'lucide-react';
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
import { containerApi, type ContainerConnection, type ContainerSummary } from './types';
import { LogsPanel } from './LogsPanel';

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [logsTarget, setLogsTarget] = useState<ContainerSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContainerSummary | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    containerApi.list(connection, showAll)
      .then((cs) => setContainers(cs))
      .catch((e) => { setContainers([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [connection, showAll, refreshKey]); // eslint-disable-line

  const f = filter.trim().toLowerCase();
  const rows = useMemo(
    () => (containers ?? []).filter((c) => containerName(c).toLowerCase().includes(f) || (c.Image ?? '').toLowerCase().includes(f)),
    [containers, f],
  );

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyId(null);
    }
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
                    <Th>Name</Th>
                    <Th>Image</Th>
                    <Th>State</Th>
                    <Th>Status</Th>
                    <Th>Ports</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((c) => (
                    <Tr key={c.Id}>
                      <Td mono>{containerName(c)}</Td>
                      <Td mono>{c.Image}</Td>
                      <Td><Badge tone={stateTone(c.State)}>{c.State ?? 'unknown'}</Badge></Td>
                      <Td>{c.Status}</Td>
                      <Td mono>{formatPorts(c)}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1">
                          {c.State === 'running' ? (
                            <IconButton size="sm" title="Stop" disabled={busyId === c.Id} onClick={() => runAction(c.Id, () => containerApi.stop(connection, c.Id))}>
                              <Square className="h-3.5 w-3.5" />
                            </IconButton>
                          ) : (
                            <IconButton size="sm" title="Start" disabled={busyId === c.Id} onClick={() => runAction(c.Id, () => containerApi.start(connection, c.Id))}>
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
                              <DropdownMenuItem onClick={() => setLogsTarget(c)}>Logs & details</DropdownMenuItem>
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
    </div>
  );
}
