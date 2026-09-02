import { useCallback, useEffect, useMemo, useState } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { Layers, RefreshCw, Trash2, Download, Info, Tag } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { containerApi, type ContainerConnection, type ImageSummary, type PullProgress } from './types';
import { PruneButton } from './PruneButton';
import { useUsageIndex, describeUsers } from './usage';
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
  const [tagTarget, setTagTarget] = useState<ImageSummary | null>(null);
  /** Result line from the last prune — informational, not an error. */
  const [notice, setNotice] = useState<string | null>(null);
  const { usage, reload: reloadUsage } = useUsageIndex(connection, refreshKey);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    reloadUsage();
    containerApi.imageList(connection)
      .then(setImages)
      .catch((e) => { setImages([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  }, [connection, reloadUsage]);

  const f = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (images ?? []).filter((img) => (img.RepoTags ?? []).some((t) => t.toLowerCase().includes(f)) || img.Id.toLowerCase().includes(f)),
    [images, f],
  );
  const { sorted: rows, toggleSort, directionFor } = useSort(filtered, {
    repo: (img) => (img.RepoTags ?? ['<none>:<none>']).join(', '),
    id: (img) => img.Id,
    size: (img) => img.Size ?? 0,
    used: (img) => usage.byImage.get(img.Id)?.length ?? 0,
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
    // `relative` anchors the floating SelectionBar (see SelectionBar.tsx).
    <div className="tool-full-height relative">
      <ViewHeader
        icon={Layers}
        title="Images"
        subtitle={images ? `${images.length} images` : connection.name}
        actions={(
          <>
            <Button size="sm" onClick={() => setPullOpen(true)}><Download className="h-3.5 w-3.5 mr-1.5" /> Pull</Button>
            <PruneButton
              noun="images"
              variants={[
                {
                  label: 'Prune dangling images',
                  description: 'Remove every untagged image layer left behind by rebuilds (docker image prune). Tagged images are kept.',
                  run: () => containerApi.imagePrune(connection, true),
                },
                {
                  label: 'Prune all unused images',
                  danger: true,
                  description: 'Remove every image no container is using, tagged ones included (docker image prune -a). Anything not in a registry has to be rebuilt.',
                  run: () => containerApi.imagePrune(connection, false),
                },
              ]}
              onDone={(m) => { setNotice(m); setError(null); load(); }}
              onError={(m) => { setNotice(null); setError(m); }}
            />
            <Button variant="outline" size="sm" busy={loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
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

      <div className={cn('tool-scrollable px-5 py-4', selection.count > 0 && 'pb-20')}>
        {loading && !images && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {notice && !error && <Callout tone="info" className="mb-3">{notice}</Callout>}
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
                    <Th sortDirection={directionFor('used')} onSortClick={() => toggleSort('used')}>In use</Th>
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
                      <Td><UsageBadge users={usage.byImage.get(img.Id)} dangling={isDangling(img)} /></Td>
                      <Td numeric>{formatBytes(img.Size)}</Td>
                      <Td align="right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton size="sm" title="Details" onClick={() => setDetailsTarget(img)}>
                            <Info className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton size="sm" title="Add tag" onClick={() => setTagTarget(img)}>
                            <Tag className="h-3.5 w-3.5" />
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

      <TagDialog
        open={!!tagTarget}
        onOpenChange={(o) => { if (!o) setTagTarget(null); }}
        connection={connection}
        image={tagTarget}
        onTagged={() => { setTagTarget(null); load(); }}
      />

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

/** An image with no repo tag is a dangling layer — the thing `docker image
 *  prune` targets, and worth calling out since it can't be pulled back. */
function isDangling(img: ImageSummary): boolean {
  const tags = img.RepoTags ?? [];
  return tags.length === 0 || tags.every((t) => t === '<none>:<none>');
}

function UsageBadge({ users, dangling }: { users?: string[]; dangling?: boolean }) {
  if (users && users.length > 0) {
    return (
      <span title={describeUsers(users)}>
        <Badge tone="success">{users.length} container{users.length > 1 ? 's' : ''}</Badge>
      </span>
    );
  }
  return (
    <span title={dangling ? 'Untagged layer, not used by any container' : 'Not used by any container'}>
      <Badge tone={dangling ? 'warning' : 'neutral'}>{dangling ? 'dangling' : 'unused'}</Badge>
    </span>
  );
}

/** `docker tag` — adds a second name to an existing image. Never removes the
 *  old one, so it's a safe, non-destructive rename-by-addition. */
function TagDialog({ open, onOpenChange, connection, image, onTagged }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  image: ImageSummary | null;
  onTagged: () => void;
}) {
  const [repo, setRepo] = useState('');
  const [tag, setTag] = useState('latest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = image?.RepoTags?.find((t) => t !== '<none>:<none>');
    const [existingRepo, existingTag] = first ? splitTag(first) : ['', 'latest'];
    setRepo(existingRepo);
    setTag(existingTag);
    setError(null);
  }, [open, image]);

  const apply = async () => {
    if (!image) return;
    if (!repo.trim()) { setError('Repository is required'); return; }
    setBusy(true);
    setError(null);
    try {
      await containerApi.imageTag(connection, image.Id, repo.trim(), tag.trim() || 'latest');
      onTagged();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add tag</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[11px] text-fg-mute font-mono break-all">
            {image?.Id.replace('sha256:', '').slice(0, 20)}
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input placeholder="my-app" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={busy} className="font-mono text-sm" />
            <Input placeholder="latest" value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy} className="font-mono text-sm w-28" />
          </div>
          <p className="text-[11px] text-fg-mute">The existing tags are kept — this only adds another name.</p>
          {error && <Callout tone="error" size="sm">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={apply} disabled={busy}>{busy ? 'Tagging…' : 'Add tag'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Splits `repo:tag` on the LAST colon — a registry host can carry a port
 *  (`localhost:5000/app:v1`), so splitting on the first would break it. */
function splitTag(repoTag: string): [string, string] {
  const i = repoTag.lastIndexOf(':');
  if (i === -1 || repoTag.slice(i + 1).includes('/')) return [repoTag, 'latest'];
  return [repoTag.slice(0, i), repoTag.slice(i + 1)];
}
