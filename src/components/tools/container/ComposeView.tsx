import { useEffect, useMemo, useState } from 'react';
import {
  FileStack, RefreshCw, Plus, Trash2, Play, Square, RotateCw, Download, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { LoadingRow, Spinner } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import {
  composeApi, EMPTY_COMPOSE_PROJECT, type ContainerConnection, type ComposeProject,
  type ComposeServiceStatus, type ComposeProjectStatus,
} from './types';
import { LogsPanel } from './LogsPanel';

export function ComposeView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [projects, setProjects] = useState<ComposeProject[] | null>(null);
  const [selected, setSelected] = useState<ComposeProject | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ComposeProject | null>(null);
  const [discovered, setDiscovered] = useState<ComposeProjectStatus[] | null>(null);

  const load = () => {
    composeApi.listKnown().then((ps) => {
      setProjects(ps);
      setSelected((cur) => (cur ? ps.find((p) => p.id === cur.id) ?? null : null));
    });
    composeApi.listProjects(connection).then(setDiscovered).catch(() => setDiscovered([]));
  };
  useEffect(() => { load(); }, [connection, refreshKey]); // eslint-disable-line

  const projectsForConn = useMemo(
    () => (projects ?? []).filter((p) => p.connectionId === connection.id),
    [projects, connection.id],
  );

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={FileStack}
        title="Compose"
        subtitle={`${projectsForConn.length} projects · requires docker CLI + compose plugin on PATH`}
        actions={(
          <>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add project</Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="tool-scrollable px-5 py-4 space-y-5">
        {projects === null && <LoadingRow />}

        {projects && (
          projectsForConn.length === 0
            ? <p className="text-sm text-fg-mute">No Compose projects added for this connection yet.</p>
            : (
              <div className="space-y-2">
                {projectsForConn.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-line/50 overflow-hidden"
                  >
                    <button
                      className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-bg-2/30 transition-colors text-left"
                      onClick={() => setSelected(selected?.id === p.id ? null : p)}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-fg-mute font-mono truncate">{p.composeFiles.join(', ')}</p>
                      </div>
                      <IconButton
                        size="sm"
                        title="Remove bookmark"
                        className="hover:text-bad shrink-0"
                        onClick={(e) => { e.stopPropagation(); setRemoveTarget(p); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </button>
                    {selected?.id === p.id && (
                      <div className="border-t border-line/50 p-3.5">
                        <ProjectDetail connection={connection} project={p} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
        )}

        {discovered && discovered.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-fg-mute mb-2">Running on this daemon</p>
            <DataTable>
              <Thead>
                <Tr><Th>Project</Th><Th>Status</Th><Th>Config files</Th></Tr>
              </Thead>
              <Tbody>
                {discovered.map((d) => (
                  <Tr key={d.Name}>
                    <Td mono>{d.Name}</Td>
                    <Td>{d.Status}</Td>
                    <Td mono className="truncate max-w-xs">{d.ConfigFiles}</Td>
                  </Tr>
                ))}
              </Tbody>
            </DataTable>
          </div>
        )}
      </div>

      <AddProjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        connection={connection}
        onAdded={load}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove bookmark?"
        description={removeTarget ? `Stop tracking "${removeTarget.name}" in this tool. It does not stop the running services.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeTarget) return;
          await composeApi.removeProject(removeTarget.id);
          setRemoveTarget(null);
          load();
        }}
      />
    </div>
  );
}

function ProjectDetail({ connection, project }: { connection: ContainerConnection; project: ComposeProject }) {
  const [services, setServices] = useState<ComposeServiceStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsService, setLogsService] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    composeApi.ps(connection, project.composeFiles, project.workingDir)
      .then(setServices)
      .catch((e) => { setServices([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [connection, project]); // eslint-disable-line

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    setError(null);
    try {
      const out = await action();
      setLastOutput(out);
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={!!busy} onClick={() => run('up', () => composeApi.up(connection, project.composeFiles, project.workingDir))}>
          {busy === 'up' ? <Spinner size="sm" className="mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />} Up
        </Button>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run('down', () => composeApi.down(connection, project.composeFiles, project.workingDir, false))}>
          {busy === 'down' ? <Spinner size="sm" className="mr-1.5" /> : <Square className="h-3.5 w-3.5 mr-1.5" />} Down
        </Button>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run('restart', () => composeApi.restart(connection, project.composeFiles, project.workingDir, null))}>
          {busy === 'restart' ? <Spinner size="sm" className="mr-1.5" /> : <RotateCw className="h-3.5 w-3.5 mr-1.5" />} Restart
        </Button>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run('pull', () => composeApi.pull(connection, project.composeFiles, project.workingDir))}>
          {busy === 'pull' ? <Spinner size="sm" className="mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />} Pull
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLogsService('')}>
          <FileText className="h-3.5 w-3.5 mr-1.5" /> Logs (all)
        </Button>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {error && <Callout tone="error" size="sm">{error}</Callout>}
      {lastOutput && !error && (
        <details className="text-[11px] text-fg-mute">
          <summary className="cursor-pointer">Last command output</summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono bg-bg-2/30 rounded-md p-2">{lastOutput}</pre>
        </details>
      )}

      {loading && !services && <LoadingRow />}
      {services && services.length === 0 && !error && <p className="text-xs text-fg-mute">No services running. Click Up to start.</p>}
      {services && services.length > 0 && (
        <DataTable density="compact">
          <Thead>
            <Tr><Th>Service</Th><Th>State</Th><Th>Health</Th><Th align="right"></Th></Tr>
          </Thead>
          <Tbody>
            {services.map((s) => (
              <Tr key={s.ID || s.Name}>
                <Td mono>{s.Service}</Td>
                <Td><Badge tone={s.State === 'running' ? 'success' : s.State === 'exited' ? 'danger' : 'neutral'}>{s.State}</Badge></Td>
                <Td>{s.Health || '—'}</Td>
                <Td align="right">
                  <Button variant="ghost" size="sm" onClick={() => setLogsService(s.Service)}>Logs</Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </DataTable>
      )}

      {logsService !== null && (
        <Dialog open onOpenChange={(o) => { if (!o) setLogsService(null); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">{project.name}{logsService ? ` · ${logsService}` : ' · all services'}</DialogTitle>
            </DialogHeader>
            <div className="h-[50vh] flex flex-col">
              <LogsPanel
                start={(onLog) => composeApi.logsStart(connection, project.composeFiles, project.workingDir, logsService || null, onLog)}
                stop={composeApi.logsStop}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AddProjectDialog({ open, onOpenChange, connection, onAdded }: {
  open: boolean; onOpenChange: (o: boolean) => void; connection: ContainerConnection; onAdded: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_COMPOSE_PROJECT, connectionId: connection.id });
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async () => {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const path = await openDialog({
      multiple: false,
      filters: [{ name: 'Compose file', extensions: ['yml', 'yaml'] }],
    });
    if (!path || typeof path !== 'string') return;
    const dir = path.replace(/[\\/][^\\/]*$/, '');
    const base = path.split(/[\\/]/).pop() ?? path;
    const nameGuess = base.replace(/\.(ya?ml)$/i, '').replace(/^docker-compose$/i, dir.split(/[\\/]/).pop() ?? 'compose');
    setForm((f) => ({ ...f, composeFiles: [path], workingDir: dir, name: f.name || nameGuess }));
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (form.composeFiles.length === 0) { setError('Choose a compose file'); return; }
    setBusy(true);
    setError(null);
    try {
      const files = override.trim() ? [...form.composeFiles, override.trim()] : form.composeFiles;
      await composeApi.addProject({ ...form, id: '', composeFiles: files, connectionId: connection.id });
      onAdded();
      onOpenChange(false);
      setForm({ ...EMPTY_COMPOSE_PROJECT, connectionId: connection.id });
      setOverride('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Compose project</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Compose file</Label>
            <div className="flex gap-2 mt-1">
              <Input readOnly value={form.composeFiles[0] ?? ''} placeholder="Choose a docker-compose.yml…" className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={browse} disabled={busy}>Browse…</Button>
            </div>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={busy} className="mt-1" />
          </div>
          <div>
            <Label>Override file <span className="font-normal text-fg-mute">— optional, e.g. docker-compose.override.yml</span></Label>
            <Input value={override} onChange={(e) => setOverride(e.target.value)} disabled={busy} className="mt-1 font-mono text-xs" placeholder="/path/to/docker-compose.override.yml" />
          </div>
          {error && <Callout tone="error" size="sm">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
