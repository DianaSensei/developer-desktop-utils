import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { kafkaApi, type TopicConfig } from './types';

interface ConfigTabProps {
  brokerId: string;
  topic: string;
}

export function ConfigTab({ brokerId, topic }: ConfigTabProps) {
  const [configs, setConfigs] = useState<TopicConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    kafkaApi.topicConfigs(brokerId, topic)
      .then(setConfigs)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [brokerId, topic]);

  const filtered = filter
    ? configs.filter(
        (c) =>
          c.name.toLowerCase().includes(filter.toLowerCase()) ||
          (c.value ?? '').toLowerCase().includes(filter.toLowerCase()),
      )
    : configs;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span className="break-all">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 bg-muted/10">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter name or value…"
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
        />
        {filter && (
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {filtered.length} of {configs.length}
          </span>
        )}
      </div>

      {/* Config table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Sticky header */}
        <div
          className="grid gap-4 px-4 py-2 text-xs font-semibold text-muted-foreground border-b bg-muted/20 sticky top-0"
          style={{ gridTemplateColumns: '1fr 1fr' }}
        >
          <span>Name</span>
          <span>Value</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground text-center">No matching configs</div>
        ) : (
          filtered.map((c, i) => (
            <div
              key={c.name}
              className={cn(
                'grid gap-4 px-4 py-1.5 text-xs border-b border-border/30 hover:bg-muted/20',
                i % 2 === 1 && 'bg-muted/5',
              )}
              style={{ gridTemplateColumns: '1fr 1fr' }}
            >
              <span className="font-mono">{c.name}</span>
              <span className={cn('font-mono', c.value === null ? 'text-muted-foreground/50 italic' : 'text-muted-foreground')}>
                {c.value ?? '(null)'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
