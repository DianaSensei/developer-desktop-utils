import { useEffect, useMemo, useState } from 'react';
import { Network as NetworkIcon, RefreshCw, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { containerApi, type ContainerConnection, type NetworkInfo } from './types';
import { useSort } from './useSort';

const BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none']);

export function NetworksView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [networks, setNetworks] = useState<NetworkInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<NetworkInfo | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    containerApi.networkList(connection)
      .then(setNetworks)
      .catch((e) => { setNetworks([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [connection, refreshKey]); // eslint-disable-line

  const f = filter.trim().toLowerCase();
  const filtered = useMemo(() => (networks ?? []).filter((n) => n.Name.toLowerCase().includes(f)), [networks, f]);
  const { sorted: rows, toggleSort, directionFor } = useSort(filtered, {
    name: (n) => n.Name,
    driver: (n) => n.Driver ?? '',
    scope: (n) => n.Scope ?? '',
  });

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={NetworkIcon}
        title="Networks"
        subtitle={networks ? `${networks.length} networks` : connection.name}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New network</Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search networks…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && !networks && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {networks && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching networks.' : 'No networks.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th sortDirection={directionFor('name')} onSortClick={() => toggleSort('name')}>Name</Th>
                    <Th sortDirection={directionFor('driver')} onSortClick={() => toggleSort('driver')}>Driver</Th>
                    <Th sortDirection={directionFor('scope')} onSortClick={() => toggleSort('scope')}>Scope</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((n) => (
                    <Tr key={n.Id}>
                      <Td mono>{n.Name}</Td>
                      <Td>{n.Driver}</Td>
                      <Td>{n.Scope}</Td>
                      <Td align="right">
                        {!BUILTIN_NETWORKS.has(n.Name) && (
                          <IconButton size="sm" title="Remove" className="hover:text-bad" onClick={() => setRemoveTarget(n)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>

      <CreateNetworkDialog open={createOpen} onOpenChange={setCreateOpen} connection={connection} onCreated={load} />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove network?"
        description={removeTarget ? `Remove "${removeTarget.Name}".` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeTarget) return;
          await containerApi.networkRemove(connection, removeTarget.Name);
          setRemoveTarget(null);
          load();
        }}
      />
    </div>
  );
}

function CreateNetworkDialog({ open, onOpenChange, connection, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; connection: ContainerConnection; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('bridge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setBusy(true);
    setError(null);
    try {
      await containerApi.networkCreate(connection, name.trim(), driver.trim() || 'bridge');
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
        <DialogHeader><DialogTitle>New network</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input placeholder="my-network" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className="font-mono text-sm" />
            <Input placeholder="bridge" value={driver} onChange={(e) => setDriver(e.target.value)} disabled={busy} className="font-mono text-sm w-28" />
          </div>
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
