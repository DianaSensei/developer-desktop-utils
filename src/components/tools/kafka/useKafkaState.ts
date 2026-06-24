import { useState } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

export type KafkaTab = 'properties' | 'data' | 'config' | 'consumers' | 'produce';

export interface KafkaState {
  selectedBrokerId: string;
  setSelectedBrokerId: (id: string) => void;
  selectedTopic: string | null;
  setSelectedTopic: (t: string | null) => void;
  selectedGroup: string | null;
  setSelectedGroup: (g: string | null) => void;
  selectedTab: KafkaTab;
  setSelectedTab: (tab: KafkaTab) => void;
  refreshKey: number;
  refresh: () => void;
}

export function useKafkaState(): KafkaState {
  const [selectedBrokerId, setSelectedBrokerId] = usePersistentState('devtool:kafka:selectedBrokerId', '');
  // Selection persists across restarts so you resume where you left off.
  const [selectedTopic, setSelectedTopic] = usePersistentState<string | null>('devtool:kafka:selectedTopic', null);
  const [selectedGroup, setSelectedGroup] = usePersistentState<string | null>('devtool:kafka:selectedGroup', null);
  const [selectedTab, setSelectedTab] = usePersistentState<KafkaTab>('devtool:kafka:selectedTab', 'data');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleSetBroker = (id: string) => {
    setSelectedBrokerId(id);
    setSelectedTopic(null);
    setSelectedGroup(null);
  };

  const handleSetTopic = (t: string | null) => {
    setSelectedTopic(t);
    setSelectedGroup(null);
    setSelectedTab('data');
  };

  const handleSetGroup = (g: string | null) => {
    setSelectedGroup(g);
    setSelectedTopic(null);
  };

  return {
    selectedBrokerId,
    setSelectedBrokerId: handleSetBroker,
    selectedTopic,
    setSelectedTopic: handleSetTopic,
    selectedGroup,
    setSelectedGroup: handleSetGroup,
    selectedTab,
    setSelectedTab,
    refreshKey,
    refresh,
  };
}
