import { useEffect, useMemo, useState } from 'react';
import { FileStack, RefreshCw, Play, Square, RotateCw, Trash2, FileText, PowerOff, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td, type SortDirection } from '@/components/ui/data-table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import {
  containerApi, groupByComposeProject, COMPOSE_LABELS,
  type ContainerConnection, type ContainerSummary, type ComposeProjectGroup,
} from './types';
import { LogsPanel } from './LogsPanel';
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

/**
 * Compose projects are not a Docker Engine API object — there is no daemon
 * endpoint for "list compose projects", so this view is deliberately
 * grouping-only: it groups the containers container_list already returns by
 * the com.docker.compose.project label docker compose stamps on them (the
 * same technique tools like OrbStack use for their compose grouping), and
 * every action (start/stop/restart/remove/logs) reuses the plain per-
 * container bollard commands from container_tool.rs. The project-level
 * "Down" action is the same technique applied to every container in the
 * group — stop then force-remove — not `docker compose down`, so it never
 * touches compose-managed networks/volumes, only the containers.
 *
 * What's intentionally missing: `up`/`build`/`pull` for a project. Those
 * require parsing and orchestrating a compose YAML file client-side — logic
 * the Docker Engine API has no equivalent for — so they are out of scope
 * until that's built natively (see conversation/ADR for the shell-vs-native
 * tradeoff).
 */
export function ComposeView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [logsTarget, setLogsTarget] = useState<ContainerSummary | null>(null);
  // See ContainersView for why this trails `logsTarget` by one render: it lets
  // the Dialog stay mounted (`open={!!logsTarget}`) and animate its close
  // instead of vanishing instantly when `logsTarget` clears.
  const [logsDialogTarget, setLogsDialogTarget] = useState<ContainerSummary | null>(null);
  useEffect(() => { if (logsTarget) setLogsDialogTarget(logsTarget); }, [logsTarget]);
  const [detailsTarget, setDetailsTarget] = useState<ContainerSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContainerSummary | null>(null);
  const [downTarget, setDownTarget] = useState<ComposeProjectGroup | null>(null);
  const [sortKey, setSortKey] = useState<'service' | 'state' | 'status' | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const load = () => {
    setLoading(true);
    setError(null);
    containerApi.list(connection, true)
      .then(setContainers)
      .catch((e) => { setContainers([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [connection, refreshKey]); // eslint-disable-line

  const projects = useMemo(() => groupByComposeProject(containers ?? []), [containers]);

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

  const runDown = async (project: ComposeProjectGroup) => {
    setBusyProject(project.name);
    setError(null);
    const results = await Promise.allSettled(project.containers.map(async (c) => {
      if (c.State === 'running' || c.State === 'paused') {
        await containerApi.stop(connection, c.Id).catch(() => {});
      }
      await containerApi.remove(connection, c.Id, true);
    }));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const first = failed[0].reason;
      setError(`${failed.length} of ${project.containers.length} failed — ${String(first instanceof Error ? first.message : first)}`);
    }
    setBusyProject(null);
    load();
  };

  const toggleSort = (key: 'service' | 'state' | 'status') => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const directionFor = (key: 'service' | 'state' | 'status'): SortDirection | null => (sortKey === key ? sortDir : null);
  const sortValue = (c: ContainerSummary, key: 'service' | 'state' | 'status'): string => {
    if (key === 'service') return c.Labels?.[COMPOSE_LABELS.service] ?? containerName(c);
    if (key === 'state') return c.State ?? '';
    return c.Status ?? '';
  };
  const sortContainers = (list: ContainerSummary[]): ContainerSummary[] => {
    if (!sortKey) return list;
    const copy = [...list];
    copy.sort((a, b) => {
      const cmp = sortValue(a, sortKey).localeCompare(sortValue(b, sortKey));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={FileStack}
        title="Compose"
        subtitle={`${projects.length} projects · grouped by container label`}
        actions={<Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>}
      />

      <div className="tool-scrollable px-5 py-4 space-y-4">
        {loading && !containers && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}

        {containers && !error && projects.length === 0 && (
          <p className="text-sm text-fg-mute">
            No containers with a <span className="font-mono text-[11px]">com.docker.compose.project</span> label found —
            start a project with <span className="font-mono text-[11px]">docker compose up</span> from your terminal to see it here.
          </p>
        )}

        {projects.map((p) => (
          <div key={p.name} className="rounded-lg border border-line/50 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-bg-2/20 border-b border-line/50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.name}</p>
                {p.workingDir && <p className="text-[11px] text-fg-mute font-mono truncate">{p.workingDir}</p>}
              </div>
              <Button
                variant="outline" size="sm" className="shrink-0 hover:text-bad"
                disabled={busyProject === p.name}
                onClick={() => setDownTarget(p)}
              >
                <PowerOff className="h-3.5 w-3.5 mr-1.5" /> Down
              </Button>
            </div>
            <DataTable density="compact" containerClassName="rounded-none border-0">
              <Thead>
                <Tr>
                  <Th sortDirection={directionFor('service')} onSortClick={() => toggleSort('service')}>Service</Th>
                  <Th sortDirection={directionFor('state')} onSortClick={() => toggleSort('state')}>State</Th>
                  <Th sortDirection={directionFor('status')} onSortClick={() => toggleSort('status')}>Status</Th>
                  <Th align="right"></Th>
                </Tr>
              </Thead>
              <Tbody>
                {sortContainers(p.containers).map((c) => (
                  <Tr key={c.Id} interactive onClick={() => setDetailsTarget(c)}>
                    <Td mono>{c.Labels?.[COMPOSE_LABELS.service] ?? containerName(c)}</Td>
                    <Td><Badge tone={stateTone(c.State)}>{c.State ?? 'unknown'}</Badge></Td>
                    <Td>{c.Status}</Td>
                    <Td align="right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton size="sm" title="Details" onClick={() => setDetailsTarget(c)}>
                          <Info className="h-3.5 w-3.5" />
                        </IconButton>
                        {c.State === 'running' ? (
                          <IconButton size="sm" title="Stop" disabled={busyId === c.Id} onClick={() => runAction(c.Id, () => containerApi.stop(connection, c.Id))}>
                            <Square className="h-3.5 w-3.5" />
                          </IconButton>
                        ) : (
                          <IconButton size="sm" title="Start" disabled={busyId === c.Id} onClick={() => runAction(c.Id, () => containerApi.start(connection, c.Id))}>
                            <Play className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                        <IconButton size="sm" title="Restart" disabled={busyId === c.Id} onClick={() => runAction(c.Id, () => containerApi.restart(connection, c.Id))}>
                          <RotateCw className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton size="sm" title="Logs" onClick={() => setLogsTarget(c)}>
                          <FileText className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton size="sm" title="Remove" className="hover:text-bad" onClick={() => setRemoveTarget(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </DataTable>
          </div>
        ))}
      </div>

      <Dialog open={!!logsTarget} onOpenChange={(o) => { if (!o) setLogsTarget(null); }}>
        <DialogContent className="max-w-3xl">
          {logsDialogTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-sm">{containerName(logsDialogTarget)}</DialogTitle>
              </DialogHeader>
              <div className="h-[50vh] flex flex-col">
                <LogsPanel
                  key={logsDialogTarget.Id}
                  start={(tail, since, until, onLog) => containerApi.logsStart(connection, logsDialogTarget.Id, tail, since, until, onLog)}
                  stop={containerApi.logsStop}
                />
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
          setRemoveTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!downTarget}
        onOpenChange={(o) => { if (!o) setDownTarget(null); }}
        title="Down this project?"
        description={downTarget ? `Stop and remove all ${downTarget.containers.length} container(s) in "${downTarget.name}". This cannot be undone.` : ''}
        confirmLabel="Down"
        onConfirm={async () => {
          if (!downTarget) return;
          await runDown(downTarget);
          setDownTarget(null);
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
