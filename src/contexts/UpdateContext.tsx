import { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'error';

export interface UpdateInfo {
  version: string;
  body: string;
  date: string;
}

interface UpdateContextValue {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  autoCheckEnabled: boolean;
  updateAvailable: boolean;
  toggleAutoCheck: () => void;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const STORAGE_AUTO_CHECK = 'devtool-auto-update';
const STORAGE_LAST_CHECK = 'devtool-last-update-check';
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function todayMidnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_AUTO_CHECK);
    return stored === null ? true : stored === 'true'; // default on for fresh installs
  });

  const checkForUpdates = useCallback(async () => {
    if (!isTauri) return;
    setStatus('checking');
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      localStorage.setItem(STORAGE_LAST_CHECK, Date.now().toString());
      if (update?.available) {
        setUpdateInfo({ version: update.version, body: update.body ?? '', date: update.date ?? '' });
        setStatus('available');
      } else {
        setStatus('not-available');
      }
    } catch (e) {
      const msg = String(e);
      setError(
        msg.includes('fetch') || msg.includes('JSON') || msg.includes('release')
          ? 'Could not reach the update server. Check your internet connection and try again.'
          : msg
      );
      setStatus('error');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauri) return;
    setStatus('downloading');
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (e) {
      setError(String(e));
      setStatus('error');
    }
  }, []);

  const toggleAutoCheck = useCallback(() => {
    setAutoCheckEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_AUTO_CHECK, String(next));
      return next;
    });
  }, []);

  // Check on app start if not yet checked today; re-check at each calendar midnight
  useEffect(() => {
    if (!isTauri || !autoCheckEnabled) return;

    const lastCheck = parseInt(localStorage.getItem(STORAGE_LAST_CHECK) ?? '0', 10);
    if (lastCheck < todayMidnight()) {
      checkForUpdates();
    }

    let id: ReturnType<typeof setTimeout>;
    function scheduleNextMidnight() {
      id = setTimeout(() => {
        checkForUpdates();
        scheduleNextMidnight();
      }, msUntilNextMidnight());
    }
    scheduleNextMidnight();

    return () => clearTimeout(id);
  }, [autoCheckEnabled, checkForUpdates]);

  return (
    <UpdateContext.Provider value={{
      status,
      updateInfo,
      error,
      autoCheckEnabled,
      updateAvailable: status === 'available',
      toggleAutoCheck,
      checkForUpdates,
      installUpdate,
    }}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider');
  return ctx;
}
