// Jira Cloud client for the Tasks tab: REST API v3 with an Atlassian API
// token (Basic auth, email:token). Calls go through `sdk.http.fetch`
// (tauri-plugin-http in the app, so no CORS), limited to `*.atlassian.net`
// by the task-tracker manifest. The token lives in `sdk.secrets` (vault);
// only site, email and JQL are stored in plain settings.
//
// Pure merge/mapping helpers live here too so they can be tested without a
// network: issues → tasks (mergeIssues), local status → transition
// (pickTransition), tracked time → worklogs (pendingWorklogs).

import type { PluginSdk } from '@/platform';
import type { Task, TimeEntry } from './store';
import { statusOf, type TaskPriority, type TaskStatus } from './todo';
import { uid } from './time';

export type StatusCategory = 'new' | 'indeterminate' | 'done';

/** What a task remembers about its Jira issue. */
export interface JiraLink {
  key: string;
  /** `https://acme.atlassian.net` — part of the identity, two sites can share keys. */
  site: string;
  statusName: string;
  statusCategory: StatusCategory;
  issueType?: string;
  /** Issue `updated`, ms. */
  updated: number;
  /** Due date the last pull saw (`YYYY-MM-DD`), to tell a Jira due from a local one. */
  due?: string | null;
  /** Last failed status push, so a refused transition is not retried in a loop. */
  pushError?: { category: StatusCategory; message: string } | null;
}

export interface JiraIssue {
  key: string;
  summary: string;
  statusName: string;
  statusCategory: StatusCategory;
  priority?: string;
  dueDate?: string | null;
  issueType?: string;
  updated: number;
}

export interface JiraConfig {
  site: string;
  email: string;
  jql: string;
  /** Change the issue's status in Jira when the task's status changes here. */
  pushStatus: boolean;
  /** Display name from /myself, shown as "Connected as …". */
  accountName?: string;
  lastSync?: number | null;
  /** Keys deleted locally: a sync does not bring them back. */
  hiddenKeys?: string[];
}

export const DEFAULT_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
export const API_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';
export const TOKEN_SECRET = 'jira:token';
const MAX_ISSUES = 500;

export type JiraErrorKind = 'auth' | 'forbidden' | 'notFound' | 'badRequest' | 'rateLimited' | 'network' | 'server';

export class JiraError extends Error {
  constructor(public kind: JiraErrorKind, message: string, public status?: number) {
    super(message);
    this.name = 'JiraError';
  }
}

/** `acme`, `acme.atlassian.net` or any URL on it → `https://acme.atlassian.net`. Null when not a Jira Cloud site. */
export function normalizeSite(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (/^[a-z0-9][a-z0-9-]*$/i.test(s)) s = `${s}.atlassian.net`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

export function issueUrl(site: string, key: string): string {
  return `${site}/browse/${encodeURIComponent(key)}`;
}

function basicAuth(email: string, token: string): string {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCodePoint(b);
  return `Basic ${btoa(bin)}`;
}

function categoryOf(raw: unknown): StatusCategory {
  return raw === 'done' || raw === 'indeterminate' ? raw : 'new';
}

interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    priority?: { name?: string } | null;
    duedate?: string | null;
    issuetype?: { name?: string };
    updated?: string;
  };
}

export function parseIssue(raw: RawIssue): JiraIssue {
  const f = raw.fields ?? {};
  const updated = f.updated ? Date.parse(f.updated) : 0;
  return {
    key: raw.key,
    summary: f.summary?.trim() || raw.key,
    statusName: f.status?.name ?? '',
    statusCategory: categoryOf(f.status?.statusCategory?.key),
    priority: f.priority?.name,
    dueDate: f.duedate ?? null,
    issueType: f.issuetype?.name,
    updated: Number.isNaN(updated) ? 0 : updated,
  };
}

const FIELDS = ['summary', 'status', 'priority', 'duedate', 'issuetype', 'updated'];

export interface JiraClient {
  myself(): Promise<{ accountId: string; displayName: string }>;
  search(jql: string): Promise<JiraIssue[]>;
  transitions(key: string): Promise<Array<{ id: string; name: string; to: { name: string; category: StatusCategory } }>>;
  transition(key: string, id: string): Promise<void>;
  addWorklog(key: string, w: { started: number; seconds: number; comment?: string }): Promise<{ id: string }>;
}

export function createJiraClient(sdk: PluginSdk, site: string, email: string, token: string): JiraClient {
  const auth = basicAuth(email, token);

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await sdk.http.fetch(`${site}${path}`, {
        method,
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new JiraError('network', e instanceof Error ? e.message : String(e));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new JiraError(errorKind(res.status), jiraMessage(text) || `HTTP ${res.status}`, res.status);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    myself: () => call('GET', '/rest/api/3/myself'),
    async search(jql) {
      const out: JiraIssue[] = [];
      let nextPageToken: string | undefined;
      do {
        const page = await call<{ issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(
          'POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) },
        );
        out.push(...(page.issues ?? []).map(parseIssue));
        nextPageToken = page.isLast ? undefined : page.nextPageToken;
      } while (nextPageToken && out.length < MAX_ISSUES);
      return out.slice(0, MAX_ISSUES);
    },
    async transitions(key) {
      const r = await call<{ transitions?: Array<{ id: string; name: string; to?: { name?: string; statusCategory?: { key?: string } } }> }>(
        'GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
      );
      return (r.transitions ?? []).map((t) => ({
        id: t.id, name: t.name, to: { name: t.to?.name ?? t.name, category: categoryOf(t.to?.statusCategory?.key) },
      }));
    },
    transition: (key, id) => call('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id } }),
    async addWorklog(key, w) {
      const body: Record<string, unknown> = { started: jiraDateTime(w.started), timeSpentSeconds: w.seconds };
      if (w.comment?.trim()) {
        body.comment = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: w.comment.trim() }] }] };
      }
      const r = await call<{ id: string }>('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/worklog`, body);
      return { id: String(r.id) };
    },
  };
}

function errorKind(status: number): JiraErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  if (status >= 500) return 'server';
  return 'badRequest';
}

/** Jira's `{ errorMessages: [...], errors: {field: msg} }` → one line. */
export function jiraMessage(text: string): string {
  try {
    const j = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
    const parts = [...(j.errorMessages ?? []), ...Object.values(j.errors ?? {})];
    if (j.message) parts.push(j.message);
    return parts.join(' ').trim();
  } catch {
    return '';
  }
}

/** `2026-11-03T09:05:00.000+0700`, the format worklog `started` requires. */
export function jiraDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${sign}${p(Math.trunc(off / 60))}${p(off % 60)}`;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function statusForCategory(c: StatusCategory): TaskStatus {
  if (c === 'done') return 'done';
  return c === 'indeterminate' ? 'doing' : 'todo';
}

export function categoryForStatus(s: TaskStatus): StatusCategory {
  if (s === 'done') return 'done';
  return s === 'doing' ? 'indeterminate' : 'new';
}

export function priorityFromJira(name: string | undefined): TaskPriority {
  const n = (name ?? '').toLowerCase();
  if (n === 'highest' || n === 'high' || n === 'blocker' || n === 'critical') return 'high';
  if (n === 'medium' || n === 'major') return 'medium';
  if (n === 'low' || n === 'lowest' || n === 'minor' || n === 'trivial') return 'low';
  return 'none';
}

function dueFromJira(date: string | null | undefined): number | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function linkFor(issue: JiraIssue, site: string, prev?: JiraLink): JiraLink {
  return {
    key: issue.key,
    site,
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    issueType: issue.issueType,
    updated: issue.updated,
    due: issue.dueDate ?? null,
    pushError: prev?.pushError && prev.pushError.category !== issue.statusCategory ? prev.pushError : null,
  };
}

/** Applies a pull. Jira owns summary, status, priority and — when Jira has
 *  one or the local one came from Jira — the due date. Notes, reminder and
 *  project stay local. New issues not done in Jira become tasks. */
export function mergeIssues(
  tasks: Task[],
  issues: JiraIssue[],
  site: string,
  now: number,
  opts: { hiddenKeys?: string[]; keepStatusFor?: Set<string> } = {},
): { tasks: Task[]; added: number; updated: number } {
  const hidden = new Set(opts.hiddenKeys ?? []);
  const keepStatus = opts.keepStatusFor ?? new Set<string>();
  const byKey = new Map(issues.map((i) => [i.key, i]));
  let updated = 0;
  const seen = new Set<string>();
  const next = tasks.map((t) => {
    if (t.jira?.site !== site) return t;
    const issue = byKey.get(t.jira.key);
    if (!issue) return t;
    seen.add(issue.key);
    const status = statusForCategory(issue.statusCategory);
    const jiraDue = dueFromJira(issue.dueDate);
    const localDueFromJira = t.dueAt == null || t.dueAt === dueFromJira(t.jira.due);
    // A local status change still on its way to Jira keeps its status and
    // the old Jira category, so the push still sees it as pending.
    const keep = keepStatus.has(t.jira.key);
    const patch: Partial<Task> = {
      name: issue.summary,
      priority: priorityFromJira(issue.priority),
      jira: keep ? { ...linkFor(issue, site, t.jira), statusCategory: t.jira.statusCategory, statusName: t.jira.statusName } : linkFor(issue, site, t.jira),
    };
    if (!keep && statusOf(t) !== status) {
      Object.assign(patch, { status, completed: status === 'done', completedAt: status === 'done' ? now : null });
    }
    if (localDueFromJira) Object.assign(patch, { dueAt: jiraDue, dueHasTime: false });
    const merged = { ...t, ...patch };
    if (JSON.stringify(merged) !== JSON.stringify(t)) updated++;
    return merged;
  });
  let added = 0;
  for (const issue of issues) {
    if (seen.has(issue.key) || hidden.has(issue.key) || issue.statusCategory === 'done') continue;
    const status = statusForCategory(issue.statusCategory);
    next.push({
      id: uid(),
      name: issue.summary,
      projectId: null,
      parentId: null,
      linkedIds: [],
      completed: false,
      createdAt: now,
      status,
      priority: priorityFromJira(issue.priority),
      dueAt: dueFromJira(issue.dueDate),
      dueHasTime: false,
      jira: linkFor(issue, site),
    });
    added++;
  }
  return { tasks: next, added, updated };
}

/** Linked tasks whose status here no longer matches Jira's — changed locally
 *  and not pushed yet (and not already refused for that status). */
export function pendingStatusPushes(tasks: Task[], site: string): Array<{ task: Task; category: StatusCategory }> {
  const out: Array<{ task: Task; category: StatusCategory }> = [];
  for (const t of tasks) {
    if (t.jira?.site !== site) continue;
    const category = categoryForStatus(statusOf(t));
    if (category === t.jira.statusCategory) continue;
    if (t.jira.pushError?.category === category) continue;
    out.push({ task: t, category });
  }
  return out;
}

/** The transition that lands in `category`; prefers one named like the
 *  usual status ("In Progress", "Done", "To Do") when several do. */
export function pickTransition<T extends { name: string; to: { name: string; category: StatusCategory } }>(
  list: T[],
  category: StatusCategory,
): T | null {
  const matching = list.filter((t) => t.to.category === category);
  if (matching.length <= 1) return matching[0] ?? null;
  const preferred = { new: /^to ?do$/i, indeterminate: /^in progress$/i, done: /^done$/i }[category];
  return matching.find((t) => preferred.test(t.to.name)) ?? matching[0];
}

/** Finished entries on `taskId` not yet sent to Jira, at least a minute long. */
export function pendingWorklogs(entries: TimeEntry[], taskId: string): TimeEntry[] {
  return entries.filter((e) => e.taskId === taskId && e.end !== null && !e.jiraWorklogId && e.end - e.start >= 60_000);
}

/** Jira shows worklogs in minutes; round each entry to the nearest one. */
export function worklogSeconds(e: Pick<TimeEntry, 'start' | 'end'>): number {
  return Math.max(60, Math.round(((e.end ?? e.start) - e.start) / 60_000) * 60);
}
