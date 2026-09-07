import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { defaultConfig, newStub, type MockConfig, type MockStatus, type ScriptResult, type Stub } from './types';
import { clearRequestLog, getRequestLog, subscribeRequestLog } from './requestLogStore';
import { isTauri } from '@/lib/platform';
export { isTauri };

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

  // Both re-throw after recording `error` for the UI, so a caller that wants
  // the outcome (the MCP bridge) can await/catch it directly instead of
  // re-reading state; the toolbar's onClick swallows the rejection since it
  // already renders `error`.
  const start = useCallback(async (): Promise<MockStatus> => {
    setError(null);
    setBusy(true);
    try {
      const cfg = configRef.current;
      const next = await invoke<MockStatus>('mock_start', { config: cfg, host: cfg.host, port: cfg.port });
      setStatus(next);
      return next;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await invoke('mock_stop');
      setStatus({ running: false, host: '', port: 0 });
    } catch (e) {
      setError(String(e));
      throw e;
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

  // Stub list mutations — shared by the UI (MockServer.tsx's toolbar/row
  // actions) and the MCP bridge, so there's one place that knows how to
  // add/clone/delete/reorder a stub rather than two.
  const addStub = useCallback((patch?: Partial<Stub>): Stub => {
    const s: Stub = { ...newStub(), ...patch };
    setConfig((prev) => ({ ...prev, stubs: [...prev.stubs, s] }));
    return s;
  }, [setConfig]);

  const duplicateStub = useCallback((id: string): Stub | null => {
    const source = configRef.current.stubs.find((s) => s.id === id);
    if (!source) return null;
    const copy: Stub = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} copy` };
    setConfig((prev) => {
      const i = prev.stubs.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const stubs = [...prev.stubs];
      stubs.splice(i + 1, 0, copy);
      return { ...prev, stubs };
    });
    return copy;
  }, [setConfig]);

  const deleteStub = useCallback(
    (id: string) => setConfig((prev) => ({ ...prev, stubs: prev.stubs.filter((s) => s.id !== id) })),
    [setConfig],
  );

  // Order matters (first match wins), so both the UI and the MCP bridge can
  // reorder stubs relative to each other.
  const moveStub = useCallback((id: string, dir: -1 | 1) => {
    setConfig((prev) => {
      const i = prev.stubs.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.stubs.length) return prev;
      const stubs = [...prev.stubs];
      [stubs[i], stubs[j]] = [stubs[j], stubs[i]];
      return { ...prev, stubs };
    });
  }, [setConfig]);

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
    addStub,
    duplicateStub,
    deleteStub,
    moveStub,
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

export type MockServerState = ReturnType<typeof useMockServer>;
