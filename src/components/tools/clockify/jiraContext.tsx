// Jira state for the Time Tracker suite: the connection, pulls (on open, every
// 15 minutes while the suite is mounted, and on demand), status pushes when a
// linked task's status changes here, and worklogs from tracked time. The API
// layer and the pure merge rules are in jira.ts.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { useClockify, type Task } from './store';
import {
  DEFAULT_JQL, JiraError, categoryForStatus, TOKEN_SECRET, createJiraClient, issueUrl, mergeIssues, normalizeSite,
  pendingStatusPushes, pendingWorklogs, pickTransition, worklogSeconds,
  type JiraClient, type JiraConfig, type StatusCategory,
} from './jira';
import { statusOf } from './todo';

const AUTO_SYNC_MS = 15 * 60_000;
const STALE_MS = 10 * 60_000;

export interface SyncResult {
  added: number;
  updated: number;
  at: number;
}

export interface ConnectInput {
  site: string;
  email: string;
  token: string;
  jql: string;
  pushStatus: boolean;
}

interface JiraContextValue {
  config: JiraConfig | null;
  /** Config saved and a token in the vault. */
  connected: boolean;
  syncing: boolean;
  lastResult: SyncResult | null;
  error: JiraError | null;
  /** Checks the credentials against /myself, then saves them. */
  connect: (input: ConnectInput) => Promise<string>;
  updateConfig: (patch: Partial<Pick<JiraConfig, 'jql' | 'pushStatus'>>) => void;
  disconnect: () => Promise<void>;
  sync: () => Promise<void>;
  openIssue: (task: Task) => void;
  /** Sends the task's unlogged time; resolves to what was sent. */
  logWork: (task: Task) => Promise<{ count: number; seconds: number }>;
  /** Deleting a linked task here: keep the next sync from re-adding it. */
  hideIssue: (key: string) => void;
  unhideAll: () => void;
  retryPush: (task: Task) => void;
  pushing: Set<string>;
}

const JiraContext = createContext<JiraContextValue | null>(null);

export function JiraProvider({ children }: { children: ReactNode }) {
  const sdk = usePluginSdkFor('task-tracker');
  const { tasks, entries, applyTasks, updateTask, updateEntry } = useClockify();
  const [config, setConfig] = usePluginState<JiraConfig | null>(sdk, 'jira:config', null);
  const [hasToken, setHasToken] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<JiraError | null>(null);
  const [pushing, setPushing] = useState<Set<string>>(() => new Set());
  const token = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const configRef = useRef(config);
  configRef.current = config;

  // The token is read once from the vault; until then nothing is "connected".
  useEffect(() => {
    let cancelled = false;
    sdk.secrets.get(TOKEN_SECRET).then((t) => {
      if (cancelled) return;
      token.current = t;
      setHasToken(!!t);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sdk]);

  const connected = !!config && hasToken;

  const client = useCallback((): JiraClient | null => {
    const c = configRef.current;
    if (!c || !token.current) return null;
    return createJiraClient(sdk, c.site, c.email, token.current);
  }, [sdk]);

  const connect = useCallback(async (input: ConnectInput) => {
    const site = normalizeSite(input.site);
    if (!site) throw new JiraError('badRequest', 'site');
    const email = input.email.trim();
    const me = await createJiraClient(sdk, site, email, input.token.trim()).myself();
    await sdk.secrets.set(TOKEN_SECRET, input.token.trim());
    token.current = input.token.trim();
    setHasToken(true);
    setConfig((prev) => ({
      site,
      email,
      jql: input.jql.trim() || DEFAULT_JQL,
      pushStatus: input.pushStatus,
      accountName: me.displayName,
      lastSync: prev?.site === site ? prev.lastSync ?? null : null,
      hiddenKeys: prev?.site === site ? prev.hiddenKeys ?? [] : [],
    }));
    setError(null);
    return me.displayName;
  }, [sdk, setConfig]);

  const updateConfig = useCallback((patch: Partial<Pick<JiraConfig, 'jql' | 'pushStatus'>>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }, [setConfig]);

  const disconnect = useCallback(async () => {
    await sdk.secrets.delete(TOKEN_SECRET).catch(() => {});
    token.current = null;
    setHasToken(false);
    setConfig(null);
    setError(null);
    setLastResult(null);
  }, [sdk, setConfig]);

  const syncingRef = useRef(false);
  const sync = useCallback(async () => {
    const c = configRef.current;
    const api = client();
    if (!c || !api || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const issues = await api.search(c.jql || DEFAULT_JQL);
      // Linked tasks the JQL no longer returns (usually: done in Jira) are
      // refreshed by key so their status follows.
      const found = new Set(issues.map((i) => i.key));
      const stale = tasksRef.current
        .filter((t) => t.jira?.site === c.site && !found.has(t.jira.key) && t.jira.statusCategory !== 'done')
        .map((t) => t.jira!.key);
      for (let i = 0; i < stale.length; i += 50) {
        const keys = stale.slice(i, i + 50).map((k) => `"${k.replaceAll('"', '')}"`).join(',');
        try {
          issues.push(...(await api.search(`key in (${keys})`)));
        } catch (e) {
          // A deleted or moved issue makes the whole `key in` query fail; skip.
          if (!(e instanceof JiraError) || e.kind !== 'badRequest') throw e;
        }
      }
      const now = Date.now();
      let added = 0;
      let updated = 0;
      applyTasks((prev) => {
        const keepStatusFor = new Set(c.pushStatus ? pendingStatusPushes(prev, c.site).map((p) => p.task.jira!.key) : []);
        const r = mergeIssues(prev, issues, c.site, now, { hiddenKeys: c.hiddenKeys, keepStatusFor });
        added = r.added;
        updated = r.updated;
        return r.tasks;
      });
      setConfig((prev) => (prev ? { ...prev, lastSync: now } : prev));
      setLastResult({ added, updated, at: now });
      setError(null);
    } catch (e) {
      setError(e instanceof JiraError ? e : new JiraError('network', String(e)));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [client, applyTasks, setConfig]);

  // Pull when the suite opens on stale data, then every 15 minutes.
  useEffect(() => {
    if (!connected) return;
    const last = configRef.current?.lastSync ?? 0;
    if (Date.now() - last > STALE_MS) void sync();
    const id = window.setInterval(() => { void sync(); }, AUTO_SYNC_MS);
    return () => window.clearInterval(id);
  }, [connected, sync]);

  // Push local status changes of linked tasks as Jira transitions.
  const inFlight = useRef(new Set<string>());
  const push = useCallback(async (task: Task, category: StatusCategory) => {
    const api = client();
    const link = task.jira;
    if (!api || !link || inFlight.current.has(link.key)) return;
    inFlight.current.add(link.key);
    setPushing(new Set(inFlight.current));
    const latest = () => tasksRef.current.find((t) => t.id === task.id);
    try {
      const options = await api.transitions(link.key);
      const pick = pickTransition(options, category);
      if (!pick) throw new JiraError('badRequest', `no-transition:${category}`);
      await api.transition(link.key, pick.id);
      const cur = latest();
      if (cur?.jira) updateTask(cur.id, { jira: { ...cur.jira, statusCategory: pick.to.category, statusName: pick.to.name, pushError: null } });
    } catch (e) {
      const cur = latest();
      const message = e instanceof Error ? e.message : String(e);
      if (cur?.jira) updateTask(cur.id, { jira: { ...cur.jira, pushError: { category, message } } });
    } finally {
      inFlight.current.delete(link.key);
      setPushing(new Set(inFlight.current));
    }
  }, [client, updateTask]);

  useEffect(() => {
    if (!connected || !config?.pushStatus) return;
    for (const { task, category } of pendingStatusPushes(tasks, config.site)) void push(task, category);
  }, [tasks, connected, config?.pushStatus, config?.site, push]);

  const retryPush = useCallback((task: Task) => {
    if (!task.jira) return;
    const category = categoryForStatus(statusOf(task));
    updateTask(task.id, { jira: { ...task.jira, pushError: null } });
    void push({ ...task, jira: { ...task.jira, pushError: null } }, category);
  }, [push, updateTask]);

  const openIssue = useCallback((task: Task) => {
    if (task.jira) void sdk.openExternal(issueUrl(task.jira.site, task.jira.key)).catch(() => {});
  }, [sdk]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const logWork = useCallback(async (task: Task) => {
    const api = client();
    if (!api || !task.jira) throw new JiraError('auth', 'not connected');
    let count = 0;
    let seconds = 0;
    for (const e of pendingWorklogs(entriesRef.current, task.id)) {
      const s = worklogSeconds(e);
      const { id } = await api.addWorklog(task.jira.key, { started: e.start, seconds: s, comment: e.subtask ?? undefined });
      updateEntry(e.id, { jiraWorklogId: id });
      count++;
      seconds += s;
    }
    return { count, seconds };
  }, [client, updateEntry]);

  const hideIssue = useCallback((key: string) => {
    setConfig((prev) => (prev ? { ...prev, hiddenKeys: [...new Set([...(prev.hiddenKeys ?? []), key])] } : prev));
  }, [setConfig]);

  const unhideAll = useCallback(() => {
    setConfig((prev) => (prev ? { ...prev, hiddenKeys: [] } : prev));
  }, [setConfig]);

  const value = useMemo<JiraContextValue>(() => ({
    config, connected, syncing, lastResult, error,
    connect, updateConfig, disconnect, sync, openIssue, logWork, hideIssue, unhideAll, retryPush, pushing,
  }), [config, connected, syncing, lastResult, error, connect, updateConfig, disconnect, sync, openIssue, logWork, hideIssue, unhideAll, retryPush, pushing]);

  return <JiraContext.Provider value={value}>{children}</JiraContext.Provider>;
}

export function useJira(): JiraContextValue {
  const ctx = useContext(JiraContext);
  if (!ctx) throw new Error('useJira must be used within JiraProvider');
  return ctx;
}
