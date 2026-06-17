import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

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
  /** Time of day (local) for the scheduled daily check. Defaults to 6:00am. */
  checkHour: number;
  checkMinute: number;
  setCheckTime: (hour: number, minute: number) => void;
  /** True while the "new version found" popup should be shown (set by automatic checks). */
  showUpdateDialog: boolean;
  dismissUpdateDialog: () => void;
  toggleAutoCheck: () => void;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const STORAGE_AUTO_CHECK = 'devtool-auto-update';
const STORAGE_LAST_CHECK = 'devtool-last-update-check';
const STORAGE_PENDING_UPDATE = 'devtool-pending-update'; // persisted UpdateInfo while an update is known to be available
const STORAGE_CHECK_HOUR = 'devtool-update-check-hour';
const STORAGE_CHECK_MINUTE = 'devtool-update-check-minute';
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const DEFAULT_CHECK_HOUR = 6; // run the scheduled daily check at 6am local time by default
export const DEFAULT_CHECK_MINUTE = 0;

function loadCheckHour(): number {
  const raw = parseInt(localStorage.getItem(STORAGE_CHECK_HOUR) ?? '', 10);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : DEFAULT_CHECK_HOUR;
}

function loadCheckMinute(): number {
  const raw = parseInt(localStorage.getItem(STORAGE_CHECK_MINUTE) ?? '', 10);
  return Number.isInteger(raw) && raw >= 0 && raw <= 59 ? raw : DEFAULT_CHECK_MINUTE;
}

// Timestamp of the most recent daily-check boundary that has already passed.
// Used to enforce "check at most once a day": if the last check predates this, check again.
function lastDailyBoundary(hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); // before the time → use yesterday's boundary
  return d.getTime();
}

function msUntilNextDailyCheck(hour: number, minute: number): number {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
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
  const [status, setStatus] = useState<UpdateStatus>('idle');
  // Seed from persisted state so a previously-found update keeps its badge across restarts.
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(loadPendingUpdate);
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(() => loadPendingUpdate() !== null);
  const [error, setError] = useState<string | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_AUTO_CHECK);
    return stored === null ? true : stored === 'true'; // default on for fresh installs
  });
  const [checkHour, setCheckHourState] = useState<number>(loadCheckHour);
  const [checkMinute, setCheckMinuteState] = useState<number>(loadCheckMinute);

  const setCheckTime = useCallback((hour: number, minute: number) => {
    const h = Math.min(23, Math.max(0, Math.trunc(hour)));
    const m = Math.min(59, Math.max(0, Math.trunc(minute)));
    localStorage.setItem(STORAGE_CHECK_HOUR, String(h));
    localStorage.setItem(STORAGE_CHECK_MINUTE, String(m));
    setCheckHourState(h);
    setCheckMinuteState(m);
  }, []);

  // `auto` distinguishes background checks (on launch / 6am) from the manual "Check" button.
  // Automatic checks surface a popup whenever a new version is found.
  const runCheck = useCallback(async (auto = false) => {
    if (!isTauri) return;
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
        if (auto) setShowUpdateDialog(true);
      } else {
        // Confirmed up to date — clear the persisted badge.
        setUpdateInfo(null);
        setUpdateAvailable(false);
        localStorage.removeItem(STORAGE_PENDING_UPDATE);
        setStatus('not-available');
      }
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
    }
  }, []);

  // Manual check (e.g. the "Check" button) — never auto-pops the dialog.
  const checkForUpdates = useCallback(() => runCheck(false), [runCheck]);

  const dismissUpdateDialog = useCallback(() => setShowUpdateDialog(false), []);

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

  // Check on app open if not yet checked today; otherwise re-check daily at the chosen hour. (At most once a day.)
  useEffect(() => {
    if (!isTauri || !autoCheckEnabled) return;

    const lastCheck = parseInt(localStorage.getItem(STORAGE_LAST_CHECK) ?? '0', 10);
    if (lastCheck < lastDailyBoundary(checkHour, checkMinute)) {
      runCheck(true);
    }

    let id: ReturnType<typeof setTimeout>;
    function scheduleNextDailyCheck() {
      id = setTimeout(() => {
        runCheck(true);
        scheduleNextDailyCheck();
      }, msUntilNextDailyCheck(checkHour, checkMinute));
    }
    scheduleNextDailyCheck();

    return () => clearTimeout(id);
  }, [autoCheckEnabled, checkHour, checkMinute, runCheck]);

  // Auto-recover: when connectivity is restored, retry if the last check errored or is overdue.
  // This lets the app run offline and quietly catch up once the network is back.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (!isTauri || !autoCheckEnabled) return;
    function handleOnline() {
      if (statusRef.current === 'checking' || statusRef.current === 'downloading') return;
      const lastCheck = parseInt(localStorage.getItem(STORAGE_LAST_CHECK) ?? '0', 10);
      if (statusRef.current === 'error' || lastCheck < lastDailyBoundary(checkHour, checkMinute)) {
        runCheck(true);
      }
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [autoCheckEnabled, checkHour, checkMinute, runCheck]);

  return (
    <UpdateContext.Provider value={{
      status,
      updateInfo,
      error,
      autoCheckEnabled,
      updateAvailable,
      checkHour,
      checkMinute,
      setCheckTime,
      showUpdateDialog,
      dismissUpdateDialog,
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
