import { useState } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';

export type RedisView = 'overview' | 'keys' | 'key' | 'cli' | 'pubsub' | 'admin';

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
  showPubSub: () => void;
  showAdmin: () => void;
  selectKey: (key: string) => void;
  refreshKey: number;
  refresh: () => void;
}

export function useRedisState(): RedisState {
  // `legacyKey` ở mọi dòng dưới đây là bắt buộc, không phải trang trí: tool này
  // lưu ở tiền tố `devtool:redis:` từ trước, còn id plugin là `redis-client` —
  // thiếu nó là im lặng vứt đi kết nối đang chọn và db của người dùng.
  const sdk = usePluginSdkFor('redis-client');
  const [selectedConnId, setSelectedConnIdRaw] = usePluginState(sdk, 'selectedConnId', '', { legacyKey: 'devtool:redis:selectedConnId' });
  const [connectedConnId, setConnectedConnId] = usePluginState(sdk, 'connectedConnId', '', { legacyKey: 'devtool:redis:connectedConnId' });
  const [db, setDbRaw] = usePluginState(sdk, 'db', 0, { legacyKey: 'devtool:redis:db' });
  const [view, setView] = usePluginState<RedisView>(sdk, 'view', 'overview', { legacyKey: 'devtool:redis:view' });
  const [selectedKey, setSelectedKey] = usePluginState<string | null>(sdk, 'selectedKey', null, { legacyKey: 'devtool:redis:selectedKey' });
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
  const showPubSub = () => { setView('pubsub'); setSelectedKey(null); };
  const showAdmin = () => { setView('admin'); setSelectedKey(null); };
  const selectKey = (key: string) => { setView('key'); setSelectedKey(key); };

  return {
    selectedConnId, setSelectedConnId,
    connectedConnId, setConnectedConnId,
    db, setDb,
    view, selectedKey,
    showOverview, showKeys, showCli, showPubSub, showAdmin, selectKey,
    refreshKey, refresh,
  };
}
