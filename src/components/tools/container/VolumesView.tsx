import { useEffect, useMemo, useState } from 'react';
import { HardDrive, RefreshCw, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import { Callout } from '@/components/ui/callout';
import { LoadingRow, Spinner } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { containerApi, type ContainerConnection, type VolumeInfo } from './types';
import { useSort } from './useSort';
import { formatBytes } from './format';

export function VolumesView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [volumes, setVolumes] = useState<VolumeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<VolumeInfo | null>(null);
  // Volume size isn't part of the plain volume-list endpoint — the daemon has
  // to walk every volume's mountpoint on disk to compute it, which is
  // noticeably slower (`volume_sizes` — see container_tool.rs for why that
  // isn't just `container_system_df`). Fetched separately so the volume list
  // itself still renders instantly; the Size column just shows a spinner
  // until this resolves. Empty on Windows (not wired up there).
  const [sizesLoading, setSizesLoading] = useState(false);
  const [sizeByName, setSizeByName] = useState<Record<string, number>>({});

  const load = () => {
    setLoading(true);
    setError(null);
    containerApi.volumeList(connection)
      .then(setVolumes)
      .catch((e) => { setVolumes([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));

    setSizesLoading(true);
    containerApi.volumeSizes(connection)
      .then(setSizeByName)
      .catch(() => setSizeByName({}))
      .finally(() => setSizesLoading(false));
  };
  useEffect(() => { load(); }, [connection, refreshKey]); // eslint-disable-line

  const f = filter.trim().toLowerCase();
  const filtered = useMemo(() => (volumes ?? []).filter((v) => v.Name.toLowerCase().includes(f)), [volumes, f]);
  const { sorted: rows, toggleSort, directionFor } = useSort(filtered, {
    name: (v) => v.Name,
    driver: (v) => v.Driver,
    mountpoint: (v) => v.Mountpoint,
    size: (v) => sizeByName[v.Name] ?? -1,
  });

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={HardDrive}
        title="Volumes"
        subtitle={volumes ? `${volumes.length} volumes` : connection.name}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New volume</Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search volumes…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && !volumes && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {volumes && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching volumes.' : 'No volumes.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th sortDirection={directionFor('name')} onSortClick={() => toggleSort('name')}>Name</Th>
                    <Th sortDirection={directionFor('driver')} onSortClick={() => toggleSort('driver')}>Driver</Th>
                    <Th align="right" sortDirection={directionFor('size')} onSortClick={() => toggleSort('size')}>Size</Th>
                    <Th sortDirection={directionFor('mountpoint')} onSortClick={() => toggleSort('mountpoint')}>Mountpoint</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((v) => (
                    <Tr key={v.Name}>
                      <Td mono>{v.Name}</Td>
                      <Td>{v.Driver}</Td>
                      <Td numeric>
                        {sizesLoading && !(v.Name in sizeByName) ? <Spinner size="sm" /> : formatBytes(sizeByName[v.Name])}
                      </Td>
                      <Td mono>{v.Mountpoint}</Td>
                      <Td align="right">
                        <IconButton size="sm" title="Remove" className="hover:text-bad" onClick={() => setRemoveTarget(v)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>

      <CreateVolumeDialog open={createOpen} onOpenChange={setCreateOpen} connection={connection} onCreated={load} />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove volume?"
        description={removeTarget ? `Remove "${removeTarget.Name}". Data on this volume is lost.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeTarget) return;
          await containerApi.volumeRemove(connection, removeTarget.Name, true);
          setRemoveTarget(null);
          load();
        }}
      />
    </div>
  );
}

function CreateVolumeDialog({ open, onOpenChange, connection, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; connection: ContainerConnection; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setBusy(true);
    setError(null);
    try {
      await containerApi.volumeCreate(connection, name.trim());
      onCreated();
      onOpenChange(false);
      setName('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New volume</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="my-volume" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="font-mono text-sm" />
          {error && <Callout tone="error" size="sm">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
