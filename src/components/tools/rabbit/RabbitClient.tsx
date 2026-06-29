import { useCallback, useEffect, useState } from 'react';
import { Rabbit, Info } from 'lucide-react';
import { ToolHeaderActions } from '@/components/ToolHeaderActions';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import { rabbitApi, type RabbitConnection } from './types';
import { useRabbitState } from './useRabbitState';
import { LeftPanel } from './LeftPanel';
import { OverviewView } from './OverviewView';
import { ConnectionsView } from './ConnectionsView';
import { RpcView } from './RpcView';
import { ConsumersView } from './ConsumersView';
import { QueueListView } from './QueueListView';
import { ExchangeListView } from './ExchangeListView';
import { QueueView } from './QueueView';
import { ExchangeView } from './ExchangeView';
import { RabbitInfoModal } from './RabbitInfoModal';
import { consumerStore } from './consumerStore';

const LEFT_MIN = 200;
const LEFT_MAX = 480;
const LEFT_DEFAULT = 264;

export function RabbitClient() {
  const {
    selectedConnId, setSelectedConnId,
    view, selectedQueue, selectedExchange, rpcPrefill, consumerPrefill,
    showOverview, showConnections, showRpc, showConsumers, showQueues, showExchanges, selectQueue, selectExchange,
    refreshKey, refresh,
  } = useRabbitState();

  const [connections, setConnections] = useState<RabbitConnection[]>([]);
  const [connLoading, setConnLoading] = useState(true);

  const loadConnections = useCallback(() => {
    setConnLoading(true);
    rabbitApi.listConfigs()
      .then(setConnections)
      .catch(() => setConnections([]))
      .finally(() => setConnLoading(false));
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // Stop any live consumers when leaving the tool so nothing keeps running in the
  // background. They persist across tab/view switches within the tool (the store
  // lives outside this component tree), but not after it unmounts.
  useEffect(() => () => { consumerStore.stopAll(); }, []);

  const conn = connections.find((c) => c.id === selectedConnId) ?? null;

  // Overview & Connections require the management API. On an AMQP-only connection,
  // steer those views to Queues (they're hidden in the nav too).
  useEffect(() => {
    if (conn?.amqpOnly && (view === 'overview' || view === 'connections')) showQueues();
  }, [conn?.id, conn?.amqpOnly, view, showQueues]);

  const [infoDismissed, setInfoDismissed] = usePersistentState('devtool:rabbit:info-dismissed', false);
  const [showInfo, setShowInfo] = useState(!infoDismissed);
  const [leftWidth, setLeftWidth] = usePersistentState('devtool:rabbit:leftPanelWidth', LEFT_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);

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
      <ToolHeaderActions>
        <button
          onClick={() => setShowInfo(true)}
          title="How the RabbitMQ Client accesses your broker"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Info className="h-4 w-4" />
        </button>
      </ToolHeaderActions>

      {/* Left panel — resizable + persisted */}
      <div className="shrink-0 flex flex-col h-full overflow-hidden" style={{ width: leftWidth }}>
        <LeftPanel
          connections={connections}
          connectionsLoading={connLoading}
          selectedConnId={selectedConnId}
          onSelectConn={setSelectedConnId}
          onConnectionsChanged={loadConnections}
          view={view}
          onShowOverview={showOverview}
          onShowConnections={showConnections}
          onShowRpc={() => showRpc()}
          onShowConsumers={showConsumers}
          onShowQueues={showQueues}
          onShowExchanges={showExchanges}
        />
      </div>

      {/* Resize handle */}
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
        {!conn ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Rabbit className="w-8 h-8 opacity-30" />
            <p className="text-sm">Add a connection to get started</p>
          </div>
        ) : view === 'queue' && selectedQueue != null ? (
          <QueueView
            key={`${conn.id}:${selectedQueue}`}
            conn={conn}
            queueName={selectedQueue}
            refreshKey={refreshKey}
            onRefresh={refresh}
            onBack={showQueues}
            onPublish={(exchange, routingKey) => showRpc({ exchange, routingKey, mode: 'send' })}
            onConsume={(queue) => showConsumers({ queue })}
          />
        ) : view === 'exchange' && selectedExchange != null ? (
          <ExchangeView
            key={`${conn.id}:${selectedExchange}`}
            conn={conn}
            exchangeName={selectedExchange}
            refreshKey={refreshKey}
            onRefresh={refresh}
            onBack={showExchanges}
            onPublish={(exchange, routingKey) => showRpc({ exchange, routingKey, mode: 'send' })}
          />
        ) : view === 'queues' ? (
          <QueueListView conn={conn} refreshKey={refreshKey} onRefresh={refresh} onSelectQueue={selectQueue} />
        ) : view === 'exchanges' ? (
          <ExchangeListView conn={conn} refreshKey={refreshKey} onRefresh={refresh} onSelectExchange={selectExchange} />
        ) : view === 'connections' ? (
          <ConnectionsView conn={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : view === 'consumers' ? (
          <ConsumersView conn={conn} refreshKey={refreshKey} onRefresh={refresh} prefill={consumerPrefill} />
        ) : view === 'rpc' ? (
          <RpcView conn={conn} prefill={rpcPrefill} />
        ) : (
          <OverviewView conn={conn} refreshKey={refreshKey} onRefresh={refresh} />
        )}
      </div>

      {showInfo && (
        <RabbitInfoModal
          onClose={() => setShowInfo(false)}
          onDismissPermanently={() => { setInfoDismissed(true); setShowInfo(false); }}
        />
      )}
    </div>
  );
}
