import { useState } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

export type RedisView = 'overview' | 'keys' | 'key' | 'cli';

export interface RedisState {
  selectedConnId: string;
  setSelectedConnId: (id: string) => void;
  /** The connection the user has explicitly connected to ('' = none). */
  connectedConnId: string;
  setConnectedConnId: (id: string) => void;
  /** Currently selected logical db (0–15). */
  db: number;
  setDb: (db: number) => void;
  view: RedisView;
  selectedKey: string | null;
  showOverview: () => void;
  showKeys: () => void;
  showCli: () => void;
  selectKey: (key: string) => void;
  refreshKey: number;
  refresh: () => void;
}

export function useRedisState(): RedisState {
  const [selectedConnId, setSelectedConnIdRaw] = usePersistentState('devtool:redis:selectedConnId', '');
  const [connectedConnId, setConnectedConnId] = usePersistentState('devtool:redis:connectedConnId', '');
  const [db, setDbRaw] = usePersistentState('devtool:redis:db', 0);
  const [view, setView] = usePersistentState<RedisView>('devtool:redis:view', 'overview');
  const [selectedKey, setSelectedKey] = usePersistentState<string | null>('devtool:redis:selectedKey', null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const setSelectedConnId = (id: string) => {
    setSelectedConnIdRaw(id);
    setView('overview');
    setSelectedKey(null);
  };

  const setDb = (n: number) => {
    setDbRaw(n);
    setView('keys');
    setSelectedKey(null);
  };

  const showOverview = () => { setView('overview'); setSelectedKey(null); };
  const showKeys = () => { setView('keys'); setSelectedKey(null); };
  const showCli = () => { setView('cli'); setSelectedKey(null); };
  const selectKey = (key: string) => { setView('key'); setSelectedKey(key); };

  return {
    selectedConnId, setSelectedConnId,
    connectedConnId, setConnectedConnId,
    db, setDb,
    view, selectedKey,
    showOverview, showKeys, showCli, selectKey,
    refreshKey, refresh,
  };
}
