import { useCallback, useEffect, useState } from 'react';
import { Container, Plug } from 'lucide-react';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import { containerApi, type ContainerConnection } from './types';
import { liveConnections } from '@/lib/liveConnections';
import { useContainerState } from './useContainerState';
import { LeftPanel } from './LeftPanel';
import { OverviewView } from './OverviewView';
import { ContainersView } from './ContainersView';
import { ImagesView } from './ImagesView';
import { VolumesView } from './VolumesView';
import { NetworksView } from './NetworksView';
import { ComposeView } from './ComposeView';

const LEFT_MIN = 200;
const LEFT_MAX = 480;
const LEFT_DEFAULT = 220;

// Cached at module scope so a remount (the tool is lazy-loaded and remounts on
// every tab switch) renders instantly instead of flashing an empty state while
// the connection list reloads — same pattern as Redis/Rabbit/Kafka.
let cachedConnections: ContainerConnection[] | null = null;

export function ContainerManager() {
  const {
    selectedConnId, setSelectedConnId, connectedConnId, setConnectedConnId,
    view, showOverview, showContainers, showImages, showVolumes, showNetworks, showCompose,
    refreshKey, refresh,
  } = useContainerState();

  const [connections, setConnections] = useState<ContainerConnection[]>(cachedConnections ?? []);
  const [connLoading, setConnLoading] = useState(cachedConnections === null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadConnections = useCallback(() => {
    containerApi.listConfigs()
      .then((c) => { cachedConnections = c; setConnections(c); })
      .catch(() => { cachedConnections = cachedConnections ?? []; })
      .finally(() => setConnLoading(false));
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const conn = connections.find((c) => c.id === selectedConnId) ?? null;
  const isConnected = !!conn && connectedConnId === conn.id;

  useEffect(() => { liveConnections.set('container-manager', isConnected); }, [isConnected]);

  const handleConnect = useCallback(async () => {
    if (!conn) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await containerApi.testConnection(conn);
      setConnectedConnId(conn.id);
    } catch (e) {
      setConnectError(String(e instanceof Error ? e.message : e));
    } finally {
      setConnecting(false);
    }
  }, [conn, setConnectedConnId]);

  const handleDisconnect = useCallback(() => {
    setConnectError(null);
    setConnectedConnId('');
  }, [setConnectedConnId]);

  const [leftWidth, setLeftWidth] = usePersistentState('devtool:container:leftPanelWidth', LEFT_DEFAULT);
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
          view={view}
          onShowOverview={showOverview}
          onShowContainers={showContainers}
          onShowImages={showImages}
          onShowVolumes={showVolumes}
          onShowNetworks={showNetworks}
          onShowCompose={showCompose}
        />
      </div>

      <div
        className="relative shrink-0 w-[5px] cursor-col-resize group z-10"
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setLeftWidth(LEFT_DEFAULT)}
        title="Drag to resize · Double-click to reset"
      >
        <div className={cn(
          'absolute inset-y-0 left-[2px] w-px bg-line transition-all duration-100',
          'group-hover:w-[3px] group-hover:left-[1px] group-hover:bg-acc/50',
          isResizing && 'w-[3px] left-[1px] bg-acc/70',
        )} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!conn ? (
          connLoading ? (
            <div className="h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-fg-mute gap-2">
              <Container className="w-ctl h-ctl opacity-30" />
              <p className="text-sm">Add a connection to get started</p>
            </div>
          )
        ) : !isConnected ? (
          <DisconnectedPanel conn={conn} connecting={connecting} error={connectError} onConnect={handleConnect} />
        ) : view === 'containers' ? (
          <ContainersView connection={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : view === 'images' ? (
          <ImagesView connection={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : view === 'volumes' ? (
          <VolumesView connection={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : view === 'networks' ? (
          <NetworksView connection={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : view === 'compose' ? (
          <ComposeView connection={conn} refreshKey={refreshKey} onRefresh={refresh} />
        ) : (
          <OverviewView connection={conn} refreshKey={refreshKey} onRefresh={refresh} />
        )}
      </div>
    </div>
  );
}

function DisconnectedPanel({ conn, connecting, error, onConnect }: {
  conn: ContainerConnection; connecting: boolean; error: string | null; onConnect: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-2/30">
        <Plug className="h-ctl w-ctl text-fg-mute/50" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{conn.name}</p>
        <p className="text-xs text-fg-mute font-mono">{conn.socketPath}</p>
      </div>
      <Button onClick={onConnect} disabled={connecting}>
        {connecting ? <Spinner className="mr-1.5" /> : <Plug className="h-4 w-4 mr-1.5" />}
        {connecting ? 'Connecting…' : 'Connect'}
      </Button>
      {error && <Callout tone="error" className="max-w-md text-left">{error}</Callout>}
    </div>
  );
}
