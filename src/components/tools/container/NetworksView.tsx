import { useCallback, useEffect, useMemo, useState } from 'react';
import { Network as NetworkIcon, RefreshCw, Trash2, Plus, Info } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { containerApi, type ContainerConnection, type NetworkInfo } from './types';
import { PruneButton } from './PruneButton';
import { NetworkDetailsDialog } from './NetworkDetailsDialog';
import { useUsageIndex, describeUsers } from './usage';
import { useSort } from './useSort';
import { useRowSelection } from './useRowSelection';
import { RowCheckbox, SelectionBar } from './SelectionBar';

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
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<NetworkInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { usage, reload: reloadUsage } = useUsageIndex(connection, refreshKey);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    reloadUsage();
    containerApi.networkList(connection)
      .then(setNetworks)
      .catch((e) => { setNetworks([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  }, [connection, reloadUsage]);

  const f = filter.trim().toLowerCase();
  const filtered = useMemo(() => (networks ?? []).filter((n) => n.Name.toLowerCase().includes(f)), [networks, f]);
  const { sorted: rows, toggleSort, directionFor } = useSort(filtered, {
    name: (n) => n.Name,
    driver: (n) => n.Driver ?? '',
    scope: (n) => n.Scope ?? '',
    used: (n) => usage.byNetwork.get(n.Name)?.length ?? 0,
  });

  // `bridge`/`host`/`none` can't be removed, so they're not selectable either
  // — offering a checkbox that can only ever produce a daemon error would be
  // worse than not offering one.
  const selectableRows = useMemo(() => rows.filter((n) => !BUILTIN_NETWORKS.has(n.Name)), [rows]);
  const selection = useRowSelection(selectableRows, useCallback((n: NetworkInfo) => n.Name, []));
  const { prune, clear } = selection;

  useEffect(() => { load(); clear(); }, [load, refreshKey, clear]);
  useEffect(() => { if (networks) prune(networks.map((n) => n.Name)); }, [networks, prune]);

  const removeBulk = async (names: string[]) => {
    setBulkBusy(true);
    setError(null);
    const results = await Promise.allSettled(names.map((name) => containerApi.networkRemove(connection, name)));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const first = failed[0].reason;
      setError(`${failed.length} of ${names.length} failed — ${String(first instanceof Error ? first.message : first)}`);
    }
    setBulkBusy(false);
    clear();
    load();
  };

  return (
    // `relative` anchors the floating SelectionBar (see SelectionBar.tsx).
    <div className="tool-full-height relative">
      <ViewHeader
        icon={NetworkIcon}
        title="Networks"
        subtitle={networks ? `${networks.length} networks` : connection.name}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New network</Button>
            <PruneButton
              noun="networks"
              variants={[{
                label: 'Prune unused networks',
                description: 'Remove every user-defined network no container is attached to (docker network prune). The built-in bridge, host and none networks are never touched.',
                run: () => containerApi.networkPrune(connection),
              }]}
              onDone={(m) => { setNotice(m); setError(null); load(); }}
              onError={(m) => { setNotice(null); setError(m); }}
            />
            <Button variant="outline" size="sm" busy={loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search networks…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <SelectionBar
        count={selection.count}
        unselectedVisibleCount={selection.unselectedVisibleCount}
        onSelectAllVisible={selection.selectAllVisible}
        onClear={selection.clear}
      >
        <Button size="sm" variant="destructive" className="h-ctl" disabled={bulkBusy} onClick={() => setBulkRemoveOpen(true)}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove {selection.count.toLocaleString()}
        </Button>
      </SelectionBar>

      <div className={cn('tool-scrollable px-5 py-4', selection.count > 0 && 'pb-20')}>
        {loading && !networks && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {notice && !error && <Callout tone="info" className="mb-3">{notice}</Callout>}
        {networks && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching networks.' : 'No networks.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th className="w-8">
                      <RowCheckbox
                        checked={selection.allVisibleSelected}
                        indeterminate={selection.someVisibleSelected}
                        onToggle={selection.toggleAllVisible}
                        title="Select all removable networks"
                      />
                    </Th>
                    <Th sortDirection={directionFor('name')} onSortClick={() => toggleSort('name')}>Name</Th>
                    <Th sortDirection={directionFor('driver')} onSortClick={() => toggleSort('driver')}>Driver</Th>
                    <Th sortDirection={directionFor('scope')} onSortClick={() => toggleSort('scope')}>Scope</Th>
                    <Th sortDirection={directionFor('used')} onSortClick={() => toggleSort('used')}>In use</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((n) => (
                    <Tr key={n.Id} interactive selected={selection.isSelected(n.Name)} onClick={() => setDetailsTarget(n)}>
                      <Td onClick={(e) => e.stopPropagation()}>
                        {!BUILTIN_NETWORKS.has(n.Name) && (
                          <RowCheckbox
                            checked={selection.isSelected(n.Name)}
                            onToggle={(e) => selection.toggle(n.Name, selectableRows.findIndex((r) => r.Name === n.Name), e.shiftKey)}
                            title="Select network"
                          />
                        )}
                      </Td>
                      <Td mono>{n.Name}</Td>
                      <Td>{n.Driver}</Td>
                      <Td>{n.Scope}</Td>
                      <Td>
                        <span title={describeUsers(usage.byNetwork.get(n.Name))}>
                          {(() => {
                            const users = usage.byNetwork.get(n.Name);
                            return users && users.length > 0
                              ? <Badge tone="success">{users.length} container{users.length > 1 ? 's' : ''}</Badge>
                              : <Badge tone="neutral">unused</Badge>;
                          })()}
                        </span>
                      </Td>
                      <Td align="right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton size="sm" title="Details" onClick={() => setDetailsTarget(n)}>
                            <Info className="h-3.5 w-3.5" />
                          </IconButton>
                          {!BUILTIN_NETWORKS.has(n.Name) && (
                            <IconButton size="sm" title="Remove" className="hover:text-bad" onClick={() => setRemoveTarget(n)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>

      <CreateNetworkDialog open={createOpen} onOpenChange={setCreateOpen} connection={connection} onCreated={load} />

      <NetworkDetailsDialog
        open={!!detailsTarget}
        onOpenChange={(o) => { if (!o) setDetailsTarget(null); }}
        connection={connection}
        network={detailsTarget}
        users={detailsTarget ? usage.byNetwork.get(detailsTarget.Name) : undefined}
      />

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

      <ConfirmDialog
        open={bulkRemoveOpen}
        onOpenChange={setBulkRemoveOpen}
        title={`Remove ${selection.count} networks?`}
        description={`Remove ${selection.count.toLocaleString()} selected network(s). Networks still in use by a container are kept.`}
        confirmLabel="Remove"
        onConfirm={() => removeBulk(selection.keys)}
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
