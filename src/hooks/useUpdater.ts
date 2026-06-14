import { useState, useCallback } from 'react';

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

export interface UseUpdaterReturn {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

export function useUpdater(): UseUpdaterReturn {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    setStatus('checking');
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) {
        setUpdateInfo({
          version: update.version,
          body: update.body ?? '',
          date: update.date ?? '',
        });
        setStatus('available');
      } else {
        setStatus('not-available');
      }
    } catch (e) {
      setError(String(e));
      setStatus('error');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
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

  return { status, updateInfo, error, checkForUpdates, installUpdate };
}
