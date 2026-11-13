/**
 * Claude Manager — pure logic over what the Rust `claude_monitor_scan`
 * command returns: session status, usage aggregation and cost estimates.
 * No React and no SDK here, so it is all unit-testable.
 */

// ── Wire types (mirror src-tauri/src/claude_monitor.rs) ──────────────────

export interface Account {
  email: string | null;
  organization: string | null;
  displayName: string | null;
}

export interface UsageBucket {
  /** Hours since the Unix epoch (UTC). */
  hour: number;
  model: string;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  requests: number;
}

export interface LiveInfo {
  pid: number;
  status: string | null;
  kind: string | null;
  name: string | null;
  entrypoint: string | null;
  updatedAt: number | null;
}

export interface SessionInfo {
  id: string;
  project: string;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
  version: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  prompts: number;
  subagents: number;
  lastRole: string | null;
  lastStopReason: string | null;
  live: LiveInfo | null;
  buckets: UsageBucket[];
}

export interface ProfileSnapshot {
  configDir: string;
  exists: boolean;
  account: Account | null;
  sessions: SessionInfo[];
}

/** One tracked account = one Claude Code config directory. */
export interface Profile {
  id: string;
  label: string;
  configDir: string;
}

/** A config directory found by `claude_monitor_detect`. */
export interface Detected {
  /** `~`-shortened when under the home folder. */
  configDir: string;
  source: 'default' | 'env' | 'process' | 'scan' | 'custom';
  /** False only for a folder the user named that holds no Claude Code data. */
  valid: boolean;
  email: string | null;
  sessions: number;
}

export const DEFAULT_PROFILE: Profile = { id: 'default', label: 'Default', configDir: '~/.claude' };

// ── Status ───────────────────────────────────────────────────────────────

export type SessionStatus = 'working' | 'waiting' | 'idle' | 'ended';

/**
 * A transcript touched this recently counts as running even without a
 * registry entry — Claude Code versions before the registry, and SDK runs,
 * leave only the transcript.
 */
export const RECENT_ACTIVITY_MS = 2 * 60_000;

export function sessionStatus(session: SessionInfo, now: number): SessionStatus {
  if (session.live) {
    const status = (session.live.status ?? '').toLowerCase();
    if (status === 'busy' || status === 'working' || status === 'running') return 'working';
    if (/wait|permission|input|block|approval/.test(status)) return 'waiting';
    return 'idle';
  }
  const last = session.lastActivityAt;
  return last !== null && now - last < RECENT_ACTIVITY_MS ? 'working' : 'ended';
}

export const isRunning = (status: SessionStatus) => status !== 'ended';

// ── Pricing ──────────────────────────────────────────────────────────────

interface Price {
  /** USD per million tokens. */
  input: number;
  output: number;
  /** Defaults to 0.1 × input when the list price does not say otherwise. */
  cacheRead?: number;
}

/**
 * Anthropic API list prices, matched by model-id prefix (longest wins, so
 * dated ids such as `claude-opus-4-5-20251101` resolve too). Subscription
 * plans are not billed per token — the figure is "what this usage would
 * cost on the API", useful for comparing sessions and accounts.
 */
const PRICES: Array<[prefix: string, price: Price]> = [
  ['claude-fable-5-2', { input: 8, output: 40, cacheRead: 0.2 }],
  ['claude-mythos-5-2', { input: 8, output: 40, cacheRead: 0.2 }],
  ['claude-fable-5', { input: 10, output: 50 }],
  ['claude-mythos-5', { input: 10, output: 50 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25 }],
  ['claude-opus-4-8', { input: 5, output: 25 }],
  ['claude-opus-4-7', { input: 5, output: 25 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-opus-4-5', { input: 5, output: 25 }],
  ['claude-opus-4', { input: 15, output: 75 }],
  ['claude-3-opus', { input: 15, output: 75 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.1 }],
  ['claude-sonnet-5', { input: 2, output: 10 }],
  ['claude-sonnet-4', { input: 3, output: 15 }],
  ['claude-3-7-sonnet', { input: 3, output: 15 }],
  ['claude-3-5-sonnet', { input: 3, output: 15 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5 }],
  ['claude-haiku-4-5', { input: 1, output: 5 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  ['claude-3-haiku', { input: 0.25, output: 1.25 }],
];

const PRICES_LONGEST_FIRST = [...PRICES].sort((a, b) => b[0].length - a[0].length);

function priceFor(model: string): Price | null {
  // Bedrock / Vertex ids carry a provider prefix ("anthropic.", "us.anthropic.").
  const id = model.slice(Math.max(0, model.indexOf('claude-')));
  return PRICES_LONGEST_FIRST.find(([prefix]) => id.startsWith(prefix))?.[1] ?? null;
}

type Tokens = Omit<UsageBucket, 'hour' | 'model' | 'requests'>;

/** API-equivalent cost in USD, or `null` for a model with no known price. */
export function estimateCost(model: string, t: Tokens): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const perToken = 1 / 1_000_000;
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheWrite5m * p.input * 1.25 +
      t.cacheWrite1h * p.input * 2 +
      t.cacheRead * (p.cacheRead ?? p.input * 0.1)) *
    perToken
  );
}

// ── Aggregation ──────────────────────────────────────────────────────────

export interface UsageTotals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  /** Everything the model processed: input + output + cache writes + reads. */
  tokens: number;
  requests: number;
  cost: number;
  /** Requests on models with no known price (left out of `cost`). */
  unpriced: number;
}

export const emptyTotals = (): UsageTotals => ({
  input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, requests: 0, cost: 0, unpriced: 0,
});

export function addBucket(totals: UsageTotals, b: UsageBucket): UsageTotals {
  const cacheWrite = b.cacheWrite5m + b.cacheWrite1h;
  totals.input += b.input;
  totals.output += b.output;
  totals.cacheWrite += cacheWrite;
  totals.cacheRead += b.cacheRead;
  totals.tokens += b.input + b.output + cacheWrite + b.cacheRead;
  totals.requests += b.requests;
  const cost = estimateCost(b.model, b);
  if (cost === null) totals.unpriced += b.requests;
  else totals.cost += cost;
  return totals;
}

export const MS_PER_HOUR = 3_600_000;

export type RangeId = 'today' | '7d' | '30d' | 'all';

/** First epoch-hour inside the range, in the viewer's local time. */
export function rangeStartHour(range: RangeId, now: number): number {
  if (range === 'all') return 0;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === '7d') start.setDate(start.getDate() - 6);
  if (range === '30d') start.setDate(start.getDate() - 29);
  return Math.floor(start.getTime() / MS_PER_HOUR);
}

/** A session tagged with the profile it was read from. */
export interface SessionRow extends SessionInfo {
  profileId: string;
}

export function sessionTotals(session: SessionInfo, fromHour = 0): UsageTotals {
  const totals = emptyTotals();
  for (const b of session.buckets) if (b.hour >= fromHour) addBucket(totals, b);
  return totals;
}

export interface UsageGroup {
  key: string;
  totals: UsageTotals;
}

function groupBuckets(
  sessions: SessionRow[],
  fromHour: number,
  keyOf: (bucket: UsageBucket, session: SessionRow) => string,
): Map<string, UsageTotals> {
  const groups = new Map<string, UsageTotals>();
  for (const session of sessions) {
    for (const b of session.buckets) {
      if (b.hour < fromHour) continue;
      const key = keyOf(b, session);
      let totals = groups.get(key);
      if (!totals) groups.set(key, (totals = emptyTotals()));
      addBucket(totals, b);
    }
  }
  return groups;
}

const byTokensDesc = (a: UsageGroup, b: UsageGroup) => b.totals.tokens - a.totals.tokens;

const toGroups = (map: Map<string, UsageTotals>): UsageGroup[] =>
  [...map].map(([key, totals]) => ({ key, totals }));

export function localDayKey(hour: number): string {
  const d = new Date(hour * MS_PER_HOUR);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Newest day first. */
export function usageByDay(sessions: SessionRow[], fromHour: number): UsageGroup[] {
  return toGroups(groupBuckets(sessions, fromHour, (b) => localDayKey(b.hour)))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function usageByModel(sessions: SessionRow[], fromHour: number): UsageGroup[] {
  return toGroups(groupBuckets(sessions, fromHour, (b) => b.model)).sort(byTokensDesc);
}

export function usageByProject(sessions: SessionRow[], fromHour: number): UsageGroup[] {
  return toGroups(groupBuckets(sessions, fromHour, (_, s) => projectName(s))).sort(byTokensDesc);
}

export function usageByProfile(sessions: SessionRow[], fromHour: number): Map<string, UsageTotals> {
  return groupBuckets(sessions, fromHour, (_, s) => s.profileId);
}

export function totalUsage(sessions: SessionRow[], fromHour: number): UsageTotals {
  return groupBuckets(sessions, fromHour, () => 'all').get('all') ?? emptyTotals();
}

/**
 * Claude subscription limits reset on a 5-hour window. Buckets are hourly,
 * so this covers the current hour and the four before it.
 */
export function lastFiveHoursStart(now: number): number {
  return Math.floor(now / MS_PER_HOUR) - 4;
}

// ── Display helpers ──────────────────────────────────────────────────────

/** Last path segment of the working directory, or the transcript folder. */
export function projectName(session: SessionInfo): string {
  const cwd = session.cwd?.replace(/[\\/]+$/, '');
  if (cwd) return cwd.split(/[\\/]/).pop() || cwd;
  return session.project || '—';
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(usd < 100 ? 2 : 0)}`;
}

/** `claude-opus-5-5-20260401` → `opus-5-5`. */
export function shortModel(model: string): string {
  return model
    .slice(Math.max(0, model.indexOf('claude-')))
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '');
}

/** Models a session used, heaviest first. */
export function sessionModels(session: SessionInfo): string[] {
  const tokens = new Map<string, number>();
  for (const b of session.buckets) {
    tokens.set(b.model, (tokens.get(b.model) ?? 0) + b.input + b.output + b.cacheRead);
  }
  return [...tokens].sort((a, b) => b[1] - a[1]).map(([model]) => model);
}

const needsQuoting = (s: string) => /[^A-Za-z0-9_\-./~:@]/.test(s);
const shellQuote = (s: string) => (needsQuoting(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);

/** `CLAUDE_CONFIG_DIR=…` prefix; empty for the default directory. */
function configPrefix(profile: Profile): string {
  return profile.configDir === DEFAULT_PROFILE.configDir
    ? ''
    : `CLAUDE_CONFIG_DIR=${shellQuote(profile.configDir)} `;
}

/** Shell command that starts Claude Code signed in as `profile`. */
export function launchCommand(profile: Profile): string {
  return `${configPrefix(profile)}claude`;
}

/** Shell command that reopens `session` in its own folder and account. */
export function resumeCommand(session: SessionInfo, profile: Profile): string {
  const cd = session.cwd ? `cd ${shellQuote(session.cwd)} && ` : '';
  return `${cd}${configPrefix(profile)}claude --resume ${session.id}`;
}

/** A label for a detected directory: `~/.claude-work` → `work`. */
export function labelFromDir(configDir: string): string {
  const name = configDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? configDir;
  const suffix = name.replace(/^\.claude[-_]?/, '');
  return suffix || DEFAULT_PROFILE.label;
}

/** `labelFromDir`, falling back to the path itself when the name is taken. */
export function uniqueLabel(configDir: string, taken: string[]): string {
  const label = labelFromDir(configDir);
  return taken.includes(label) ? configDir : label;
}

// ── Chart ────────────────────────────────────────────────────────────────

/** Above this many days the chart switches to one bar per week. */
export const MAX_DAILY_BARS = 62;

export interface ChartBar {
  /** Local date the bar starts on, `YYYY-MM-DD`. */
  key: string;
  totals: UsageTotals;
}

export interface ChartSeries {
  granularity: 'day' | 'week';
  bars: ChartBar[];
}

const dayKeyOf = (date: Date) => localDayKey(Math.floor(date.getTime() / MS_PER_HOUR));

/**
 * One bar per local day from the first day with usage (or the range start)
 * to today, with empty days kept so gaps read as gaps. Long ranges fold
 * into weeks ending today.
 */
export function chartSeries(sessions: SessionRow[], fromHour: number, now: number): ChartSeries {
  const byDay = new Map(usageByDay(sessions, fromHour).map((g) => [g.key, g.totals]));
  if (byDay.size === 0) return { granularity: 'day', bars: [] };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstUsed = [...byDay.keys()].sort()[0];
  const rangeStart = fromHour > 0 ? localDayKey(fromHour) : firstUsed;
  const days: ChartBar[] = [];
  for (const cursor = new Date(today); ; cursor.setDate(cursor.getDate() - 1)) {
    const key = dayKeyOf(cursor);
    if (key < rangeStart && key < firstUsed) break;
    days.unshift({ key, totals: byDay.get(key) ?? emptyTotals() });
    if (days.length > 366 * 5) break;
  }
  if (days.length <= MAX_DAILY_BARS) return { granularity: 'day', bars: days };

  const weeks: ChartBar[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const slice = days.slice(Math.max(0, end - 7), end);
    const totals = emptyTotals();
    for (const day of slice) {
      for (const field of Object.keys(totals) as Array<keyof UsageTotals>) totals[field] += day.totals[field];
    }
    weeks.unshift({ key: slice[0].key, totals });
  }
  return { granularity: 'week', bars: weeks };
}

// ── Budgets ──────────────────────────────────────────────────────────────

/** Spending limits in USD of estimated cost; 0 turns one off. */
export interface Budgets {
  dailyUsd: number;
  monthlyUsd: number;
}

export const NO_BUDGETS: Budgets = { dailyUsd: 0, monthlyUsd: 0 };

export type BudgetLevel = 'ok' | 'warn' | 'over';
export type BudgetPeriod = 'daily' | 'monthly';

/** Share of a budget at which the first warning fires. */
export const BUDGET_WARN_RATIO = 0.8;

export interface BudgetState {
  period: BudgetPeriod;
  /** `2026-11-13` or `2026-11` — changes when the period rolls over. */
  periodKey: string;
  limit: number;
  spent: number;
  ratio: number;
  level: BudgetLevel;
}

export function monthStartHour(now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  return Math.floor(start.getTime() / MS_PER_HOUR);
}

/** State of each budget that is switched on, across every account. */
export function budgetStates(sessions: SessionRow[], budgets: Budgets, now: number): BudgetState[] {
  const today = localDayKey(Math.floor(now / MS_PER_HOUR));
  const periods: Array<[BudgetPeriod, number, number, string]> = [
    ['daily', budgets.dailyUsd, rangeStartHour('today', now), today],
    ['monthly', budgets.monthlyUsd, monthStartHour(now), today.slice(0, 7)],
  ];
  return periods
    .filter(([, limit]) => limit > 0)
    .map(([period, limit, fromHour, periodKey]) => {
      const spent = totalUsage(sessions, fromHour).cost;
      const ratio = spent / limit;
      const level: BudgetLevel = ratio >= 1 ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok';
      return { period, periodKey, limit, spent, ratio, level };
    });
}

/** What was last announced per period, as `<periodKey>:<level>`. */
export type BudgetAlertLog = Partial<Record<BudgetPeriod, string>>;

/**
 * Budgets that crossed a threshold not yet announced for their current
 * period. Returns the alerts and the log to store, so each crossing is
 * announced once however often the usage is rescanned.
 */
export function dueBudgetAlerts(states: BudgetState[], log: BudgetAlertLog): { due: BudgetState[]; log: BudgetAlertLog } {
  const next: BudgetAlertLog = { ...log };
  const due: BudgetState[] = [];
  for (const state of states) {
    if (state.level === 'ok') continue;
    const stamp = `${state.periodKey}:${state.level}`;
    // "over" was announced: a later rescan at "warn" level cannot happen
    // within a period, and must not re-announce if it somehow does.
    if (log[state.period] === stamp || log[state.period] === `${state.periodKey}:over`) continue;
    next[state.period] = stamp;
    due.push(state);
  }
  return { due, log: next };
}

// ── Export ───────────────────────────────────────────────────────────────

export interface ExportRow {
  date: string;
  account: string;
  project: string;
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  requests: number;
  tokens: number;
  /** `null` when the model has no known price. */
  costUsd: number | null;
}

/** One row per day × account × project × model, oldest day first. */
export function exportRows(sessions: SessionRow[], profiles: Profile[], fromHour: number): ExportRow[] {
  const labels = new Map(profiles.map((p) => [p.id, p.label]));
  const rows = new Map<string, ExportRow>();
  for (const session of sessions) {
    const account = labels.get(session.profileId) ?? session.profileId;
    const project = projectName(session);
    for (const b of session.buckets) {
      if (b.hour < fromHour) continue;
      const date = localDayKey(b.hour);
      const key = [date, account, project, b.model].join('\u0000');
      let row = rows.get(key);
      if (!row) {
        row = {
          date, account, project, model: b.model, input: 0, output: 0, cacheWrite: 0, cacheRead: 0,
          requests: 0, tokens: 0, costUsd: estimateCost(b.model, b) === null ? null : 0,
        };
        rows.set(key, row);
      }
      const cacheWrite = b.cacheWrite5m + b.cacheWrite1h;
      row.input += b.input;
      row.output += b.output;
      row.cacheWrite += cacheWrite;
      row.cacheRead += b.cacheRead;
      row.requests += b.requests;
      row.tokens += b.input + b.output + cacheWrite + b.cacheRead;
      const cost = estimateCost(b.model, b);
      if (row.costUsd !== null && cost !== null) row.costUsd += cost;
    }
  }
  return [...rows.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.account.localeCompare(b.account) ||
    a.project.localeCompare(b.project) || a.model.localeCompare(b.model));
}

const EXPORT_COLUMNS: Array<[header: string, value: (row: ExportRow) => string | number]> = [
  ['date', (r) => r.date],
  ['account', (r) => r.account],
  ['project', (r) => r.project],
  ['model', (r) => r.model],
  ['input_tokens', (r) => r.input],
  ['output_tokens', (r) => r.output],
  ['cache_write_tokens', (r) => r.cacheWrite],
  ['cache_read_tokens', (r) => r.cacheRead],
  ['requests', (r) => r.requests],
  ['total_tokens', (r) => r.tokens],
  ['estimated_cost_usd', (r) => (r.costUsd === null ? '' : r.costUsd.toFixed(6))],
];

function csvField(value: string | number): string {
  if (typeof value === 'number') return String(value);
  // A leading = + - @ would run as a formula when the file opens in a
  // spreadsheet; account and project names come from the file system.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.map(([header]) => header).join(',')];
  for (const row of rows) lines.push(EXPORT_COLUMNS.map(([, value]) => csvField(value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
