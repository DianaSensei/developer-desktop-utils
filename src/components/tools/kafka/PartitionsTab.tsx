import type { PartitionInfo } from './types';

interface PartitionsTabProps {
  partitions: PartitionInfo[];
}

export function PartitionsTab({ partitions }: PartitionsTabProps) {
  if (partitions.length === 0) {
    return <div className="px-4 py-8 text-sm text-muted-foreground text-center">No partition data</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-6 px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/20 sticky top-0">
        <span>Partition</span>
        <span className="text-right">Earliest Offset</span>
        <span className="text-right">Latest Offset</span>
        <span className="text-right">Messages</span>
      </div>
      {partitions.map((p) => {
        const count = p.latestOffset >= 0 && p.earliestOffset >= 0
          ? p.latestOffset - p.earliestOffset
          : -1;
        return (
          <div
            key={p.id}
            className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-6 px-4 py-2 border-b border-border/40 text-sm"
          >
            <span className="text-muted-foreground tabular-nums font-mono text-xs">{p.id}</span>
            <span className="text-right tabular-nums font-mono text-xs">
              {p.earliestOffset >= 0 ? p.earliestOffset.toLocaleString() : '—'}
            </span>
            <span className="text-right tabular-nums font-mono text-xs">
              {p.latestOffset >= 0 ? p.latestOffset.toLocaleString() : '—'}
            </span>
            <span className="text-right tabular-nums font-mono text-xs text-muted-foreground">
              {count >= 0 ? count.toLocaleString() : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
