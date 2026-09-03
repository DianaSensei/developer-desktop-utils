import { useEffect, useState } from 'react';
import { RefreshCw, Plus, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/tool-section';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { kafkaApi, type TopicSummary } from './types';

interface TopicListViewProps {
  brokerId: string;
  refreshKey: number;
  onRefresh: () => void;
  onSelectTopic: (name: string) => void;
}

export function TopicListView({ brokerId, refreshKey, onRefresh, onSelectTopic }: TopicListViewProps) {
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    kafkaApi.listTopics(brokerId)
      .then((t) => setTopics(t.sort((a, b) => a.name.localeCompare(b.name))))
      .catch((e) => { setTopics([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [brokerId, refreshKey]); // eslint-disable-line

  const f = filter.trim().toLowerCase();
  const rows = (topics ?? []).filter((t) => t.name.toLowerCase().includes(f));

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={List}
        title="Topics"
        subtitle={topics ? `${topics.length} topics` : 'Kafka cluster'}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New topic</Button>
            <Button variant="outline" size="sm" busy={loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search topics…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && !topics && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {topics && !error && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching topics.' : 'No topics yet.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th align="right">Partitions</Th>
                    <Th align="right">Replication</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((t) => (
                    <Tr key={t.name} interactive onClick={() => onSelectTopic(t.name)}>
                      <Td mono>{t.name}</Td>
                      <Td numeric>{t.partitionCount}</Td>
                      <Td numeric>{t.replicationFactor}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>

      <CreateTopicDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        brokerId={brokerId}
        onCreated={(name) => { load(); onSelectTopic(name); }}
      />
    </div>
  );
}

function CreateTopicDialog({ open, onOpenChange, brokerId, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; brokerId: string; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [partitions, setPartitions] = useState('1');
  const [rf, setRf] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) { setError('Topic name is required'); return; }
    const p = parseInt(partitions, 10);
    const r = parseInt(rf, 10);
    if (!(p >= 1)) { setError('Partitions must be ≥ 1'); return; }
    if (!(r >= 1)) { setError('Replication factor must be ≥ 1'); return; }
    setBusy(true);
    setError(null);
    try {
      await kafkaApi.createTopic(brokerId, name.trim(), p, r);
      onCreated(name.trim());
      onOpenChange(false);
      setName('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); setError(null); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New topic</DialogTitle>
          <DialogDescription>Create a topic on this cluster.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name" htmlFor="kf-newt">
            <Input
              id="kf-newt" value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              placeholder="my.topic" autoFocus className="font-mono text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Partitions" htmlFor="kf-parts">
              <Input id="kf-parts" type="number" min={1} value={partitions} onChange={(e) => setPartitions(e.target.value)} className="h-ctl" />
            </Field>
            <Field label="Replication factor" htmlFor="kf-rf">
              <Input id="kf-rf" type="number" min={1} value={rf} onChange={(e) => setRf(e.target.value)} className="h-ctl" />
            </Field>
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
