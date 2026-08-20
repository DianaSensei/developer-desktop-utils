import { useState } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

export type ContainerView = 'overview' | 'containers' | 'images' | 'volumes' | 'networks' | 'compose';

export interface ContainerToolState {
  selectedConnId: string;
  setSelectedConnId: (id: string) => void;
  connectedConnId: string;
  setConnectedConnId: (id: string) => void;
  view: ContainerView;
  showOverview: () => void;
  showContainers: () => void;
  showImages: () => void;
  showVolumes: () => void;
  showNetworks: () => void;
  showCompose: () => void;
  refreshKey: number;
  refresh: () => void;
}

export function useContainerState(): ContainerToolState {
  const [selectedConnId, setSelectedConnIdRaw] = usePersistentState('devtool:container:selectedConnId', '');
  const [connectedConnId, setConnectedConnId] = usePersistentState('devtool:container:connectedConnId', '');
  const [view, setView] = usePersistentState<ContainerView>('devtool:container:view', 'overview');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const setSelectedConnId = (id: string) => {
    setSelectedConnIdRaw(id);
    setView('overview');
  };

  return {
    selectedConnId, setSelectedConnId,
    connectedConnId, setConnectedConnId,
    view,
    showOverview: () => setView('overview'),
    showContainers: () => setView('containers'),
    showImages: () => setView('images'),
    showVolumes: () => setView('volumes'),
    showNetworks: () => setView('networks'),
    showCompose: () => setView('compose'),
    refreshKey, refresh,
  };
}
