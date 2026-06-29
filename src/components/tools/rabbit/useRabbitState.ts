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
  /** The connection the user has explicitly connected to ('' = none). */
  connectedConnId: string;
  setConnectedConnId: (id: string) => void;
  view: RabbitView;
  selectedQueue: string | null;
  selectedExchange: string | null;
  rpcPrefill: RpcPrefill | null;
  consumerPrefill: ConsumerPrefill | null;
  /** Queue of the consumer shown in the detail panel; null = the consumer list. */
  consumeDetailQueue: string | null;
  showOverview: () => void;
  showConnections: () => void;
  showRpc: (prefill?: Omit<RpcPrefill, 'token'>) => void;
  showConsumers: (prefill?: Omit<ConsumerPrefill, 'token'>) => void;
  /** Open one consumer's detail panel (from the list or the left-nav line). */
  openConsumer: (queue: string) => void;
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
  const [connectedConnId, setConnectedConnId] = usePersistentState('devtool:rabbit:connectedConnId', '');
  const [view, setView] = usePersistentState<RabbitView>('devtool:rabbit:view', 'overview');
  const [selectedQueue, setSelectedQueue] = usePersistentState<string | null>('devtool:rabbit:selectedQueue', null);
  const [selectedExchange, setSelectedExchange] = usePersistentState<string | null>('devtool:rabbit:selectedExchange', null);
  const [rpcPrefill, setRpcPrefill] = useState<RpcPrefill | null>(null);
  const [consumerPrefill, setConsumerPrefill] = useState<ConsumerPrefill | null>(null);
  const [consumeDetailQueue, setConsumeDetailQueue] = useState<string | null>(null);
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
    // Guard: callers sometimes wire this straight to onClick, passing an event.
    const queue = typeof prefill?.queue === 'string' ? prefill.queue : undefined;
    setView('consumers');
    setSelectedQueue(null);
    setSelectedExchange(null);
    setConsumeDetailQueue(null);
    setConsumerPrefill(queue ? { queue, token: Date.now() } : null);
  };

  const openConsumer = (queue: string) => {
    setView('consumers');
    setSelectedQueue(null);
    setSelectedExchange(null);
    setConsumeDetailQueue(queue);
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
    connectedConnId,
    setConnectedConnId,
    view,
    selectedQueue,
    selectedExchange,
    rpcPrefill,
    consumerPrefill,
    consumeDetailQueue,
    showOverview,
    showConnections,
    showRpc,
    showConsumers,
    openConsumer,
    showQueues,
    showExchanges,
    selectQueue,
    selectExchange,
    refreshKey,
    refresh,
  };
}
