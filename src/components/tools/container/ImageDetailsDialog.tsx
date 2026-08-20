import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Badge } from '@/components/ui/badge';
import { containerApi, type ContainerConnection, type ImageDetails, type ImageSummary } from './types';
import { DetailField, DetailGrid, KeyValueTable, envEntries, labelEntries } from './DetailRows';
import { formatBytes } from './format';

export function ImageDetailsDialog({ open, onOpenChange, connection, image }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  image: ImageSummary | null;
}) {
  const [details, setDetails] = useState<ImageDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !image) { setDetails(null); return; }
    setLoading(true);
    setError(null);
    containerApi.imageDetails(connection, image.Id)
      .then(setDetails)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, image, connection]);

  const title = (details?.repoTags[0]) ?? image?.Id.replace('sha256:', '').slice(0, 12) ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
          {loading && <LoadingRow />}
          {error && <Callout tone="error">{error}</Callout>}
          {details && !loading && (
            <>
              <DetailGrid>
                <DetailField label="Image ID" value={details.id.replace('sha256:', '').slice(0, 20)} mono copy={details.id} />
                <DetailField label="Size" value={formatBytes(details.size)} />
                <DetailField label="Layers" value={details.layerCount} />
                <DetailField label="Created" value={details.created ? new Date(details.created).toLocaleString() : '—'} />
                <DetailField label="Architecture" value={[details.architecture, details.os].filter(Boolean).join(' / ') || '—'} />
                <DetailField label="Author" value={details.author || '—'} />
                {details.workingDir && <DetailField label="Working dir" value={details.workingDir} mono />}
              </DetailGrid>

              {details.repoTags.length > 1 && (
                <DetailField
                  label="All tags"
                  value={(
                    <div className="flex flex-wrap gap-1">
                      {details.repoTags.map((t) => <Badge key={t} mono>{t}</Badge>)}
                    </div>
                  )}
                />
              )}

              {(details.entrypoint.length > 0 || details.cmd.length > 0) && (
                <DetailGrid>
                  {details.entrypoint.length > 0 && (
                    <DetailField className="col-span-full" label="Entrypoint" value={details.entrypoint.join(' ')} mono copy={details.entrypoint.join(' ')} />
                  )}
                  {details.cmd.length > 0 && (
                    <DetailField className="col-span-full" label="Command" value={details.cmd.join(' ')} mono copy={details.cmd.join(' ')} />
                  )}
                </DetailGrid>
              )}

              {details.exposedPorts.length > 0 && (
                <DetailField
                  label="Exposed ports"
                  value={(
                    <div className="flex flex-wrap gap-1">
                      {details.exposedPorts.map((p) => <Badge key={p} mono>{p}</Badge>)}
                    </div>
                  )}
                />
              )}

              <CollapsibleSection title="Environment" variant="bordered" defaultOpen={false} hint={`${details.env.length}`}>
                <KeyValueTable entries={envEntries(details.env)} />
              </CollapsibleSection>

              <CollapsibleSection title="Labels" variant="bordered" defaultOpen={false} hint={`${Object.keys(details.labels).length}`}>
                <KeyValueTable entries={labelEntries(details.labels)} />
              </CollapsibleSection>

              {details.repoDigests.length > 0 && (
                <CollapsibleSection title="Digests" variant="bordered" defaultOpen={false} hint={`${details.repoDigests.length}`}>
                  <div className="space-y-1">
                    {details.repoDigests.map((d) => (
                      <p key={d} className="font-mono text-[11px] break-all text-fg-mute">{d}</p>
                    ))}
                  </div>
                </CollapsibleSection>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
