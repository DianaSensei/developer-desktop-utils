import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { kafkaApi, type GroupDetails, type Assignment } from './types';

interface GroupViewProps {
  brokerId: string;
  groupId: string;
  refreshKey: number;
  onRefresh: () => void;
  onSelectTopic: (topic: string) => void;
}

// Group assignments by topic, preserving the backend's topic/partition order.
function groupByTopic(assignments: Assignment[]): [string, Assignment[]][] {
  const byTopic = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const arr = byTopic.get(a.topic);
    if (arr) arr.push(a);
    else byTopic.set(a.topic, [a]);
  }
  return [...byTopic.entries()];
}

const STATE_STYLES: Record<string, string> = {
  Stable: 'text-green-600 bg-green-500/10',
  Empty: 'text-muted-foreground bg-muted/40',
  Dead: 'text-destructive bg-destructive/10',
  PreparingRebalance: 'text-orange-600 bg-orange-500/10',
  CompletingRebalance: 'text-yellow-600 bg-yellow-500/10',
};

export function GroupView({ brokerId, groupId, refreshKey, onRefresh, onSelectTopic }: GroupViewProps) {
  const [data, setData] = useState<GroupDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Topics expanded in the assignments view. Collapsed by default.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!brokerId || !groupId) return;
    setLoading(true);
    setError('');
    kafkaApi.groupDetails(brokerId, groupId)
      .then((d) => {
        setData(d);
        setExpanded(new Set());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [brokerId, groupId, refreshKey]);

  const toggleTopic = (topic: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(topic) ? next.delete(topic) : next.add(topic);
      return next;
    });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono font-semibold text-sm truncate">{groupId}</span>
          {data && (
            <>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATE_STYLES[data.state] ?? 'text-muted-foreground bg-muted/40'}`}>
                {data.state}
              </span>
              <span className="text-xs text-muted-foreground">{data.memberCount} member{data.memberCount !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs rounded-lg" onClick={onRefresh}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading group details…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Members */}
            {data.members.length > 0 && (
              <div className="border-b border-border/60">
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground bg-muted/15">
                  Members ({data.members.length})
                </div>
                <div className="divide-y divide-border/30">
                  {data.members.map((m) => (
                    <div key={m.memberId} className="px-4 py-1.5 flex items-center gap-3 text-xs min-w-0">
                      <span className="font-mono truncate flex-1" title={m.memberId}>{m.clientId || m.memberId}</span>
                      <span className="font-mono text-muted-foreground shrink-0">{m.clientHost}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.assignments.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center">
                No committed offsets — group may not be active yet
              </div>
            ) : (
              groupByTopic(data.assignments).map(([topic, parts]) => {
                const open = expanded.has(topic);
                const totalLag = parts.reduce((s, a) => s + (a.lag > 0 ? a.lag : 0), 0);
                const hasLag = parts.some((a) => a.lag > 0);
                return (
                  <div key={topic} className="border-b border-border/40">
                    {/* Topic header — toggles partition detail; topic name browses the topic */}
                    <div
                      className="flex items-center gap-2 px-4 py-2 hover:bg-muted/15 cursor-pointer select-none"
                      onClick={() => toggleTopic(topic)}
                    >
                      {open
                        ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                      <button
                        className="font-mono text-xs truncate flex-1 text-left hover:text-primary hover:underline"
                        onClick={(e) => { e.stopPropagation(); onSelectTopic(topic); }}
                        title={`Browse topic: ${topic}`}
                      >
                        {topic}
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
                        <div className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem_6.5rem_5.5rem] gap-x-3 pl-9 pr-4 py-1 text-[11px] font-medium text-muted-foreground bg-muted/10">
                          <span className="text-right">Part</span>
                          <span>Consumer</span>
                          <span className="text-right">Committed</span>
                          <span className="text-right">Latest</span>
                          <span className="text-right">Lag</span>
                        </div>

                        {parts.map((a) => {
                          const lagColor = a.lag < 0
                            ? 'text-muted-foreground'
                            : a.lag === 0
                            ? 'text-green-600'
                            : 'text-orange-500';
                          const latest = a.lag >= 0 && a.committedOffset >= 0
                            ? a.committedOffset + a.lag
                            : -1;

                          return (
                            <div
                              key={a.partition}
                              className="grid grid-cols-[3rem_minmax(0,1fr)_6.5rem_6.5rem_5.5rem] gap-x-3 pl-9 pr-4 py-1.5 border-t border-border/20 text-sm"
                            >
                              <span className="text-right text-xs text-muted-foreground tabular-nums">{a.partition}</span>
                              <span className="min-w-0 truncate text-xs" title={a.memberId ?? undefined}>
                                {a.clientId ? (
                                  <>
                                    <span className="font-mono">{a.clientId}</span>
                                    {a.clientHost && (
                                      <span className="text-muted-foreground font-mono"> {a.clientHost}</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-muted-foreground italic">unassigned</span>
                                )}
                              </span>
                              <span className="text-right font-mono text-xs tabular-nums">
                                {a.committedOffset >= 0 ? a.committedOffset.toLocaleString() : '—'}
                              </span>
                              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                                {latest >= 0 ? latest.toLocaleString() : '—'}
                              </span>
                              <span className={`text-right font-mono text-xs tabular-nums ${lagColor}`}>
                                {a.lag >= 0 ? a.lag.toLocaleString() : '—'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
