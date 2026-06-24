import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { kafkaApi, type GroupLag } from './types';

interface ConsumersTabProps {
  brokerId: string;
  topic: string;
  onSelectGroup: (groupId: string) => void;
}

// Consumer groups are fetched only when this tab is opened (it's mounted
// lazily by TopicView), and only re-fetched when the user clicks Refresh —
// never automatically, since the scan asks every group for its offsets.
export function ConsumersTab({ brokerId, topic, onSelectGroup }: ConsumersTabProps) {
  const [groups, setGroups] = useState<GroupLag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    kafkaApi.topicConsumerGroups(brokerId, topic)
      .then(setGroups)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

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

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between px-4 py-1.5 border-b bg-muted/10 sticky top-0">
        <span className="text-xs text-muted-foreground">{groups.length} assignment{groups.length !== 1 ? 's' : ''}</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/20 sticky top-0">
        <span>Group</span>
        <span className="text-right">Part</span>
        <span className="text-right">Committed</span>
        <span className="text-right">Latest</span>
        <span className="text-right">Lag</span>
      </div>
      {groups.map((g, i) => {
        const lagColor = g.lag < 0
          ? 'text-muted-foreground'
          : g.lag === 0
          ? 'text-green-600'
          : 'text-orange-500';
        const latest = g.lag >= 0 && g.committedOffset >= 0 ? g.committedOffset + g.lag : -1;

        return (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2 border-b border-border/40 text-sm"
          >
            <button
              className="text-left font-mono text-xs truncate hover:text-primary hover:underline"
              onClick={() => onSelectGroup(g.groupId)}
              title={`View group: ${g.groupId}`}
            >
              {g.groupId}
            </button>
            <span className="text-right text-xs text-muted-foreground tabular-nums">{g.partition}</span>
            <span className="text-right font-mono text-xs tabular-nums">
              {g.committedOffset >= 0 ? g.committedOffset.toLocaleString() : '—'}
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
              {latest >= 0 ? latest.toLocaleString() : '—'}
            </span>
            <span className={`text-right font-mono text-xs tabular-nums ${lagColor}`}>
              {g.lag >= 0 ? g.lag.toLocaleString() : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
