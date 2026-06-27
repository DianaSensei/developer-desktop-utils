import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { defaultConfig, type MockConfig, type MockStatus, type ScriptResult, type Stub } from './types';
import { clearRequestLog, getRequestLog, subscribeRequestLog } from './requestLogStore';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// The Rust side ignores unknown fields, so we send the whole config (including
// UI-only stub `id`/`name` and the host/port) untouched on start / update.
export function useMockServer() {
  const [config, setConfig] = usePersistentState<MockConfig>('devtool:mockServer:config', defaultConfig());
  const [status, setStatus] = useState<MockStatus>({ running: false, host: '', port: 0 });
  // Request log lives in an app-lifetime store so it captures requests fired
  // from other tools (API Client) or a browser while this tab isn't open.
  const log = useSyncExternalStore(subscribeRequestLog, getRequestLog, getRequestLog);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Latest config for the debounced live-update effect without re-subscribing.
  const configRef = useRef(config);
  configRef.current = config;
  const runningRef = useRef(status.running);
  runningRef.current = status.running;

  // Reconcile with the backend on mount (survives tab switches / reloads).
  useEffect(() => {
    if (!isTauri) return;
    invoke<MockStatus>('mock_status').then(setStatus).catch(() => {});
  }, []);

  // Hot-swap rules on the running server when stubs / fallback settings change.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isTauri || !runningRef.current) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      invoke('mock_update_rules', { config: configRef.current }).catch(() => {});
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [config.stubs, config.notFoundStatus, config.notFoundBody, config.notFoundContentType]);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const cfg = configRef.current;
      const next = await invoke<MockStatus>('mock_start', { config: cfg, host: cfg.host, port: cfg.port });
      setStatus(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await invoke('mock_stop');
      setStatus({ running: false, host: '', port: 0 });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const updateConfig = useCallback(
    (patch: Partial<MockConfig>) => setConfig((prev) => ({ ...prev, ...patch })),
    [setConfig],
  );

  const updateStub = useCallback(
    (id: string, patch: Partial<Stub>) =>
      setConfig((prev) => ({ ...prev, stubs: prev.stubs.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    [setConfig],
  );

  const testScript = useCallback(
    (script: string, sample: Record<string, unknown>) =>
      invoke<ScriptResult>('mock_test_script', { script, sample }),
    [],
  );

  const clearLog = useCallback(() => clearRequestLog(), []);

  return {
    config,
    setConfig,
    updateConfig,
    updateStub,
    status,
    log,
    error,
    busy,
    start,
    stop,
    testScript,
    clearLog,
  };
}
