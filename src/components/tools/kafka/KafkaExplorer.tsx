import { useEffect, useState } from 'react';
import { Server, Info } from 'lucide-react';
import { LeftPanel } from './LeftPanel';
import { TopicListView } from './TopicListView';
import { GroupListView } from './GroupListView';
import { TopicView } from './TopicView';
import { GroupView } from './GroupView';
import { ConsumeView } from './ConsumeView';
import { ProduceView } from './ProduceView';
import { KafkaInfoModal } from './KafkaInfoModal';
import { ToolHeaderActions } from '@/components/ToolHeaderActions';
import { useKafkaState } from './useKafkaState';
import { kafkaApi } from './types';
import { kafkaConsumerStore } from './kafkaConsumerStore';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';

const LEFT_MIN = 180;
const LEFT_MAX = 520;
const LEFT_DEFAULT = 256;

export function KafkaExplorer() {
  const {
    selectedBrokerId,
    setSelectedBrokerId,
    view,
    selectedTopic,
    selectedGroup,
    selectedTab,
    setSelectedTab,
    consumePrefill,
    producePrefill,
    consumeDetailTopic,
    showTopics,
    showGroups,
    showConsumers,
    openConsumer,
    showProduce,
    selectTopic,
    selectGroup,
    refreshKey,
    refresh,
  } = useKafkaState();

  // Stop any realtime consumers when leaving the tool so nothing keeps running
  // in the background. They persist across view switches within the tool (the
  // store lives outside this component tree), but not after it unmounts.
  useEffect(() => () => { kafkaConsumerStore.stopAll(); }, []);

  const [infoDismissed, setInfoDismissed] = usePersistentState('devtool:kafka:info-dismissed', false);
  const [showInfo, setShowInfo] = useState(!infoDismissed);
  const [leftWidth, setLeftWidth] = usePersistentState('devtool:kafka:leftPanelWidth', LEFT_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);

  const [brokerName, setBrokerName] = useState('');
  useEffect(() => {
    if (!selectedBrokerId) { setBrokerName(''); return; }
    let alive = true;
    kafkaApi.listConfigs()
      .then((cfgs) => { if (alive) setBrokerName(cfgs.find((c) => c.id === selectedBrokerId)?.name ?? ''); })
      .catch(() => { if (alive) setBrokerName(''); });
    return () => { alive = false; };
  }, [selectedBrokerId, refreshKey]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    setIsResizing(true);

    const onMouseMove = (ev: MouseEvent) => {
      setLeftWidth(Math.min(Math.max(startWidth + ev.clientX - startX, LEFT_MIN), LEFT_MAX));
    };
    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className={cn('flex h-full min-h-0 overflow-hidden', isResizing && 'select-none cursor-col-resize')}>
      {/* Info button injected into the global tool header */}
      <ToolHeaderActions>
        <button
          onClick={() => setShowInfo(true)}
          title="How Kafka Explorer accesses your cluster"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Info className="h-4 w-4" />
        </button>
      </ToolHeaderActions>

      {/* Left panel — width is user-resizable and persisted */}
      <div
        className="shrink-0 flex flex-col h-full overflow-hidden"
        style={{ width: leftWidth }}
      >
        <LeftPanel
          selectedBrokerId={selectedBrokerId}
          onSelectBroker={setSelectedBrokerId}
          view={view}
          onShowTopics={showTopics}
          onShowGroups={showGroups}
          onShowConsumers={showConsumers}
          onOpenConsumer={openConsumer}
          onShowProduce={showProduce}
        />
      </div>

      {/* Resize handle — 5px wide hit zone, 1px visible line that thickens on hover/drag */}
      <div
        className="relative shrink-0 w-[5px] cursor-col-resize group z-10"
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setLeftWidth(LEFT_DEFAULT)}
        title="Drag to resize · Double-click to reset"
      >
        <div className={cn(
          'absolute inset-y-0 left-[2px] w-px bg-border transition-all duration-100',
          'group-hover:w-[3px] group-hover:left-[1px] group-hover:bg-primary/50',
          isResizing && 'w-[3px] left-[1px] bg-primary/70',
        )} />
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedBrokerId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Server className="w-8 h-8 opacity-30" />
            <p className="text-sm">Add a broker to get started</p>
          </div>
        ) : view === 'topic' && selectedTopic != null ? (
          <TopicView
            brokerId={selectedBrokerId}
            brokerName={brokerName}
            topic={selectedTopic}
            refreshKey={refreshKey}
            selectedTab={selectedTab}
            onSelectTab={setSelectedTab}
            onRefresh={refresh}
            onSelectGroup={selectGroup}
            onConsume={() => showConsumers(selectedTopic)}
            onProduce={() => showProduce(selectedTopic)}
            onBackToTopics={showTopics}
          />
        ) : view === 'group' && selectedGroup != null ? (
          <GroupView
            brokerId={selectedBrokerId}
            groupId={selectedGroup}
            refreshKey={refreshKey}
            onRefresh={refresh}
            onSelectTopic={selectTopic}
            onBack={showGroups}
          />
        ) : view === 'groups' ? (
          <GroupListView brokerId={selectedBrokerId} refreshKey={refreshKey} onRefresh={refresh} onSelectGroup={selectGroup} />
        ) : view === 'consume' ? (
          <ConsumeView
            brokerId={selectedBrokerId}
            refreshKey={refreshKey}
            onRefresh={refresh}
            prefill={consumePrefill}
            detailTopic={consumeDetailTopic}
            onOpenConsumer={openConsumer}
            onCloseDetail={showConsumers}
          />
        ) : view === 'produce' ? (
          <ProduceView brokerId={selectedBrokerId} refreshKey={refreshKey} onRefresh={refresh} prefill={producePrefill} />
        ) : (
          <TopicListView brokerId={selectedBrokerId} refreshKey={refreshKey} onRefresh={refresh} onSelectTopic={selectTopic} />
        )}
      </div>

      {/* Info modal */}
      {showInfo && (
        <KafkaInfoModal
          onClose={() => setShowInfo(false)}
          onDismissPermanently={() => {
            setInfoDismissed(true);
            setShowInfo(false);
          }}
        />
      )}
    </div>
  );
}
