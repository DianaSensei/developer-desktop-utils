import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, ChevronRight, Server, Radio, Send, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingRow, Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { kafkaApi, type TopicDetails } from './types';
import { PropertiesTab } from './PropertiesTab';
import { MessagesTab } from './MessagesTab';
import { ConfigTab } from './ConfigTab';
import { ConsumersTab } from './ConsumersTab';
import type { KafkaTab } from './useKafkaState';

const TABS: { id: KafkaTab; label: string }[] = [
  { id: 'data', label: 'Messages' },
  { id: 'properties', label: 'Properties' },
  { id: 'config', label: 'Config' },
  { id: 'consumers', label: 'Consumers' },
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
  onConsume: () => void;
  onProduce: () => void;
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
  onConsume,
  onProduce,
  onBackToTopics,
}: TopicViewProps) {
  // Tolerate a stale persisted tab (e.g. the removed 'produce').
  const activeTab: KafkaTab = TABS.some((t) => t.id === selectedTab) ? selectedTab : 'data';
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
          <button onClick={onBackToTopics} className="text-fg-mute hover:text-fg shrink-0" title="Back to topics">
            <ArrowLeft className="h-4 w-4" />
          </button>
          {brokerName && (
            <>
              <span className="flex items-center gap-1 text-fg-mute shrink-0">
                <Server className="w-3.5 h-3.5" />
                <span className="truncate max-w-[10rem]">{brokerName}</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-fg-mute/50 shrink-0" />
            </>
          )}
          <button
            onClick={onBackToTopics}
            className="font-mono font-semibold truncate hover:text-acc transition-colors"
            title="Back to topics"
          >
            {topic}
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-fg-mute/50 shrink-0" />
          <span className="text-fg-mute shrink-0">{TABS.find((t) => t.id === activeTab)?.label}</span>
          {data && (
            <span className="ml-2 text-xs text-fg-mute shrink-0 hidden sm:inline">
              {data.partitions.length}p · RF {data.replicationFactor}
            </span>
          )}
          {loading && <Spinner size="sm" className="text-fg-mute" />}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Produce / Consume open the global panels pre-targeted at this topic. */}
          <Button variant="outline" size="sm" className="h-ctl gap-1 text-xs rounded-sm" onClick={onProduce} title="Produce a message to this topic">
            <Send className="w-3 h-3" /> Produce
          </Button>
          <Button variant="outline" size="sm" className="h-ctl gap-1 text-xs rounded-sm" onClick={onConsume} title="Watch this topic in realtime">
            <Radio className="w-3 h-3" /> Consume
          </Button>
          <Button variant="ghost" size="sm" className="h-ctl gap-1 text-xs rounded-sm" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
        </div>
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
              activeTab === tab.id
                ? 'border-acc text-fg'
                : 'border-transparent text-fg-mute hover:text-fg',
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
          <LoadingRow label="Loading topic details…" className="px-4 py-8" />
        ) : data ? (
          <>
            {activeTab === 'properties' && (
              <div className="h-full overflow-y-auto">
                <PropertiesTab details={data} />
              </div>
            )}
            {activeTab === 'data' && (
              <MessagesTab brokerId={brokerId} topic={topic} partitions={data.partitions} />
            )}
            {activeTab === 'config' && (
              <ConfigTab brokerId={brokerId} topic={topic} />
            )}
            {activeTab === 'consumers' && (
              <div className="h-full overflow-y-auto">
                <ConsumersTab brokerId={brokerId} topic={topic} onSelectGroup={onSelectGroup} />
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
