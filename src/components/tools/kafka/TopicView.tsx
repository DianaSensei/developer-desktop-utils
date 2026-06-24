import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, ChevronRight, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { kafkaApi, type TopicDetails } from './types';
import { PropertiesTab } from './PropertiesTab';
import { MessagesTab } from './MessagesTab';
import { ConfigTab } from './ConfigTab';
import { ConsumersTab } from './ConsumersTab';
import { ProduceTab } from './ProduceTab';
import type { KafkaTab } from './useKafkaState';

const TABS: { id: KafkaTab; label: string }[] = [
  { id: 'data', label: 'Messages' },
  { id: 'properties', label: 'Properties' },
  { id: 'config', label: 'Config' },
  { id: 'consumers', label: 'Consumers' },
  { id: 'produce', label: 'Produce' },
];

interface TopicViewProps {
  brokerId: string;
  brokerName?: string;
  topic: string;
  refreshKey: number;
  selectedTab: KafkaTab;
  onSelectTab: (tab: KafkaTab) => void;
  onRefresh: () => void;
  onSelectGroup: (groupId: string) => void;
  onBackToTopics?: () => void;
}

export function TopicView({
  brokerId,
  brokerName,
  topic,
  refreshKey,
  selectedTab,
  onSelectTab,
  onRefresh,
  onSelectGroup,
  onBackToTopics,
}: TopicViewProps) {
  const [data, setData] = useState<TopicDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!brokerId || !topic) return;
    setLoading(true);
    setError('');
    kafkaApi.topicDetails(brokerId, topic)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [brokerId, topic, refreshKey]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — breadcrumb: Broker › Topic › Tab */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          {brokerName && (
            <>
              <span className="flex items-center gap-1 text-muted-foreground shrink-0">
                <Server className="w-3.5 h-3.5" />
                <span className="truncate max-w-[10rem]">{brokerName}</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            </>
          )}
          <button
            onClick={onBackToTopics}
            className="font-mono font-semibold truncate hover:text-primary transition-colors"
            title="Back to topics"
          >
            {topic}
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-muted-foreground shrink-0">{TABS.find((t) => t.id === selectedTab)?.label}</span>
          {data && (
            <span className="ml-2 text-xs text-muted-foreground shrink-0 hidden sm:inline">
              {data.partitions.length}p · RF {data.replicationFactor}
            </span>
          )}
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs rounded-lg shrink-0" onClick={onRefresh}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Error */}
      {!loading && error && (
        <div className="flex items-start gap-2 px-4 py-3 text-sm text-destructive border-b shrink-0">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 px-2 gap-0 overflow-x-auto no-scrollbar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              'px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap shrink-0',
              selectedTab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {loading && !data ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading topic details…
          </div>
        ) : data ? (
          <>
            {selectedTab === 'properties' && (
              <div className="h-full overflow-y-auto">
                <PropertiesTab details={data} />
              </div>
            )}
            {selectedTab === 'data' && (
              <MessagesTab brokerId={brokerId} topic={topic} partitions={data.partitions} />
            )}
            {selectedTab === 'config' && (
              <ConfigTab brokerId={brokerId} topic={topic} />
            )}
            {selectedTab === 'consumers' && (
              <div className="h-full overflow-y-auto">
                <ConsumersTab brokerId={brokerId} topic={topic} onSelectGroup={onSelectGroup} />
              </div>
            )}
            {selectedTab === 'produce' && (
              <ProduceTab brokerId={brokerId} topic={topic} partitions={data.partitions} />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
