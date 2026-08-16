import { useEffect, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { kafkaApi, type GroupSummary } from './types';

const STATE_TONE: Record<string, StatusDotTone> = {
  Stable: 'live',
  Empty: 'idle',
  Dead: 'error',
  PreparingRebalance: 'starting',
  CompletingRebalance: 'starting',
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
        <SearchInput value={filter} onChange={setFilter} placeholder="Search groups…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && !groups && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}
        {groups && !error && (
          rows.length === 0
            ? <p className="text-sm text-muted-foreground">{f ? 'No matching groups.' : 'No consumer groups.'}</p>
            : (
              <DataTable>
                <Thead>
                  <Tr>
                    <Th>Group</Th>
                    <Th>State</Th>
                    <Th>Protocol</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((g) => (
                    <Tr key={g.groupId} interactive onClick={() => onSelectGroup(g.groupId)}>
                      <Td mono>{g.groupId}</Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot tone={STATE_TONE[g.state] ?? 'idle'} size="xs" />
                          {g.state || '—'}
                        </span>
                      </Td>
                      <Td className="text-muted-foreground">{g.protocolType || '—'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </DataTable>
            )
        )}
      </div>
    </div>
  );
}
