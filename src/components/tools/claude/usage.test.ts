import { describe, expect, it } from 'vitest';
import {
  MAX_DAILY_BARS, NO_BUDGETS, budgetStates, chartSeries, dueBudgetAlerts, exportRows, monthStartHour, toCsv,
  DEFAULT_PROFILE, MS_PER_HOUR, estimateCost, formatCost, formatTokens, labelFromDir, lastFiveHoursStart,
  launchCommand, localDayKey, projectName, rangeStartHour, resumeCommand, sessionModels, sessionStatus,
  sessionTotals, shortModel, totalUsage, uniqueLabel, usageByDay, usageByModel, usageByProfile, usageByProject,
  type SessionInfo, type SessionRow, type UsageBucket,
} from './usage';

const bucket = (over: Partial<UsageBucket> = {}): UsageBucket => ({
  hour: 0, model: 'claude-opus-5-5', input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0,
  requests: 1, ...over,
});

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 's1', profileId: 'default', project: '-work-app', cwd: '/work/app', gitBranch: 'main', title: 'T',
  version: '2.1.0', startedAt: 0, lastActivityAt: 0, prompts: 1, subagents: 0, lastRole: 'assistant',
  lastStopReason: 'end_turn', live: null, buckets: [], ...over,
});

const live = (status: string | null) => ({ pid: 1, status, kind: null, name: null, entrypoint: null, updatedAt: null });

describe('sessionStatus', () => {
  const now = 10 * 60_000;

  it('follows what the running process reports', () => {
    expect(sessionStatus(session({ live: live('busy') }), now)).toBe('working');
    expect(sessionStatus(session({ live: live('idle') }), now)).toBe('idle');
    expect(sessionStatus(session({ live: live('waiting_for_permission') }), now)).toBe('waiting');
    expect(sessionStatus(session({ live: live(null) }), now)).toBe('idle');
  });

  it('without a process, only a freshly written transcript counts as running', () => {
    expect(sessionStatus(session({ lastActivityAt: now - 30_000 }), now)).toBe('working');
    expect(sessionStatus(session({ lastActivityAt: now - 5 * 60_000 }), now)).toBe('ended');
    expect(sessionStatus(session({ lastActivityAt: null }), now)).toBe('ended');
  });
});

describe('estimateCost', () => {
  const million = { input: 1e6, output: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6, cacheRead: 1e6 };

  it('prices each token class, with the listed cache-read rate when there is one', () => {
    // 4 + 20 + 4×1.25 + 4×2 + 0.20
    expect(estimateCost('claude-opus-5-5', million)).toBeCloseTo(37.2, 6);
    // No listed cache-read rate → 0.1 × input: 5 + 25 + 6.25 + 10 + 0.5
    expect(estimateCost('claude-opus-4-8', million)).toBeCloseTo(46.75, 6);
  });

  it('matches the longest prefix, dated ids and provider-prefixed ids', () => {
    const input = { input: 1e6, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
    expect(estimateCost('claude-sonnet-5-5', input)).toBe(2);
    expect(estimateCost('claude-opus-4-5-20251101', input)).toBe(5);
    expect(estimateCost('claude-opus-4-20250514', input)).toBe(15);
    expect(estimateCost('us.anthropic.claude-haiku-4-5', input)).toBe(1);
  });

  it('returns null for a model it has no price for', () => {
    expect(estimateCost('gpt-4o', million)).toBeNull();
  });
});

describe('aggregation', () => {
  const day = (iso: string) => Math.floor(new Date(iso).getTime() / MS_PER_HOUR);
  const d1 = day('2026-11-01T10:00:00');
  const d2 = day('2026-11-02T10:00:00');
  const sessions = [
    session({
      id: 'a', profileId: 'p1', cwd: '/work/app',
      buckets: [
        bucket({ hour: d1, input: 100, output: 10 }),
        bucket({ hour: d2, input: 200, output: 20, cacheRead: 1000, requests: 2 }),
      ],
    }),
    session({
      id: 'b', profileId: 'p2', cwd: '/work/site/',
      buckets: [bucket({ hour: d2, model: 'mystery-model', input: 5, output: 5 })],
    }),
  ];

  it('totals tokens and keeps unpriced requests out of the cost', () => {
    const all = totalUsage(sessions, 0);
    expect(all.tokens).toBe(100 + 10 + 200 + 20 + 1000 + 10);
    expect(all.requests).toBe(4);
    expect(all.unpriced).toBe(1);
    expect(all.cost).toBeCloseTo((300 * 4 + 30 * 20 + 1000 * 0.2) / 1e6, 10);
  });

  it('respects the range start', () => {
    expect(totalUsage(sessions, d2).requests).toBe(3);
    expect(sessionTotals(sessions[0], d2).input).toBe(200);
    expect(totalUsage(sessions, d2 + 1).tokens).toBe(0);
  });

  it('groups by local day (newest first), model, project and profile', () => {
    expect(usageByDay(sessions, 0).map((g) => g.key)).toEqual(['2026-11-02', '2026-11-01']);
    expect(usageByModel(sessions, 0).map((g) => g.key)).toEqual(['claude-opus-5-5', 'mystery-model']);
    expect(usageByProject(sessions, 0).map((g) => g.key)).toEqual(['app', 'site']);
    const byProfile = usageByProfile(sessions, 0);
    expect(byProfile.get('p1')?.requests).toBe(3);
    expect(byProfile.get('p2')?.requests).toBe(1);
  });

  it('range starts are local midnights', () => {
    const now = new Date('2026-11-13T15:30:00').getTime();
    expect(localDayKey(rangeStartHour('today', now))).toBe('2026-11-13');
    expect(localDayKey(rangeStartHour('7d', now))).toBe('2026-11-07');
    expect(localDayKey(rangeStartHour('30d', now))).toBe('2026-10-15');
    expect(rangeStartHour('all', now)).toBe(0);
    expect(lastFiveHoursStart(now)).toBe(Math.floor(now / MS_PER_HOUR) - 4);
  });
});

describe('display helpers', () => {
  it('formats tokens and cost compactly', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(250_000)).toBe('250K');
    expect(formatTokens(1_735_828)).toBe('1.74M');
    expect(formatTokens(2_500_000_000)).toBe('2.50B');
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(1234.5)).toBe('$1235');
  });

  it('shortens model ids and ranks a session\'s models by weight', () => {
    expect(shortModel('claude-opus-4-5-20251101')).toBe('opus-4-5');
    expect(shortModel('us.anthropic.claude-haiku-4-5')).toBe('haiku-4-5');
    const s: SessionInfo = session({
      buckets: [bucket({ model: 'claude-haiku-5-5', input: 5 }), bucket({ model: 'claude-opus-5-5', input: 500 })],
    });
    expect(sessionModels(s)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
  });

  it('names a project from its working directory', () => {
    expect(projectName(session({ cwd: 'C:\\Users\\me\\code\\app\\' }))).toBe('app');
    expect(projectName(session({ cwd: null }))).toBe('-work-app');
  });

  it('builds shell commands that select the account', () => {
    const work = { id: 'w', label: 'Work', configDir: '~/.claude-work' };
    expect(launchCommand(DEFAULT_PROFILE)).toBe('claude');
    expect(launchCommand(work)).toBe('CLAUDE_CONFIG_DIR=~/.claude-work claude');
    expect(resumeCommand(session({ id: 'abc', cwd: '/work/my app' }), work))
      .toBe("cd '/work/my app' && CLAUDE_CONFIG_DIR=~/.claude-work claude --resume abc");
    expect(resumeCommand(session({ id: 'abc', cwd: null }), DEFAULT_PROFILE)).toBe('claude --resume abc');
  });

  it('labels a detected directory', () => {
    expect(labelFromDir('~/.claude-work')).toBe('work');
    expect(labelFromDir('~/.claude')).toBe('Default');
    expect(labelFromDir('/opt/accounts/client-a/')).toBe('client-a');
    expect(uniqueLabel('~/.ccs/instances/work', ['Default'])).toBe('work');
    expect(uniqueLabel('~/other/work', ['Default', 'work'])).toBe('~/other/work');
  });
});

describe('chartSeries', () => {
  const hourOf = (iso: string) => Math.floor(new Date(iso).getTime() / MS_PER_HOUR);
  const now = new Date('2026-11-13T15:00:00').getTime();
  const used = (iso: string, input: number) => bucket({ hour: hourOf(iso), input });

  it('keeps empty days between the range start and today', () => {
    const rows = [session({ buckets: [used('2026-11-10T09:00:00', 10), used('2026-11-12T09:00:00', 30)] })];
    const series = chartSeries(rows, rangeStartHour('7d', now), now);
    expect(series.granularity).toBe('day');
    expect(series.bars.map((b) => b.key)).toEqual([
      '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
    ]);
    expect(series.bars.map((b) => b.totals.input)).toEqual([0, 0, 0, 10, 0, 30, 0]);
  });

  it('for all time starts at the first day used, and folds long spans into weeks', () => {
    const short = chartSeries([session({ buckets: [used('2026-11-11T09:00:00', 5)] })], 0, now);
    expect(short.bars.map((b) => b.key)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);

    const long = chartSeries(
      [session({ buckets: [used('2026-08-01T09:00:00', 7), used('2026-11-13T09:00:00', 3)] })], 0, now);
    expect(long.granularity).toBe('week');
    expect(long.bars.length).toBeLessThanOrEqual(MAX_DAILY_BARS);
    expect(long.bars[long.bars.length - 1].key).toBe('2026-11-07');
    expect(long.bars[long.bars.length - 1].totals.input).toBe(3);
    expect(long.bars.reduce((sum, b) => sum + b.totals.input, 0)).toBe(10);
  });

  it('is empty when there is no usage', () => {
    expect(chartSeries([session({})], 0, now).bars).toEqual([]);
  });
});

describe('budgets', () => {
  const now = new Date('2026-11-13T15:00:00').getTime();
  const hourOf = (iso: string) => Math.floor(new Date(iso).getTime() / MS_PER_HOUR);
  // opus-5-5 output is $20 / MTok.
  const spend = (iso: string, usd: number) => bucket({ hour: hourOf(iso), output: (usd / 20) * 1e6 });
  const rows = [session({ buckets: [spend('2026-11-13T10:00:00', 9), spend('2026-11-02T10:00:00', 30), spend('2026-10-30T10:00:00', 500)] })];

  it('measures each switched-on budget over its own period', () => {
    expect(budgetStates(rows, NO_BUDGETS, now)).toEqual([]);
    const [daily, monthly] = budgetStates(rows, { dailyUsd: 10, monthlyUsd: 30 }, now);
    expect(daily).toMatchObject({ period: 'daily', periodKey: '2026-11-13', level: 'warn' });
    expect(daily.spent).toBeCloseTo(9, 6);
    expect(monthly).toMatchObject({ period: 'monthly', periodKey: '2026-11', level: 'over' });
    expect(monthly.spent).toBeCloseTo(39, 6);
    expect(localDayKey(monthStartHour(now))).toBe('2026-11-01');
  });

  it('announces each crossing once per period', () => {
    const states = budgetStates(rows, { dailyUsd: 10, monthlyUsd: 30 }, now);
    const first = dueBudgetAlerts(states, {});
    expect(first.due.map((s) => s.period)).toEqual(['daily', 'monthly']);
    expect(first.log).toEqual({ daily: '2026-11-13:warn', monthly: '2026-11:over' });
    expect(dueBudgetAlerts(states, first.log).due).toEqual([]);

    // Warn → over is a new crossing; a new day starts over.
    const over = states.map((s) => ({ ...s, level: 'over' as const }));
    expect(dueBudgetAlerts(over, first.log).due.map((s) => s.period)).toEqual(['daily']);
    expect(dueBudgetAlerts(states, { daily: '2026-11-12:over', monthly: '2026-11:over' }).due.map((s) => s.period))
      .toEqual(['daily']);
    expect(dueBudgetAlerts(states, { daily: '2026-11-13:over' }).due.map((s) => s.period)).toEqual(['monthly']);
  });
});

describe('export', () => {
  const hourOf = (iso: string) => Math.floor(new Date(iso).getTime() / MS_PER_HOUR);
  const profiles = [{ id: 'p1', label: 'Work, Inc.', configDir: '~/.claude' }];
  const rows = [
    session({
      profileId: 'p1', cwd: '/work/=cmd',
      buckets: [
        bucket({ hour: hourOf('2026-11-02T09:00:00'), input: 100, output: 10 }),
        bucket({ hour: hourOf('2026-11-02T17:00:00'), input: 50, cacheWrite1h: 5, cacheRead: 5, requests: 2 }),
        bucket({ hour: hourOf('2026-11-01T09:00:00'), model: 'mystery-model', input: 1 }),
      ],
    }),
  ];

  it('merges buckets into one row per day, account, project and model', () => {
    const out = exportRows(rows, profiles, 0);
    expect(out.map((r) => [r.date, r.model])).toEqual([['2026-11-01', 'mystery-model'], ['2026-11-02', 'claude-opus-5-5']]);
    expect(out[1]).toMatchObject({ account: 'Work, Inc.', project: '=cmd', input: 150, output: 10, cacheWrite: 5, cacheRead: 5, requests: 3, tokens: 170 });
    expect(out[0].costUsd).toBeNull();
    expect(exportRows(rows, profiles, hourOf('2026-11-02T00:00:00'))).toHaveLength(1);
  });

  it('writes CSV that quotes commas and defuses spreadsheet formulas', () => {
    const lines = toCsv(exportRows(rows, profiles, 0)).split('\r\n');
    expect(lines[0]).toBe('date,account,project,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,requests,total_tokens,estimated_cost_usd');
    expect(lines[1]).toBe(`2026-11-01,"Work, Inc.",'=cmd,mystery-model,1,0,0,0,1,1,`);
    expect(lines[2].startsWith(`2026-11-02,"Work, Inc.",'=cmd,claude-opus-5-5,150,10,5,5,3,170,0.000`)).toBe(true);
    expect(lines[3]).toBe('');
  });
});
