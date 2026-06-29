import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ViewHeader } from '@/components/ui/view-header';
import { kafkaApi, type GroupSummary } from './types';

const STATE_DOT: Record<string, string> = {
  Stable: 'bg-emerald-500',
  Empty: 'bg-muted-foreground/40',
  Dead: 'bg-destructive',
  PreparingRebalance: 'bg-orange-500',
  CompletingRebalance: 'bg-yellow-500',
};

interface GroupListViewProps {
  brokerId: string;
  refreshKey: number;
  onRefresh: () => void;
  onSelectGroup: (id: string) => void;
}

export function GroupListView({ brokerId, refreshKey, onRefresh, onSelectGroup }: GroupListViewProps) {
  const [filter, setFilter] = useState('');
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    kafkaApi.listGroups(brokerId)
      .then((g) => setGroups(g.sort((a, b) => a.groupId.localeCompare(b.groupId))))
      .catch((e) => { setGroups([]); setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => setLoading(false));
  }, [brokerId, refreshKey]);

  const f = filter.trim().toLowerCase();
  const rows = (groups ?? []).filter((g) => g.groupId.toLowerCase().includes(f));

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Users}
        title="Consumer groups"
        subtitle={groups ? `${groups.length} groups` : 'Kafka cluster'}
        actions={<Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>}
      />

      <div className="px-5 pt-3 shrink-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search groups…" className="pl-8 h-8 text-sm" />
        </div>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && !groups && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{error}</span>
          </div>
        )}
        {groups && !error && (
          rows.length === 0
            ? <p className="text-sm text-muted-foreground">{f ? 'No matching groups.' : 'No consumer groups.'}</p>
            : (
              <div className="overflow-x-auto rounded-xl border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20 border-b border-border/50">
                    <tr>
                      <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Group</th>
                      <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">State</th>
                      <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Protocol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((g) => (
                      <tr key={g.groupId} className="hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => onSelectGroup(g.groupId)}>
                        <td className="px-3.5 py-2.5 font-mono">{g.groupId}</td>
                        <td className="px-3.5 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[g.state] ?? 'bg-muted-foreground/40')} />
                            {g.state || '—'}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-muted-foreground">{g.protocolType || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </div>
  );
}
