import { useState } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

export type RabbitView = 'overview' | 'connections' | 'rpc' | 'consumers' | 'queues' | 'exchanges' | 'queue' | 'exchange';

/** Destination/mode to pre-fill the Send/Request panel with when opened from an entry point. */
export interface RpcPrefill {
  exchange: string;
  routingKey: string;
  mode: 'send' | 'request';
  /** Bumped on every request so re-clicking re-applies even with identical values. */
  token: number;
}

/** Queue to pre-fill the Consumers panel with when opened from an entry point. */
export interface ConsumerPrefill {
  queue: string;
  /** Bumped on every request so re-clicking re-applies even with identical values. */
  token: number;
}

export interface RabbitState {
  selectedConnId: string;
  setSelectedConnId: (id: string) => void;
  view: RabbitView;
  selectedQueue: string | null;
  selectedExchange: string | null;
  rpcPrefill: RpcPrefill | null;
  consumerPrefill: ConsumerPrefill | null;
  showOverview: () => void;
  showConnections: () => void;
  showRpc: (prefill?: Omit<RpcPrefill, 'token'>) => void;
  showConsumers: (prefill?: Omit<ConsumerPrefill, 'token'>) => void;
  showQueues: () => void;
  showExchanges: () => void;
  selectQueue: (name: string) => void;
  selectExchange: (name: string) => void;
  refreshKey: number;
  refresh: () => void;
}

export function useRabbitState(): RabbitState {
  // Selection persists across restarts so you resume where you left off.
  const [selectedConnId, setSelectedConnIdRaw] = usePersistentState('devtool:rabbit:selectedConnId', '');
  const [view, setView] = usePersistentState<RabbitView>('devtool:rabbit:view', 'overview');
  const [selectedQueue, setSelectedQueue] = usePersistentState<string | null>('devtool:rabbit:selectedQueue', null);
  const [selectedExchange, setSelectedExchange] = usePersistentState<string | null>('devtool:rabbit:selectedExchange', null);
  const [rpcPrefill, setRpcPrefill] = useState<RpcPrefill | null>(null);
  const [consumerPrefill, setConsumerPrefill] = useState<ConsumerPrefill | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const setSelectedConnId = (id: string) => {
    setSelectedConnIdRaw(id);
    setView('overview');
    setSelectedQueue(null);
    setSelectedExchange(null);
  };

  const showOverview = () => {
    setView('overview');
    setSelectedQueue(null);
    setSelectedExchange(null);
  };

  const showConnections = () => {
    setView('connections');
    setSelectedQueue(null);
    setSelectedExchange(null);
  };

  const showRpc = (prefill?: Omit<RpcPrefill, 'token'>) => {
    setView('rpc');
    setSelectedQueue(null);
    setSelectedExchange(null);
    setRpcPrefill(prefill ? { ...prefill, token: Date.now() } : null);
  };

  const showConsumers = (prefill?: Omit<ConsumerPrefill, 'token'>) => {
    setView('consumers');
    setSelectedQueue(null);
    setSelectedExchange(null);
    setConsumerPrefill(prefill ? { ...prefill, token: Date.now() } : null);
  };

  const showQueues = () => {
    setView('queues');
    setSelectedQueue(null);
    setSelectedExchange(null);
  };

  const showExchanges = () => {
    setView('exchanges');
    setSelectedQueue(null);
    setSelectedExchange(null);
  };

  const selectQueue = (name: string) => {
    setView('queue');
    setSelectedQueue(name);
    setSelectedExchange(null);
  };

  const selectExchange = (name: string) => {
    setView('exchange');
    setSelectedExchange(name);
    setSelectedQueue(null);
  };

  return {
    selectedConnId,
    setSelectedConnId,
    view,
    selectedQueue,
    selectedExchange,
    rpcPrefill,
    consumerPrefill,
    showOverview,
    showConnections,
    showRpc,
    showConsumers,
    showQueues,
    showExchanges,
    selectQueue,
    selectExchange,
    refreshKey,
    refresh,
  };
}
