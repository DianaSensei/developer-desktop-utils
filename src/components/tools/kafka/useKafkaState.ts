import { useState } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

/** Which destination the right panel shows. Mirrors the RabbitMQ tool's nav model. */
export type KafkaView = 'topics' | 'groups' | 'consume' | 'produce' | 'topic' | 'group';

/** Detail tabs shown inside a single topic. */
export type KafkaTab = 'properties' | 'data' | 'config' | 'consumers';

/** Topic to pre-fill a panel (Consume / Produce) with when opened from an entry point. */
export interface TopicPrefill {
  topic: string;
  /** Bumped each request so re-clicking re-applies even with the same value. */
  token: number;
}

export interface KafkaState {
  selectedBrokerId: string;
  setSelectedBrokerId: (id: string) => void;
  view: KafkaView;
  selectedTopic: string | null;
  selectedGroup: string | null;
  selectedTab: KafkaTab;
  setSelectedTab: (tab: KafkaTab) => void;
  consumePrefill: TopicPrefill | null;
  producePrefill: TopicPrefill | null;
  /** Topic of the consumer shown in the detail panel; null = the consumer list. */
  consumeDetailTopic: string | null;
  showTopics: () => void;
  showGroups: () => void;
  showConsumers: (topic?: string) => void;
  /** Open one consumer's detail panel (from the list or the left-nav line). */
  openConsumer: (topic: string) => void;
  showProduce: (topic?: string) => void;
  selectTopic: (name: string) => void;
  selectGroup: (id: string) => void;
  refreshKey: number;
  refresh: () => void;
}

export function useKafkaState(): KafkaState {
  // Selection persists across restarts so you resume where you left off.
  const [selectedBrokerId, setSelectedBrokerIdRaw] = usePersistentState('devtool:kafka:selectedBrokerId', '');
  const [view, setView] = usePersistentState<KafkaView>('devtool:kafka:view', 'topics');
  const [selectedTopic, setSelectedTopic] = usePersistentState<string | null>('devtool:kafka:selectedTopic', null);
  const [selectedGroup, setSelectedGroup] = usePersistentState<string | null>('devtool:kafka:selectedGroup', null);
  const [selectedTab, setSelectedTab] = usePersistentState<KafkaTab>('devtool:kafka:selectedTab', 'data');
  const [consumePrefill, setConsumePrefill] = useState<TopicPrefill | null>(null);
  const [producePrefill, setProducePrefill] = useState<TopicPrefill | null>(null);
  const [consumeDetailTopic, setConsumeDetailTopic] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const setSelectedBrokerId = (id: string) => {
    setSelectedBrokerIdRaw(id);
    setView('topics');
    setSelectedTopic(null);
    setSelectedGroup(null);
  };

  const showTopics = () => { setView('topics'); setSelectedTopic(null); setSelectedGroup(null); };
  const showGroups = () => { setView('groups'); setSelectedTopic(null); setSelectedGroup(null); };

  const showConsumers = (topic?: string) => {
    // Guard: callers sometimes wire this straight to onClick, which would pass the
    // event as `topic`. Only accept a real string.
    const t = typeof topic === 'string' ? topic : undefined;
    setView('consume');
    setSelectedTopic(null);
    setSelectedGroup(null);
    setConsumeDetailTopic(null);
    setConsumePrefill(t ? { topic: t, token: Date.now() } : null);
  };

  const openConsumer = (topic: string) => {
    setView('consume');
    setSelectedTopic(null);
    setSelectedGroup(null);
    setConsumeDetailTopic(topic);
  };

  const showProduce = (topic?: string) => {
    const t = typeof topic === 'string' ? topic : undefined;
    setView('produce');
    setSelectedTopic(null);
    setSelectedGroup(null);
    setProducePrefill(t ? { topic: t, token: Date.now() } : null);
  };

  const selectTopic = (name: string) => {
    setView('topic');
    setSelectedTopic(name);
    setSelectedGroup(null);
    setSelectedTab('data');
  };

  const selectGroup = (id: string) => {
    setView('group');
    setSelectedGroup(id);
    setSelectedTopic(null);
  };

  return {
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
  };
}
