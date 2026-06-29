import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Search, Plus, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ViewHeader } from '@/components/ui/view-header';
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
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search topics…" className="pl-8 h-8 text-sm" />
        </div>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && !topics && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{error}</span>
          </div>
        )}
        {topics && !error && (
          rows.length === 0
            ? <p className="text-sm text-muted-foreground">{f ? 'No matching topics.' : 'No topics yet.'}</p>
            : (
              <div className="overflow-x-auto rounded-xl border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20 border-b border-border/50">
                    <tr>
                      <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-3.5 py-2 text-right font-medium text-muted-foreground">Partitions</th>
                      <th className="px-3.5 py-2 text-right font-medium text-muted-foreground">Replication</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((t) => (
                      <tr key={t.name} className="hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => onSelectTopic(t.name)}>
                        <td className="px-3.5 py-2.5 font-mono">{t.name}</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{t.partitionCount}</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{t.replicationFactor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          <div>
            <Label htmlFor="kf-newt" className="text-xs">Name</Label>
            <Input
              id="kf-newt" value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              placeholder="my.topic" autoFocus className="mt-1 font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="kf-parts" className="text-xs">Partitions</Label>
              <Input id="kf-parts" type="number" min={1} value={partitions} onChange={(e) => setPartitions(e.target.value)} className="mt-1 h-9" />
            </div>
            <div>
              <Label htmlFor="kf-rf" className="text-xs">Replication factor</Label>
              <Input id="kf-rf" type="number" min={1} value={rf} onChange={(e) => setRf(e.target.value)} className="mt-1 h-9" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
