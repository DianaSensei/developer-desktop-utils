import { describe, expect, it } from 'vitest';
import type { Task, TimeEntry } from './store';
import {
  autoLogCandidates, parseIssueRef, pendingAcrossTasks,
  jiraDateTime, jiraMessage, mergeIssues, normalizeSite, parseIssue, pendingStatusPushes, pendingWorklogs,
  pickTransition, priorityFromJira, worklogSeconds, type JiraIssue, type JiraLink,
} from './jira';

const SITE = 'https://acme.atlassian.net';
const NOW = new Date(2026, 10, 4, 10, 0).getTime();

function issue(patch: Partial<JiraIssue> = {}): JiraIssue {
  return { key: 'PAY-1', summary: 'Fix refund rounding', statusName: 'To Do', statusCategory: 'new', updated: 1, ...patch };
}
function link(patch: Partial<JiraLink> = {}): JiraLink {
  return { key: 'PAY-1', site: SITE, statusName: 'To Do', statusCategory: 'new', updated: 1, due: null, ...patch };
}
function task(patch: Partial<Task> = {}): Task {
  return { id: 't1', name: 'x', projectId: null, parentId: null, linkedIds: [], completed: false, createdAt: 1, ...patch };
}

describe('normalizeSite', () => {
  it('accepts a bare name, a host or any URL on a Jira Cloud site', () => {
    expect(normalizeSite('acme')).toBe(SITE);
    expect(normalizeSite('acme.atlassian.net')).toBe(SITE);
    expect(normalizeSite(' https://ACME.atlassian.net/jira/software/projects/PAY/boards/1 ')).toBe(SITE);
  });
  it('refuses anything that is not *.atlassian.net', () => {
    expect(normalizeSite('')).toBeNull();
    expect(normalizeSite('jira.acme.com')).toBeNull();
    expect(normalizeSite('https://atlassian.net.evil.com')).toBeNull();
  });
});

describe('parseIssue / priority / messages', () => {
  it('reads the fields the sync needs', () => {
    expect(parseIssue({
      key: 'PAY-7',
      fields: {
        summary: ' Refunds ', status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
        priority: { name: 'High' }, duedate: '2026-11-07', issuetype: { name: 'Bug' }, updated: '2026-11-03T10:00:00.000+0000',
      },
    })).toEqual({
      key: 'PAY-7', summary: 'Refunds', statusName: 'In Review', statusCategory: 'indeterminate',
      priority: 'High', dueDate: '2026-11-07', issueType: 'Bug', updated: Date.parse('2026-11-03T10:00:00.000Z'),
    });
    expect(parseIssue({ key: 'PAY-8' })).toMatchObject({ summary: 'PAY-8', statusCategory: 'new', dueDate: null });
  });

  it('maps Jira priorities onto ours', () => {
    expect(['Highest', 'High', 'Medium', 'Low', 'Lowest', undefined].map(priorityFromJira))
      .toEqual(['high', 'high', 'medium', 'low', 'low', 'none']);
  });

  it("flattens Jira's error body", () => {
    expect(jiraMessage('{"errorMessages":["Field does not exist"],"errors":{"jql":"bad"}}')).toBe('Field does not exist bad');
    expect(jiraMessage('<html>')).toBe('');
  });

  it('formats worklog start times with the local offset', () => {
    expect(jiraDateTime(NOW)).toMatch(/^2026-11-04T10:00:00\.000[+-]\d{4}$/);
  });
});

describe('mergeIssues', () => {
  it('adds open issues as tasks and skips done or hidden ones', () => {
    const r = mergeIssues([], [
      issue({ key: 'PAY-1', priority: 'High', dueDate: '2026-11-07' }),
      issue({ key: 'PAY-2', statusCategory: 'done' }),
      issue({ key: 'PAY-3' }),
      issue({ key: 'PAY-4', statusCategory: 'indeterminate', statusName: 'In Progress' }),
    ], SITE, NOW, { hiddenKeys: ['PAY-3'] });
    expect(r.added).toBe(2);
    expect(r.tasks.map((t) => [t.jira?.key, t.status, t.priority])).toEqual([['PAY-1', 'todo', 'high'], ['PAY-4', 'doing', 'none']]);
    expect(r.tasks[0].dueAt).toBe(new Date(2026, 10, 7).getTime());
  });

  it('updates linked tasks from Jira but keeps local notes, reminder, project and a local due date', () => {
    const local = task({
      name: 'old', notes: 'mine', remindAt: 5, projectId: 'p', status: 'todo',
      dueAt: new Date(2026, 10, 20).getTime(), jira: link({ due: null }),
    });
    const r = mergeIssues([local], [issue({ summary: 'new title', statusCategory: 'done', statusName: 'Done', dueDate: '2026-11-07' })], SITE, NOW);
    expect(r.updated).toBe(1);
    expect(r.tasks[0]).toMatchObject({
      name: 'new title', status: 'done', completed: true, notes: 'mine', remindAt: 5, projectId: 'p',
      dueAt: new Date(2026, 10, 20).getTime(), jira: { statusName: 'Done', statusCategory: 'done', due: '2026-11-07' },
    });
  });

  it('follows a Jira due date change when the local due came from Jira', () => {
    const local = task({ dueAt: new Date(2026, 10, 7).getTime(), jira: link({ due: '2026-11-07' }) });
    const r = mergeIssues([local], [issue({ dueDate: '2026-11-09' })], SITE, NOW);
    expect(r.tasks[0].dueAt).toBe(new Date(2026, 10, 9).getTime());
  });

  it('does not overwrite a status change still waiting to be pushed', () => {
    const local = task({ status: 'done', completed: true, jira: link() });
    const r = mergeIssues([local], [issue({ summary: 'renamed' })], SITE, NOW, { keepStatusFor: new Set(['PAY-1']) });
    expect(r.tasks[0]).toMatchObject({ status: 'done', name: 'renamed', jira: { statusCategory: 'new' } });
  });

  it('keeps tasks of another site separate even with the same key', () => {
    const other = task({ jira: link({ site: 'https://other.atlassian.net' }) });
    const r = mergeIssues([other], [issue()], SITE, NOW);
    expect(r.tasks).toHaveLength(2);
  });
});

describe('status pushes', () => {
  it('lists linked tasks whose status differs from Jira, except ones already refused', () => {
    const tasks = [
      task({ id: 'a', status: 'done', jira: link({ key: 'A' }) }),
      task({ id: 'b', status: 'todo', jira: link({ key: 'B' }) }),
      task({ id: 'c', status: 'doing', jira: link({ key: 'C', pushError: { category: 'indeterminate', message: 'x' } }) }),
      task({ id: 'd', status: 'done' }),
    ];
    expect(pendingStatusPushes(tasks, SITE).map((p) => [p.task.id, p.category])).toEqual([['a', 'done']]);
  });

  it('picks the transition into the wanted category, preferring the usual name', () => {
    const t = (id: string, name: string, category: 'new' | 'indeterminate' | 'done') => ({ id, name, to: { name, category } });
    const list = [t('1', 'Start', 'indeterminate'), t('2', 'Won’t do', 'done'), t('3', 'Done', 'done')];
    expect(pickTransition(list, 'done')?.id).toBe('3');
    expect(pickTransition(list, 'indeterminate')?.id).toBe('1');
    expect(pickTransition(list, 'new')).toBeNull();
  });
});

describe('worklogs', () => {
  const e = (patch: Partial<TimeEntry>): TimeEntry => ({
    id: 'e', description: '', projectId: null, taskId: 't1', tagIds: [], start: 0, end: 30 * 60_000, source: 'tracker', ...patch,
  });
  it('sends finished, unsent entries of at least a minute, rounded to minutes', () => {
    const list = [e({ id: '1' }), e({ id: '2', end: null }), e({ id: '3', jiraWorklogId: 'w' }), e({ id: '4', end: 30_000 }), e({ id: '5', taskId: 'x' })];
    expect(pendingWorklogs(list, 't1').map((x) => x.id)).toEqual(['1']);
    expect(worklogSeconds({ start: 0, end: 90_000 })).toBe(120);
    expect(worklogSeconds({ start: 0, end: 61_000 })).toBe(60);
  });
});

describe('parseIssueRef', () => {
  it('takes a key or an issue URL on the connected site', () => {
    expect(parseIssueRef('PAY-42', SITE)).toBe('PAY-42');
    expect(parseIssueRef(' https://acme.atlassian.net/browse/PAY-42 ', SITE)).toBe('PAY-42');
    expect(parseIssueRef('https://acme.atlassian.net/jira/software/projects/PAY/boards/3?selectedIssue=PAY-7', SITE)).toBe('PAY-7');
  });
  it('leaves ordinary task names and other sites alone', () => {
    expect(parseIssueRef('Fix PAY-42 rounding', SITE)).toBeNull();
    expect(parseIssueRef('pay-42', SITE)).toBeNull();
    expect(parseIssueRef('https://other.atlassian.net/browse/PAY-42', SITE)).toBeNull();
    expect(parseIssueRef('https://acme.atlassian.net/jira/your-work', SITE)).toBeNull();
  });
});

describe('mergeIssues forceKeys', () => {
  it('adds an issue asked for by key even when done or hidden', () => {
    const r = mergeIssues([], [issue({ statusCategory: 'done', statusName: 'Done' })], SITE, NOW, {
      hiddenKeys: ['PAY-1'], forceKeys: new Set(['PAY-1']),
    });
    expect(r.tasks[0]).toMatchObject({ status: 'done', completed: true, completedAt: NOW, jira: { key: 'PAY-1' } });
  });
});

describe('auto-log / log all', () => {
  const e = (patch: Partial<TimeEntry>): TimeEntry => ({
    id: 'e', description: '', projectId: null, taskId: 't1', tagIds: [], start: 0, end: 30 * 60_000, source: 'tracker', ...patch,
  });
  const linked = task({ id: 't1', jira: link() });
  const local = task({ id: 't2' });

  it('only picks entries on linked tasks that finished after the switch went on', () => {
    const entries = [
      e({ id: 'old', end: 10 * 60_000 }),
      e({ id: 'new', start: 20 * 60_000, end: 50 * 60_000 }),
      e({ id: 'running', start: 40 * 60_000, end: null }),
      e({ id: 'local', taskId: 't2', start: 20 * 60_000, end: 50 * 60_000 }),
      e({ id: 'sent', start: 20 * 60_000, end: 50 * 60_000, jiraWorklogId: 'w' }),
    ];
    expect(autoLogCandidates(entries, [linked, local], SITE, 15 * 60_000).map((c) => c.entry.id)).toEqual(['new']);
  });

  it('totals unlogged time across linked tasks', () => {
    const entries = [e({ id: 'a' }), e({ id: 'b', start: 0, end: 15 * 60_000 }), e({ id: 'c', taskId: 't2' })];
    expect(pendingAcrossTasks(entries, [linked, local], SITE)).toEqual({ tasks: 1, seconds: 45 * 60 });
  });
});
