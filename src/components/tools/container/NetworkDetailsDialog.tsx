import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Badge } from '@/components/ui/badge';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { containerApi, type ContainerConnection, type NetworkDetails, type NetworkInfo } from './types';
import { DetailField, DetailGrid, KeyValueTable, labelEntries } from './DetailRows';

/**
 * The subnet, gateway and attached containers are what anyone opens a network
 * for — "why can't these two containers reach each other" is answered here or
 * not at all. Attachments come from the caller's container-derived usage index
 * rather than from the inspect payload; see network_details in
 * container_tool.rs for why.
 */
export function NetworkDetailsDialog({ open, onOpenChange, connection, network, users }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  network: NetworkInfo | null;
  users?: string[];
}) {
  const [details, setDetails] = useState<NetworkDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !network) { setDetails(null); return; }
    setLoading(true);
    setError(null);
    containerApi.networkDetails(connection, network.Id)
      .then(setDetails)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, network, connection]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{details?.name ?? network?.Name ?? ''}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
          {loading && <LoadingRow />}
          {error && <Callout tone="error">{error}</Callout>}
          {details && !loading && (
            <>
              <DetailGrid>
                <DetailField label="Driver" value={details.driver || '—'} mono />
                <DetailField label="Scope" value={details.scope || '—'} />
                <DetailField label="Network ID" value={details.id.slice(0, 12)} mono copy={details.id} />
                <DetailField label="Created" value={details.created ? new Date(details.created).toLocaleString() : '—'} />
                <DetailField label="IPAM driver" value={details.ipamDriver || '—'} mono />
                <DetailField label="Attached" value={users && users.length > 0 ? `${users.length} container(s)` : 'nothing'} />
                <DetailField
                  className="col-span-full"
                  label="Flags"
                  value={(
                    <span className="flex flex-wrap gap-1">
                      {details.internal && <Badge tone="neutral">internal</Badge>}
                      {details.attachable && <Badge tone="neutral">attachable</Badge>}
                      {details.ingress && <Badge tone="neutral">ingress</Badge>}
                      {details.ipv6 && <Badge tone="neutral">IPv6</Badge>}
                      {!details.internal && !details.attachable && !details.ingress && !details.ipv6 && (
                        <span className="text-xs text-fg-mute">none</span>
                      )}
                    </span>
                  )}
                />
              </DetailGrid>

              {details.ipamConfig.length > 0 && (
                <CollapsibleSection title="Address pools" variant="bordered" defaultOpen hint={`${details.ipamConfig.length}`}>
                  <DataTable density="compact">
                    <Thead><Tr><Th>Subnet</Th><Th>Gateway</Th><Th>IP range</Th></Tr></Thead>
                    <Tbody>
                      {details.ipamConfig.map((c, i) => (
                        <Tr key={c.subnet ?? i}>
                          <Td mono>{c.subnet || '—'}</Td>
                          <Td mono>{c.gateway || '—'}</Td>
                          <Td mono>{c.ipRange || '—'}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </DataTable>
                </CollapsibleSection>
              )}

              {users && users.length > 0 && (
                <CollapsibleSection title="Attached containers" variant="bordered" defaultOpen hint={`${users.length}`}>
                  <ul className="space-y-0.5">
                    {users.map((u) => <li key={u} className="font-mono text-xs">{u}</li>)}
                  </ul>
                </CollapsibleSection>
              )}

              <CollapsibleSection title="Options" variant="bordered" defaultOpen={false} hint={`${Object.keys(details.options).length}`}>
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
