import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAppConfig } from '@/contexts/AppConfigContext';

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
  /** Download progress percentage (0–100) while installing; null when unknown/idle. */
  downloadProgress: number | null;
  /** Hour of day (0–23, local time) for the scheduled daily check. Defaults to 6am. */
  checkHour: number;
  setCheckHour: (hour: number) => void;
  /** True while the "new version found" popup should be shown. */
  showUpdateDialog: boolean;
  dismissUpdateDialog: () => void;
  /** Re-open the changelog popup for a known-available update (no download). */
  openUpdateDialog: () => void;
  toggleAutoCheck: () => void;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  /** Abort an in-progress download/install and return to a retryable state. */
  cancelInstall: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const STORAGE_AUTO_CHECK = 'devtool-auto-update';
const STORAGE_LAST_CHECK = 'devtool-last-update-check';
const STORAGE_PENDING_UPDATE = 'devtool-pending-update'; // persisted UpdateInfo while an update is known to be available
const STORAGE_CHECK_HOUR = 'devtool-update-check-hour';
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function loadCheckHour(fallbackHour: number): number {
  const raw = parseInt(localStorage.getItem(STORAGE_CHECK_HOUR) ?? '', 10);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : fallbackHour;
}

// Timestamp of the most recent daily-check boundary that has already passed.
// Used to enforce "check at most once a day": if the last check predates this, check again.
function lastDailyBoundary(hour: number): number {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); // before the hour → use yesterday's boundary
  return d.getTime();
}

function msUntilNextDailyCheck(hour: number): number {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime() - Date.now();
}

function loadPendingUpdate(): UpdateInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_PENDING_UPDATE);
    return raw ? (JSON.parse(raw) as UpdateInfo) : null;
  } catch {
    return null;
  }
}

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const { config } = useAppConfig();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  // Seed from persisted state so a previously-found update keeps its badge across restarts.
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(loadPendingUpdate);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(() => loadPendingUpdate() !== null);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  // Set while a download is in flight; calling it aborts the wait (cancel or stall-timeout).
  const cancelInstallRef = useRef<((reason: string) => void) | null>(null);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_AUTO_CHECK);
    return stored === null ? true : stored === 'true'; // default on for fresh installs
  });
  const [checkHour, setCheckHourState] = useState<number>(() => loadCheckHour(config.updates.defaultCheckHour));

  const setCheckHour = useCallback((hour: number) => {
    const h = Math.min(23, Math.max(0, Math.trunc(hour)));
    localStorage.setItem(STORAGE_CHECK_HOUR, String(h));
    setCheckHourState(h);
  }, []);

  // Checks the update manifest only — never downloads anything. Whenever a new
  // version is found (whether triggered by the daily background check or the
  // manual "Check" button), surface the changelog popup. Downloading + installing
  // is a separate, explicitly user-triggered action (installUpdate).
  // Returns the available UpdateInfo (or null). `popDialog` is suppressed for the
  // silent pre-install refresh so it doesn't reopen the popup.
  const runCheck = useCallback(async (popDialog = true): Promise<UpdateInfo | null> => {
    if (!isTauri) return null;
    setStatus('checking');
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      localStorage.setItem(STORAGE_LAST_CHECK, Date.now().toString());
      if (update?.available) {
        const info = { version: update.version, body: update.body ?? '', date: update.date ?? '' };
        setUpdateInfo(info);
        setUpdateAvailable(true);
        localStorage.setItem(STORAGE_PENDING_UPDATE, JSON.stringify(info));
        setStatus('available');
        if (popDialog) setShowUpdateDialog(true);
        return info;
      }
      // Confirmed up to date — clear the persisted badge.
      setUpdateInfo(null);
      setUpdateAvailable(false);
      localStorage.removeItem(STORAGE_PENDING_UPDATE);
      setStatus('not-available');
      return null;
    } catch (e) {
      // A failed check is non-fatal: the rest of the app keeps working offline.
      // A successful retry later will clear this. (lastCheck is intentionally NOT
      // updated here, so an overdue check is retried on next launch / reconnect.)
      const msg = String(e);
      const isNetwork =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        msg.includes('fetch') || msg.includes('network') || msg.includes('JSON') || msg.includes('release');
      setError(
        isNetwork
          ? 'Offline — could not reach the update server. Will retry when you’re back online.'
          : msg
      );
      setStatus('error');
      return null;
    }
  }, []);

  const checkForUpdates = useCallback(() => runCheck().then(() => {}), [runCheck]);

  const dismissUpdateDialog = useCallback(() => setShowUpdateDialog(false), []);
  // Re-open the changelog popup for an already-discovered update (no re-check, no download).
  const openUpdateDialog = useCallback(() => setShowUpdateDialog(true), []);

  const installUpdate = useCallback(async () => {
    if (!isTauri) return;

    // Freshness guard: if the last check is older than the configured window,
    // silently re-check before downloading so the install reflects the current
    // manifest. Three outcomes:
    //   • no update now (already current / yanked / failed) → stop (status updated by runCheck)
    //   • a *different* version than the user was about to install → show its changelog
    //     and stop, so they review the new version before downloading
    //   • same version → proceed to download
    const staleMs = config.updates.recheckStaleMinutes * 60 * 1000;
    const lastCheck = parseInt(localStorage.getItem(STORAGE_LAST_CHECK) ?? '0', 10);
    if (Date.now() - lastCheck > staleMs) {
      const prevVersion = updateInfo?.version;
      const fresh = await runCheck(false);
      if (!fresh) return;
      if (fresh.version !== prevVersion) {
        setShowUpdateDialog(true); // let the user see the new version's changes first
        return;
      }
    }

    setStatus('downloading');
    setError(null);
    setDownloadProgress(null);

    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const stallTimeoutMs = config.updates.downloadTimeoutSeconds * 1000;
    // Rejects the download race on cancel or stall-timeout. The underlying download may keep
    // running, but the UI returns to a retryable state instead of hanging.
    const aborted = new Promise<never>((_, reject) => {
      cancelInstallRef.current = (reason: string) => reject(new Error(reason));
    });
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => cancelInstallRef.current?.('TIMEOUT'), stallTimeoutMs);
    };
    const cleanup = () => {
      settled = true;
      clearTimeout(stallTimer);
      cancelInstallRef.current = null;
    };

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (!update?.available) {
        cleanup();
        setStatus('not-available'); // nothing to install (already current)
        return;
      }

      let downloaded = 0;
      let total = 0;
      armStallTimer(); // watchdog: also covers the gap before the first byte arrives
      await Promise.race([
        update.downloadAndInstall((event) => {
          if (settled) return;
          armStallTimer(); // any activity resets the stall countdown
          switch (event.event) {
            case 'Started':
              total = event.data.contentLength ?? 0;
              setDownloadProgress(total > 0 ? 0 : null); // null = size unknown → show spinner only
              break;
            case 'Progress':
              downloaded += event.data.chunkLength;
              if (total > 0) setDownloadProgress(Math.min(100, Math.round((downloaded / total) * 100)));
              break;
            case 'Finished':
              setDownloadProgress(100);
              break;
          }
        }),
        aborted,
      ]);

      cleanup();
      await relaunch();
    } catch (e) {
      cleanup();
      setDownloadProgress(null);
      const msg = String(e);
      if (msg.includes('CANCELLED')) {
        // User cancelled — keep the badge so they can retry; no error shown.
        setStatus(updateAvailable ? 'available' : 'idle');
      } else if (msg.includes('TIMEOUT')) {
        setError('Download timed out. Please check your connection and try again.');
        setStatus('error');
      } else {
        setError(msg);
        setStatus('error');
      }
    }
  }, [updateAvailable, updateInfo, config.updates.downloadTimeoutSeconds, config.updates.recheckStaleMinutes, runCheck]);

  const cancelInstall = useCallback(() => cancelInstallRef.current?.('CANCELLED'), []);

  const toggleAutoCheck = useCallback(() => {
    setAutoCheckEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_AUTO_CHECK, String(next));
      return next;
    });
  }, []);

  // Check on app open if not yet checked today; otherwise re-check daily at the chosen hour. (At most once a day.)
  useEffect(() => {
    if (!isTauri || !autoCheckEnabled) return;

    const lastCheck = parseInt(localStorage.getItem(STORAGE_LAST_CHECK) ?? '0', 10);
    if (lastCheck < lastDailyBoundary(checkHour)) {
      runCheck();
    }

    let id: ReturnType<typeof setTimeout>;
    function scheduleNextDailyCheck() {
      id = setTimeout(() => {
        runCheck();
        scheduleNextDailyCheck();
      }, msUntilNextDailyCheck(checkHour));
    }
    scheduleNextDailyCheck();

    return () => clearTimeout(id);
  }, [autoCheckEnabled, checkHour, runCheck]);

  // Auto-recover: when connectivity is restored, retry if the last check errored or is overdue.
  // This lets the app run offline and quietly catch up once the network is back.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (!isTauri || !autoCheckEnabled) return;
    function handleOnline() {
      if (statusRef.current === 'checking' || statusRef.current === 'downloading') return;
      const lastCheck = parseInt(localStorage.getItem(STORAGE_LAST_CHECK) ?? '0', 10);
      if (statusRef.current === 'error' || lastCheck < lastDailyBoundary(checkHour)) {
        runCheck();
      }
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [autoCheckEnabled, checkHour, runCheck]);

  return (
    <UpdateContext.Provider value={{
      status,
      updateInfo,
      error,
      autoCheckEnabled,
      updateAvailable,
      downloadProgress,
      checkHour,
      setCheckHour,
      showUpdateDialog,
      dismissUpdateDialog,
      openUpdateDialog,
      toggleAutoCheck,
      checkForUpdates,
      installUpdate,
      cancelInstall,
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
