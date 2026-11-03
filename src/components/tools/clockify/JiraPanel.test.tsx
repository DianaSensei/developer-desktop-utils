import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { MeetingsProvider } from '@/lib/meetings';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { ClockifySuite } from './Suite';
import type { Task, TimeEntry } from './store';

const TASKS = 'devtool:task-tracker:tasks:items';
const ENTRIES = 'devtool:task-tracker:clockify:entries';
const CONFIG = 'devtool:task-tracker:jira:config';
const SITE = 'https://acme.atlassian.net';

interface Call { method: string; path: string; body?: unknown; auth: string | null }

/** A tiny Jira: one open issue, a To Do → In Progress → Done workflow. */
function fakeJira() {
  const calls: Call[] = [];
  const state = { status: { name: 'To Do', key: 'new' } };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const call: Call = { method: init.method ?? 'GET', path: url.pathname, auth: headers.get('Authorization') };
    if (init.body) call.body = JSON.parse(String(init.body));
    calls.push(call);
    if (call.auth !== `Basic ${btoa('me@acme.io:tok-123')}`) return json(401, { errorMessages: ['Unauthorized'] });
    if (call.path === '/rest/api/3/myself') return json(200, { accountId: 'u1', displayName: 'Mai Tran' });
    if (call.path === '/rest/api/3/search/jql') {
      const jql = (call.body as { jql: string }).jql;
      if (/^key = "/.test(jql) && jql !== 'key = "PAY-42"') return json(200, { isLast: true, issues: [] });
      return json(200, {
        isLast: true,
        issues: [{
          key: 'PAY-42',
          fields: {
            summary: 'Refund rounding', status: { name: state.status.name, statusCategory: { key: state.status.key } },
            priority: { name: 'High' }, duedate: null, issuetype: { name: 'Bug' }, updated: '2026-11-03T10:00:00.000+0000',
          },
        }],
      });
    }
    if (call.path === '/rest/api/3/issue/PAY-42/transitions' && call.method === 'GET') {
      return json(200, { transitions: [
        { id: '21', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
        { id: '31', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
      ] });
    }
    if (call.path === '/rest/api/3/issue/PAY-42/transitions') {
      const id = (call.body as { transition: { id: string } }).transition.id;
      state.status = id === '31' ? { name: 'Done', key: 'done' } : { name: 'In Progress', key: 'indeterminate' };
      return new Response(null, { status: 204 });
    }
    if (call.path === '/rest/api/3/issue/PAY-42/worklog') return json(201, { id: `wl-${calls.length}` });
    return json(404, { errorMessages: ['nope'] });
  });
  return { calls, fetch, state };
}

const saved = () => JSON.parse(storageGet(TASKS) ?? '[]') as Task[];

function renderSuite() {
  render(<LocaleProvider><MeetingsProvider><ClockifySuite /></MeetingsProvider></LocaleProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
}

async function connect(token = 'tok-123') {
  fireEvent.click(screen.getByRole('button', { name: 'Connect Jira' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText('your-company.atlassian.net'), { target: { value: 'acme' } });
  fireEvent.change(within(dialog).getByLabelText('Atlassian account email'), { target: { value: 'me@acme.io' } });
  fireEvent.change(within(dialog).getByLabelText('API token'), { target: { value: token } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Test & save' })); });
}

let jira: ReturnType<typeof fakeJira>;
beforeEach(() => {
  for (const k of [TASKS, ENTRIES, CONFIG, 'devtool:task-tracker:tasks:filter', 'devtool:task-tracker:tasks:view']) storageRemove(k);
  storageSet('devtool:clockify:migrated', '1');
  sessionStorage.clear();
  Element.prototype.scrollIntoView ??= () => {};
  jira = fakeJira();
  vi.stubGlobal('fetch', jira.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Jira in the Tasks tab', () => {
  it('shows a clear error and keeps the dialog open on a bad token', async () => {
    renderSuite();
    await connect('wrong');
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(/rejected the email or token/);
    expect(JSON.parse(storageGet(CONFIG) ?? 'null')).toBeNull();
  });

  it('connects, pulls issues in as tasks and keeps the token out of settings', async () => {
    renderSuite();
    await connect();
    await waitFor(() => expect(screen.getByText('Refund rounding')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open PAY-42 in Jira' })).toBeTruthy();
    expect(saved()[0]).toMatchObject({ status: 'todo', priority: 'high', jira: { key: 'PAY-42', site: SITE, issueType: 'Bug' } });
    const cfg = JSON.parse(storageGet(CONFIG)!);
    expect(cfg).toMatchObject({ site: SITE, email: 'me@acme.io', accountName: 'Mai Tran' });
    expect(JSON.stringify(cfg)).not.toContain('tok-123');
    expect(screen.getByRole('button', { name: 'Sync' })).toBeTruthy();
  });

  it('completing the task here moves the issue to Done in Jira', async () => {
    renderSuite();
    await connect();
    await waitFor(() => screen.getByText('Refund rounding'));
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as done' })); });
    await waitFor(() => expect(jira.state.status.key).toBe('done'));
    expect(jira.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/transitions')).map((c) => c.body))
      .toEqual([{ transition: { id: '31' } }]);
    await waitFor(() => expect(saved()[0].jira).toMatchObject({ statusCategory: 'done', statusName: 'Done', pushError: null }));
  });

  it('logs tracked time on the task as Jira worklogs, once', async () => {
    renderSuite();
    await connect();
    await waitFor(() => screen.getByText('Refund rounding'));
    const taskId = saved()[0].id;
    const start = new Date(2026, 10, 3, 9, 0).getTime();
    const entries: TimeEntry[] = [
      { id: 'e1', description: 'Refund rounding', projectId: null, taskId, tagIds: [], start, end: start + 45 * 60_000, source: 'tracker' },
    ];
    // Entries are written by the tracker; remount so the suite reads them.
    cleanup();
    storageSet(ENTRIES, JSON.stringify(entries));
    renderSuite();
    // The token comes back from the vault asynchronously.
    await waitFor(() => screen.getByRole('button', { name: 'Sync' }));
    fireEvent.click(screen.getByRole('button', { name: /Refund rounding/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('45m not logged in Jira yet')).toBeTruthy();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Log 45m to Jira' })); });
    await waitFor(() => expect(jira.calls.some((c) => c.path.endsWith('/worklog'))).toBe(true));
    await waitFor(() => expect(within(dialog).getByText(/Logged 1 worklogs/)).toBeTruthy());
    const logs = jira.calls.filter((c) => c.path.endsWith('/worklog'));
    expect(logs).toHaveLength(1);
    expect(logs[0].body).toMatchObject({ timeSpentSeconds: 2700 });
    expect((logs[0].body as { started: string }).started).toMatch(/^2026-11-03T09:00:00\.000/);
    expect(within(dialog).getByText('All tracked time is logged in Jira.')).toBeTruthy();
    expect((JSON.parse(storageGet(ENTRIES)!) as TimeEntry[])[0].jiraWorklogId).toMatch(/^wl-/);
  });

  it('a task deleted here does not come back on the next sync', async () => {
    renderSuite();
    await connect();
    await waitFor(() => screen.getByText('Refund rounding'));
    const del = screen.getByRole('button', { name: 'Delete task' });
    fireEvent.click(del);
    fireEvent.click(screen.getByRole('button', { name: /again/i }));
    expect(saved()).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sync' })); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sync' })).toBeTruthy());
    expect(saved()).toEqual([]);
    expect(JSON.parse(storageGet(CONFIG)!).hiddenKeys).toEqual(['PAY-42']);
  });

  it('pasting an issue key links it; an unknown key says so', async () => {
    renderSuite();
    await connect();
    await waitFor(() => screen.getByText('Refund rounding'));
    // Delete it, so adding by key is what brings it back.
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    fireEvent.click(screen.getByRole('button', { name: /again/i }));
    const input = screen.getByLabelText('Add a new task');
    fireEvent.change(input, { target: { value: 'PAY-99' } });
    expect(screen.getByText('↵ adds PAY-99 from Jira')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/PAY-99 wasn't found/));
    expect((input as HTMLInputElement).value).toBe('PAY-99');

    fireEvent.change(input, { target: { value: `${SITE}/browse/PAY-42` } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await waitFor(() => expect(screen.getByText('Added PAY-42.')).toBeTruthy());
    expect(saved().map((t) => t.jira?.key)).toEqual(['PAY-42']);
    expect(JSON.parse(storageGet(CONFIG)!).hiddenKeys).toEqual([]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('with auto-log on, stopping the timer on a Jira task logs the time', async () => {
    renderSuite();
    await connect();
    await waitFor(() => screen.getByText('Refund rounding'));
    fireEvent.click(screen.getByRole('button', { name: 'Jira settings' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /automatically when I stop a timer/ }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Test & save' })); });
    expect(JSON.parse(storageGet(CONFIG)!).autoLogSince).toEqual(expect.any(Number));

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Track time on this task' }));
      vi.setSystemTime(Date.now() + 20 * 60_000);
      fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(jira.calls.filter((c) => c.path.endsWith('/worklog'))).toHaveLength(1));
    expect(jira.calls.find((c) => c.path.endsWith('/worklog'))!.body).toMatchObject({ timeSpentSeconds: 1200 });
    await waitFor(() => expect((JSON.parse(storageGet(ENTRIES)!) as TimeEntry[])[0].jiraWorklogId).toMatch(/^wl-/));
  });

  it('"Log …" in the toolbar sends pending time on every Jira task', async () => {
    renderSuite();
    await connect();
    await waitFor(() => screen.getByText('Refund rounding'));
    const taskId = saved()[0].id;
    const start = new Date(2026, 10, 3, 9, 0).getTime();
    cleanup();
    storageSet(ENTRIES, JSON.stringify([
      { id: 'e1', description: '', projectId: null, taskId, tagIds: [], start, end: start + 30 * 60_000, source: 'tracker' },
      { id: 'e2', description: '', projectId: null, taskId, tagIds: [], start: start + 3600_000, end: start + 5400_000, source: 'tracker' },
    ]));
    renderSuite();
    await waitFor(() => screen.getByRole('button', { name: 'Sync' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log 1h 0m' })); });
    await waitFor(() => expect(screen.getByText('Logged 1h 0m to Jira (2 worklogs).')).toBeTruthy());
    expect(jira.calls.filter((c) => c.path.endsWith('/worklog'))).toHaveLength(2);
  });
});
