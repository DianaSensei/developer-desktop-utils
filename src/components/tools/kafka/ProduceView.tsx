import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, AlertCircle, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { kafkaApi, type TopicDetails } from './types';
import { ProduceTab } from './ProduceTab';
import type { TopicPrefill } from './useKafkaState';

interface ProduceViewProps {
  brokerId: string;
  refreshKey: number;
  onRefresh: () => void;
  prefill?: TopicPrefill | null;
}

/**
 * The single produce surface for the tool. Pick (or type) a topic, then the
 * produce form for it. Entry points (a topic's Produce button) open this panel
 * pre-filled via `prefill` — mirroring the RabbitMQ tool's Send/Request panel.
 */
export function ProduceView({ brokerId, refreshKey, onRefresh, prefill }: ProduceViewProps) {
  const [topic, setTopic] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [details, setDetails] = useState<TopicDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    kafkaApi.listTopics(brokerId)
      .then((ts) => { if (alive) setTopics(ts.map((t) => t.name).sort((a, b) => a.localeCompare(b))); })
      .catch(() => { if (alive) setTopics([]); });
    return () => { alive = false; };
  }, [brokerId, refreshKey]);

  useEffect(() => {
    if (prefill?.topic) setTopic(prefill.topic);
  }, [prefill?.token]);

  // Load partition metadata for the chosen topic (the produce form needs it).
  useEffect(() => {
    const t = topic.trim();
    if (!t) { setDetails(null); setError(null); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    kafkaApi.topicDetails(brokerId, t)
      .then((d) => { if (alive) setDetails(d); })
      .catch((e) => { if (alive) { setDetails(null); setError(String(e instanceof Error ? e.message : e)); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [brokerId, topic, refreshKey]);

  return (
    <div className="tool-full-height">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Send className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">Produce</h2>
            <p className="text-[11px] text-muted-foreground">Send a message to a topic</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>

      <div className="tool-scrollable px-5 py-5">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          <div>
            <Label className="text-xs">Topic</Label>
            <TopicCombobox value={topic} topics={topics} onChange={setTopic} />
            {loading && <p className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading partitions…</p>}
            {error && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{error}</span>
              </div>
            )}
          </div>

          {details
            ? <ProduceTab key={`${brokerId}:${details.name}`} brokerId={brokerId} topic={details.name} partitions={details.partitions} />
            : !loading && <p className="text-sm text-muted-foreground">Pick or type a topic above to produce a message.</p>}
        </div>
      </div>
    </div>
  );
}

/** Searchable topic picker that also accepts a typed (custom) topic name. */
function TopicCombobox({ value, topics, onChange }: {
  value: string; topics: string[]; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = value.trim().toLowerCase();
  const matches = topics.filter((t) => t.toLowerCase().includes(q)).slice(0, 50);

  const pick = (v: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="relative mt-1">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="topic name — type to search"
        className="font-mono text-sm h-9"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md-premium max-h-64 overflow-y-auto py-1">
          {matches.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(t); }}
              className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/60', value === t && 'text-primary')}
            >
              <span className="font-mono text-sm flex-1 truncate">{t}</span>
              {value === t && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
