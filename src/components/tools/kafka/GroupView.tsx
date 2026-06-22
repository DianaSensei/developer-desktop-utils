import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { kafkaApi, type GroupDetails } from './types';

interface GroupViewProps {
  brokerId: string;
  groupId: string;
  refreshKey: number;
  onRefresh: () => void;
  onSelectTopic: (topic: string) => void;
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

  useEffect(() => {
    if (!brokerId || !groupId) return;
    setLoading(true);
    setError('');
    kafkaApi.groupDetails(brokerId, groupId)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [brokerId, groupId, refreshKey]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
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
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onRefresh}>
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
            {data.assignments.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center">
                No committed offsets — group may not be active yet
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-1.5 text-xs font-medium text-muted-foreground border-b bg-muted/10 sticky top-0">
                  <span>Topic</span>
                  <span className="text-right">Part</span>
                  <span className="text-right">Committed</span>
                  <span className="text-right">Latest</span>
                  <span className="text-right">Lag</span>
                </div>

                {data.assignments.map((a, i) => {
                  const lagColor = a.lag < 0
                    ? 'text-muted-foreground'
                    : a.lag === 0
                    ? 'text-green-600'
                    : 'text-orange-500';

                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-1.5 border-b border-border/40 text-sm"
                    >
                      <button
                        className="text-left font-mono text-xs truncate hover:text-primary hover:underline"
                        onClick={() => onSelectTopic(a.topic)}
                        title={`Browse topic: ${a.topic}`}
                      >
                        {a.topic}
                      </button>
                      <span className="text-right text-xs text-muted-foreground tabular-nums">{a.partition}</span>
                      <span className="text-right font-mono text-xs tabular-nums">
                        {a.committedOffset >= 0 ? a.committedOffset.toLocaleString() : '—'}
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {/* latest = committed + lag */}
                        {a.lag >= 0 && a.committedOffset >= 0
                          ? (a.committedOffset + a.lag).toLocaleString()
                          : '—'}
                      </span>
                      <span className={`text-right font-mono text-xs tabular-nums ${lagColor}`}>
                        {a.lag >= 0 ? a.lag.toLocaleString() : '—'}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
