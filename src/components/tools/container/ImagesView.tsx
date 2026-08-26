import { useCallback, useEffect, useMemo, useState } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { Layers, RefreshCw, Trash2, Download, Info } from 'lucide-react';
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
import { containerApi, type ContainerConnection, type ImageSummary, type PullProgress } from './types';
import { useSort } from './useSort';
import { useRowSelection } from './useRowSelection';
import { RowCheckbox, SelectionBar } from './SelectionBar';
import { formatBytes } from './format';
import { ImageDetailsDialog } from './ImageDetailsDialog';

export function ImagesView({ connection, refreshKey, onRefresh }: {
  connection: ContainerConnection;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [images, setImages] = useState<ImageSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ImageSummary | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ImageSummary | null>(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    containerApi.imageList(connection)
      .then(setImages)
      .catch((e) => { setImages([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  }, [connection]);

  const f = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (images ?? []).filter((img) => (img.RepoTags ?? []).some((t) => t.toLowerCase().includes(f)) || img.Id.toLowerCase().includes(f)),
    [images, f],
  );
  const { sorted: rows, toggleSort, directionFor } = useSort(filtered, {
    repo: (img) => (img.RepoTags ?? ['<none>:<none>']).join(', '),
    id: (img) => img.Id,
    size: (img) => img.Size ?? 0,
  });

  const selection = useRowSelection(rows, useCallback((img: ImageSummary) => img.Id, []));
  const { prune, clear } = selection;

  useEffect(() => { load(); clear(); }, [load, refreshKey, clear]);
  useEffect(() => { if (images) prune(images.map((img) => img.Id)); }, [images, prune]);

  const removeBulk = async (ids: string[]) => {
    setBulkBusy(true);
    setError(null);
    const results = await Promise.allSettled(ids.map((id) => containerApi.imageRemove(connection, id, true)));
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const first = failed[0].reason;
      setError(`${failed.length} of ${ids.length} failed — ${String(first instanceof Error ? first.message : first)}`);
    }
    setBulkBusy(false);
    clear();
    load();
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Layers}
        title="Images"
        subtitle={images ? `${images.length} images` : connection.name}
        actions={(
          <>
            <Button size="sm" onClick={() => setPullOpen(true)}><Download className="h-3.5 w-3.5 mr-1.5" /> Pull</Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search images…" className="h-ctl text-sm" containerClassName="max-w-sm" />
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

      <div className="tool-scrollable px-5 py-4">
        {loading && !images && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {images && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching images.' : 'No images.'}</p>
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
                    <Th sortDirection={directionFor('repo')} onSortClick={() => toggleSort('repo')}>Repository:Tag</Th>
                    <Th sortDirection={directionFor('id')} onSortClick={() => toggleSort('id')}>Image ID</Th>
                    <Th align="right" sortDirection={directionFor('size')} onSortClick={() => toggleSort('size')}>Size</Th>
                    <Th align="right"></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((img, index) => (
                    <Tr key={img.Id} interactive selected={selection.isSelected(img.Id)} onClick={() => setDetailsTarget(img)}>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <RowCheckbox
                          checked={selection.isSelected(img.Id)}
                          onToggle={(e) => selection.toggle(img.Id, index, e.shiftKey)}
                          title="Select image"
                        />
                      </Td>
                      <Td mono>{(img.RepoTags ?? ['<none>:<none>']).join(', ')}</Td>
                      <Td mono>{img.Id.replace('sha256:', '').slice(0, 12)}</Td>
                      <Td numeric>{formatBytes(img.Size)}</Td>
                      <Td align="right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton size="sm" title="Details" onClick={() => setDetailsTarget(img)}>
                            <Info className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton size="sm" title="Remove" className="hover:text-bad" onClick={() => setRemoveTarget(img)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>

      <PullDialog open={pullOpen} onOpenChange={setPullOpen} connection={connection} onDone={load} />

      <ImageDetailsDialog
        open={!!detailsTarget}
        onOpenChange={(o) => { if (!o) setDetailsTarget(null); }}
        connection={connection}
        image={detailsTarget}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove image?"
        description={removeTarget ? `Remove "${(removeTarget.RepoTags ?? [removeTarget.Id]).join(', ')}".` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeTarget) return;
          await containerApi.imageRemove(connection, removeTarget.Id, true);
          setRemoveTarget(null);
          load();
        }}
      />

      <ConfirmDialog
        open={bulkRemoveOpen}
        onOpenChange={setBulkRemoveOpen}
        title={`Remove ${selection.count} images?`}
        description={`Remove ${selection.count.toLocaleString()} selected image(s). Images still used by a container are kept.`}
        confirmLabel="Remove"
        onConfirm={() => removeBulk(selection.keys)}
      />
    </div>
  );
}

function PullDialog({ open, onOpenChange, connection, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; connection: ContainerConnection; onDone: () => void;
}) {
  const [image, setImage] = useState('');
  const [tag, setTag] = useState('latest');
  const [pulling, setPulling] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pull = async () => {
    if (!image.trim()) { setError('Image name is required'); return; }
    setPulling(true);
    setError(null);
    setStatus('Starting…');
    const channel = new Channel<PullProgress>();
    channel.onmessage = (p) => setStatus(p.status);
    try {
      await containerApi.imagePull(connection, image.trim(), tag.trim() || 'latest', channel);
      onDone();
      onOpenChange(false);
      setImage('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setPulling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pulling) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pull image</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input placeholder="nginx" value={image} onChange={(e) => setImage(e.target.value)} disabled={pulling} className="font-mono text-sm" />
            <Input placeholder="latest" value={tag} onChange={(e) => setTag(e.target.value)} disabled={pulling} className="font-mono text-sm w-28" />
          </div>
          {pulling && (
            <div className="flex items-center gap-2 text-xs text-fg-mute">
              <Spinner size="sm" /> {status}
            </div>
          )}
          {error && <Callout tone="error" size="sm">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pulling}>Cancel</Button>
          <Button onClick={pull} disabled={pulling}>{pulling ? 'Pulling…' : 'Pull'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
