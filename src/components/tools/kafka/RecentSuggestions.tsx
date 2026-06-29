import { Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { kafkaInputHistory, type KafkaHistoryField } from './kafkaInputHistoryStore';

/**
 * The "Recent" group at the top of a topic/key combobox: each remembered value
 * with a clock marker and a hover × to forget it. Renders nothing when there's
 * no history. Callers pass the already-filtered `items` (via
 * `useKafkaRecentMatches`) and dedupe their own suggestions against them.
 */
export function RecentSuggestions({ items, brokerId, field, value, onPick }: {
  items: string[];
  brokerId: string;
  field: KafkaHistoryField;
  value: string;
  onPick: (v: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-b border-border/40 py-1">
      <div className="px-2.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Recent</div>
      {items.map((v) => (
        <div
          key={v}
          role="button"
          tabIndex={0}
          onMouseDown={(e) => { e.preventDefault(); onPick(v); }}
          className={cn('group/recent w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer hover:bg-muted/60', value === v && 'text-primary')}
        >
          <Clock className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="font-mono text-sm flex-1 truncate">{v}</span>
          <span
            role="button"
            tabIndex={-1}
            title="Remove from history"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); kafkaInputHistory.remove(brokerId, field, v); }}
            className="shrink-0 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover/recent:opacity-100 transition-opacity"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        </div>
      ))}
    </div>
  );
}
