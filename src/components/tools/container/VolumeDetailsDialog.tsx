import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { containerApi, type ContainerConnection, type VolumeDetails } from './types';
import { DetailField, DetailGrid, KeyValueTable, labelEntries } from './DetailRows';
import { formatBytes } from './format';

/**
 * Volumes had no details view at all — the list shows name, driver, size and
 * mountpoint, which leaves the two things you actually need when a volume is
 * misbehaving unanswered: which containers have it mounted, and what driver
 * options it was created with. The first comes from the caller (it already
 * has the container-derived usage index, see usage.ts); the rest from
 * `volume_details`.
 */
export function VolumeDetailsDialog({ open, onOpenChange, connection, name, users }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  name: string | null;
  /** Names of the containers mounting this volume, from the usage index. */
  users?: string[];
}) {
  const [details, setDetails] = useState<VolumeDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !name) { setDetails(null); return; }
    setLoading(true);
    setError(null);
    containerApi.volumeDetails(connection, name)
      .then(setDetails)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, name, connection]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">{details?.name ?? name ?? ''}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
          {loading && <LoadingRow />}
          {error && <Callout tone="error">{error}</Callout>}
          {details && !loading && (
            <>
              <DetailGrid>
                <DetailField label="Driver" value={details.driver} mono />
                <DetailField label="Scope" value={details.scope || '—'} />
                <DetailField label="Created" value={details.createdAt ? new Date(details.createdAt).toLocaleString() : '—'} />
                <DetailField
                  label="Size"
                  value={details.sizeBytes === undefined || details.sizeBytes === null ? '—' : formatBytes(details.sizeBytes)}
                />
                <DetailField label="Used by" value={users && users.length > 0 ? `${users.length} container(s)` : 'nothing'} />
                <DetailField
                  className="col-span-full"
                  label="Mountpoint"
                  value={details.mountpoint}
                  mono
                  copy={details.mountpoint}
                />
              </DetailGrid>

              {users && users.length > 0 && (
                <CollapsibleSection title="Mounted by" variant="bordered" defaultOpen hint={`${users.length}`}>
                  <ul className="space-y-0.5">
                    {users.map((u) => <li key={u} className="font-mono text-xs">{u}</li>)}
                  </ul>
                </CollapsibleSection>
              )}

              <CollapsibleSection title="Driver options" variant="bordered" defaultOpen={false} hint={`${Object.keys(details.options).length}`}>
                <KeyValueTable entries={labelEntries(details.options)} />
              </CollapsibleSection>

              <CollapsibleSection title="Labels" variant="bordered" defaultOpen={false} hint={`${Object.keys(details.labels).length}`}>
                <KeyValueTable entries={labelEntries(details.labels)} />
              </CollapsibleSection>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
