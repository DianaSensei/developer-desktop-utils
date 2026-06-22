import type { GroupLag } from './types';

interface ConsumersTabProps {
  consumerGroups: GroupLag[];
  onSelectGroup: (groupId: string) => void;
}

export function ConsumersTab({ consumerGroups, onSelectGroup }: ConsumersTabProps) {
  if (consumerGroups.length === 0) {
    return (
      <div className="px-4 py-8 text-sm text-muted-foreground text-center">
        No consumer groups committed to this topic
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/10 sticky top-0">
        <span>Group</span>
        <span className="text-right">Part</span>
        <span className="text-right">Committed</span>
        <span className="text-right">Latest</span>
        <span className="text-right">Lag</span>
      </div>
      {consumerGroups.map((g, i) => {
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
