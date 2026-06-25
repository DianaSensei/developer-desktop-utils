import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { kafkaApi, type GroupLag } from './types';

interface ConsumersTabProps {
  brokerId: string;
  topic: string;
  onSelectGroup: (groupId: string) => void;
}

// Group per-partition lag rows by consumer group, preserving order.
function groupByGroup(rows: GroupLag[]): [string, GroupLag[]][] {
  const byGroup = new Map<string, GroupLag[]>();
  for (const r of rows) {
    const arr = byGroup.get(r.groupId);
    if (arr) arr.push(r);
    else byGroup.set(r.groupId, [r]);
  }
  return [...byGroup.entries()];
}

// Consumer groups are fetched only when this tab is opened (it's mounted
// lazily by TopicView), and only re-fetched when the user clicks Refresh —
// never automatically, since the scan asks every group for its offsets.
export function ConsumersTab({ brokerId, topic, onSelectGroup }: ConsumersTabProps) {
  const [groups, setGroups] = useState<GroupLag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Consumer groups expanded in the list. Collapsed by default.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    setError('');
    kafkaApi.topicConsumerGroups(brokerId, topic)
      .then((g) => {
        setGroups(g);
        setExpanded(new Set());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const toggleGroup = (groupId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });

  // Load once when the tab first opens for this topic.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerId, topic]);

  if (loading && !groups) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Scanning consumer groups…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
        <Button variant="outline" size="sm" className="mt-3 h-8 gap-1.5 text-xs" onClick={load}>
          <RefreshCw className="w-3 h-3" /> Retry
        </Button>
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">No consumer groups committed to this topic</p>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
    );
  }

  const grouped = groupByGroup(groups);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between px-4 py-1.5 border-b bg-muted/10 sticky top-0">
        <span className="text-xs text-muted-foreground">
          {grouped.length} group{grouped.length !== 1 ? 's' : ''}
        </span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {grouped.map(([groupId, parts]) => {
        const open = expanded.has(groupId);
        const totalLag = parts.reduce((s, p) => s + (p.lag > 0 ? p.lag : 0), 0);
        const hasLag = parts.some((p) => p.lag > 0);
        return (
          <div key={groupId} className="border-b border-border/40">
            {/* Group header — toggles partition detail; group name opens the group */}
            <div
              className="flex items-center gap-2 px-4 py-2 hover:bg-muted/15 cursor-pointer select-none"
              onClick={() => toggleGroup(groupId)}
            >
              {open
                ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
              <button
                className="font-mono text-xs truncate flex-1 text-left hover:text-primary hover:underline"
                onClick={(e) => { e.stopPropagation(); onSelectGroup(groupId); }}
                title={`View group: ${groupId}`}
              >
                {groupId}
              </button>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {parts.length} part{parts.length !== 1 ? 's' : ''}
              </span>
              <span className={`text-xs font-mono tabular-nums w-24 text-right shrink-0 ${hasLag ? 'text-orange-500' : 'text-green-600'}`}>
                lag {totalLag.toLocaleString()}
              </span>
            </div>

            {open && (
              <div className="pb-1">
                {/* Per-partition column headers */}
                <div className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem_5.5rem] gap-x-3 pl-9 pr-4 py-1 text-[11px] font-medium text-muted-foreground bg-muted/10">
                  <span className="text-right">Part</span>
                  <span className="text-right">Committed</span>
                  <span className="text-right">Latest</span>
                  <span className="text-right">Lag</span>
                </div>

                {parts.map((p) => {
                  const lagColor = p.lag < 0
                    ? 'text-muted-foreground'
                    : p.lag === 0
                    ? 'text-green-600'
                    : 'text-orange-500';
                  const latest = p.lag >= 0 && p.committedOffset >= 0 ? p.committedOffset + p.lag : -1;

                  return (
                    <div
                      key={p.partition}
                      className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem_5.5rem] gap-x-3 pl-9 pr-4 py-1.5 border-t border-border/20 text-sm"
                    >
                      <span className="text-right text-xs text-muted-foreground tabular-nums">{p.partition}</span>
                      <span className="text-right font-mono text-xs tabular-nums">
                        {p.committedOffset >= 0 ? p.committedOffset.toLocaleString() : '—'}
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {latest >= 0 ? latest.toLocaleString() : '—'}
                      </span>
                      <span className={`text-right font-mono text-xs tabular-nums ${lagColor}`}>
                        {p.lag >= 0 ? p.lag.toLocaleString() : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
