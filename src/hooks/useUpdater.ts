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
    if (!('__TAURI_IPC__' in window)) return;
    setStatus('checking');
    setError(null);
    try {
      const { checkUpdate } = await import('@tauri-apps/api/updater');
      const { shouldUpdate, manifest } = await checkUpdate();
      if (shouldUpdate && manifest) {
        setUpdateInfo({
          version: manifest.version,
          body: manifest.body ?? '',
          date: manifest.date ?? '',
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
    if (!('__TAURI_IPC__' in window)) return;
    setStatus('downloading');
    setError(null);
    try {
      const { installUpdate } = await import('@tauri-apps/api/updater');
      await installUpdate();
      const { relaunch } = await import('@tauri-apps/api/process');
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus('error');
    }
  }, []);

  return { status, updateInfo, error, checkForUpdates, installUpdate };
}
