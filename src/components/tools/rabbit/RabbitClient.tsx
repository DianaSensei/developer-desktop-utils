import { useCallback, useEffect, useState } from 'react';
import { Rabbit, Info, Plug, Loader2, AlertCircle } from 'lucide-react';
import { ToolHeaderActions } from '@/components/ToolHeaderActions';
import { Button } from '@/components/ui/button';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import { rabbitApi, type RabbitConnection } from './types';
import { rabbitMgmt } from './api';
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

// The tool is lazy-loaded and remounts on every tab switch. Cache the last-loaded
// connection list at module scope so a remount renders instantly (no empty-state
// flash) while a fresh list loads in the background.
let cachedConnections: RabbitConnection[] | null = null;

export function RabbitClient() {
  const {
    selectedConnId, setSelectedConnId, connectedConnId, setConnectedConnId,
    view, selectedQueue, selectedExchange, rpcPrefill, consumerPrefill, consumeDetailQueue,
    showOverview, showConnections, showRpc, showConsumers, openConsumer, showQueues, showExchanges, selectQueue, selectExchange,
    refreshKey, refresh,
  } = useRabbitState();

  const [connections, setConnections] = useState<RabbitConnection[]>(cachedConnections ?? []);
  const [connLoading, setConnLoading] = useState(cachedConnections === null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadConnections = useCallback(() => {
    rabbitApi.listConfigs()
      .then((c) => { cachedConnections = c; setConnections(c); })
      .catch(() => { cachedConnections = cachedConnections ?? []; })
      .finally(() => setConnLoading(false));
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // Stop any live consumers when leaving the tool so nothing keeps running in the
  // background. They persist across tab/view switches within the tool (the store
  // lives outside this component tree), but not after it unmounts.
  useEffect(() => () => { consumerStore.stopAll(); }, []);

  const conn = connections.find((c) => c.id === selectedConnId) ?? null;
  const isConnected = !!conn && connectedConnId === conn.id;

  // Connect = verify the broker is reachable (AMQP, plus the management API when
  // enabled), then mark this connection live. Only one connection is live at a
  // time, so connecting elsewhere stops the previous one's consumers.
  const handleConnect = useCallback(async () => {
    if (!conn) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await rabbitApi.amqpTest(conn);
      if (!conn.amqpOnly) await rabbitMgmt.testConnection(conn);
      if (connectedConnId && connectedConnId !== conn.id) consumerStore.stopForConn(connectedConnId);
      setConnectedConnId(conn.id);
    } catch (e) {
      setConnectError(String(e instanceof Error ? e.message : e));
    } finally {
      setConnecting(false);
    }
  }, [conn, connectedConnId, setConnectedConnId]);

  const handleDisconnect = useCallback(() => {
    if (conn) consumerStore.stopForConn(conn.id);
    setConnectError(null);
    setConnectedConnId('');
  }, [conn, setConnectedConnId]);

  // Overview & Connections require the management API. On an AMQP-only connection,
  // resolve those views to Queues during render (they're hidden in the nav too) so
  // we never flash a management-only view before redirecting.
  const effectiveView = conn?.amqpOnly && (view === 'overview' || view === 'connections') ? 'queues' : view;

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
          connected={isConnected}
          connecting={connecting}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          view={effectiveView}
          onShowOverview={showOverview}
          onShowConnections={showConnections}
          onShowRpc={() => showRpc()}
          onShowConsumers={() => showConsumers()}
          onOpenConsumer={openConsumer}
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
          connLoading ? (
            // Brief: while the saved connections load. Stays blank to avoid a flash
            // of the "add a connection" empty state on every tab switch.
            <div className="h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Rabbit className="w-8 h-8 opacity-30" />
              <p className="text-sm">Add a connection to get started</p>
            </div>
          )
        ) : !isConnected ? (
          <DisconnectedPanel conn={conn} connecting={connecting} error={connectError} onConnect={handleConnect} />
        ) : effectiveView === 'queue' && selectedQueue != null ? (
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
        ) : effectiveView === 'exchange' && selectedExchange != null ? (
          <ExchangeView
            key={`${conn.id}:${selectedExchange}`}
            conn={conn}
            exchangeName={selectedExchange}
            refreshKey={refreshKey}
            onRefresh={refresh}
            onBack={showExchanges}
            onPublish={(exchange, routingKey) => showRpc({ exchange, routingKey, mode: 'send' })}
          />
        ) : effectiveView === 'queues' ? (
          <QueueListView conn={conn} refreshKey={refreshKey} onRefresh={refresh} onSelectQueue={selectQueue} />
        ) : effectiveView === 'exchanges' ? (
          <ExchangeListView conn={conn} refreshKey={refreshKey} onRefresh={refresh} onSelectExchange={selectExchange} />
        ) : effectiveView === 'connections' ? (
          <ConnectionsView conn={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : effectiveView === 'consumers' ? (
          <ConsumersView
            conn={conn}
            refreshKey={refreshKey}
            onRefresh={refresh}
            prefill={consumerPrefill}
            detailQueue={consumeDetailQueue}
            onOpenConsumer={openConsumer}
            onCloseDetail={() => showConsumers()}
          />
        ) : effectiveView === 'rpc' ? (
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

/** Shown when a connection is selected but not yet connected. */
function DisconnectedPanel({ conn, connecting, error, onConnect }: {
  conn: RabbitConnection; connecting: boolean; error: string | null; onConnect: () => void;
}) {
  const endpoint = conn.amqpOnly ? `${conn.host}:${conn.amqpPort}` : `${conn.host}:${conn.port}`;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/30">
        <Plug className="h-7 w-7 text-muted-foreground/50" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{conn.name}</p>
        <p className="text-xs text-muted-foreground font-mono">{endpoint}{conn.extraHosts?.length ? ` +${conn.extraHosts.length}` : ''}</p>
      </div>
      <Button onClick={onConnect} disabled={connecting}>
        {connecting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plug className="h-4 w-4 mr-1.5" />}
        {connecting ? 'Connecting…' : 'Connect'}
      </Button>
      {error && (
        <div className="flex items-start gap-2 max-w-md rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive text-left">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{error}</span>
        </div>
      )}
    </div>
  );
}
