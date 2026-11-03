import { describe, expect, it } from 'vitest';
import type { Task } from './store';
import {
  CATCH_UP_MS, EMPTY_REMINDER_STATE, compareTasks, dueBucket, dueReminders, meetingReminderKey, nextReminderAt,
  pruneReminderState, readReminderState, remindAtFor, statusOf, statusPatch, taskReminderKey,
} from './todo';

const MIN = 60_000;
// Wed 2026-11-04 10:00 local.
const NOW = new Date(2026, 10, 4, 10, 0).getTime();
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();

function task(patch: Partial<Task> = {}): Task {
  return { id: 't1', name: 'Write report', projectId: null, parentId: null, linkedIds: [], completed: false, createdAt: 1, ...patch };
}

describe('statusOf / statusPatch', () => {
  it('derives status from the legacy completed flag', () => {
    expect(statusOf(task())).toBe('todo');
    expect(statusOf(task({ completed: true }))).toBe('done');
    expect(statusOf(task({ completed: true, status: 'doing' }))).toBe('doing');
  });

  it('keeps completed in step with status', () => {
    expect(statusPatch('done', NOW)).toEqual({ status: 'done', completed: true, completedAt: NOW });
    expect(statusPatch('doing', NOW)).toEqual({ status: 'doing', completed: false, completedAt: null });
  });
});

describe('dueBucket', () => {
  it('date-only dues are overdue from the next day; timed ones from that minute', () => {
    expect(dueBucket(task(), NOW)).toBe('none');
    expect(dueBucket(task({ dueAt: at(4) }), NOW)).toBe('today');
    expect(dueBucket(task({ dueAt: at(3) }), NOW)).toBe('overdue');
    expect(dueBucket(task({ dueAt: at(4, 9), dueHasTime: true }), NOW)).toBe('overdue');
    expect(dueBucket(task({ dueAt: at(4, 11), dueHasTime: true }), NOW)).toBe('today');
    expect(dueBucket(task({ dueAt: at(5) }), NOW)).toBe('tomorrow');
    expect(dueBucket(task({ dueAt: at(10) }), NOW)).toBe('week');
    expect(dueBucket(task({ dueAt: at(20) }), NOW)).toBe('later');
  });
});

describe('compareTasks', () => {
  it('orders open by due, then priority, then age; done last, newest first', () => {
    const list = [
      task({ id: 'done-old', status: 'done', completedAt: 1 }),
      task({ id: 'nodue-high', priority: 'high', createdAt: 5 }),
      task({ id: 'due-later', dueAt: at(9) }),
      task({ id: 'done-new', status: 'done', completedAt: 2 }),
      task({ id: 'due-soon', dueAt: at(5) }),
      task({ id: 'nodue-none', createdAt: 2 }),
      task({ id: 'nodue-low-old', priority: 'low', createdAt: 1 }),
    ];
    expect(list.sort(compareTasks).map((t) => t.id)).toEqual([
      'due-soon', 'due-later', 'nodue-high', 'nodue-low-old', 'nodue-none', 'done-new', 'done-old',
    ]);
  });
});

describe('remindAtFor', () => {
  it('counts from the due time, or 09:00 for a date-only due', () => {
    expect(remindAtFor(task(), 10)).toBeNull();
    expect(remindAtFor(task({ dueAt: at(5, 14), dueHasTime: true }), 30)).toBe(at(5, 13, 30));
    expect(remindAtFor(task({ dueAt: at(5) }), 0)).toBe(at(5, 9));
    expect(remindAtFor(task({ dueAt: at(5) }), 24 * 60)).toBe(at(4, 9));
  });
});

describe('dueReminders', () => {
  const base = { meetings: [], now: NOW, meetingLeadMinutes: 10, state: EMPTY_REMINDER_STATE };

  it('returns task reminders that are due, not done, not handled and not stale', () => {
    const due = task({ id: 'a', remindAt: NOW - MIN });
    const tasks = [
      due,
      task({ id: 'future', remindAt: NOW + MIN }),
      task({ id: 'done', remindAt: NOW - MIN, status: 'done' }),
      task({ id: 'stale', remindAt: NOW - CATCH_UP_MS - MIN }),
      task({ id: 'none' }),
    ];
    expect(dueReminders({ ...base, tasks }).map((r) => r.id)).toEqual(['a']);

    const key = taskReminderKey(due, due.remindAt!);
    expect(dueReminders({ ...base, tasks, state: { fired: { [key]: NOW }, snoozed: {} } })).toEqual([]);
    expect(dueReminders({ ...base, tasks, state: { fired: {}, snoozed: { [key]: NOW + MIN } } })).toEqual([]);
    expect(dueReminders({ ...base, tasks, state: { fired: {}, snoozed: { [key]: NOW - 1 } } })).toHaveLength(1);
  });

  it('a moved reminder rings again', () => {
    const t = task({ remindAt: NOW - 2 * MIN });
    const state = { fired: { [taskReminderKey(t, NOW - 2 * MIN)]: NOW }, snoozed: {} };
    expect(dueReminders({ ...base, tasks: [{ ...t, remindAt: NOW - MIN }], state })).toHaveLength(1);
  });

  it('meetings ring from the lead time until shortly after they start', () => {
    const m = (start: number) => ({ id: 'm', title: 'Standup', start, end: start + 15 * MIN });
    const run = (start: number, lead = 10) =>
      dueReminders({ ...base, tasks: [], meetings: [m(start)], meetingLeadMinutes: lead });
    expect(run(NOW + 11 * MIN)).toEqual([]);
    expect(run(NOW + 9 * MIN)).toEqual([{ key: meetingReminderKey(m(NOW + 9 * MIN)), kind: 'meeting', id: 'm', title: 'Standup', at: NOW + 9 * MIN }]);
    expect(run(NOW - 4 * MIN)).toHaveLength(1);
    expect(run(NOW - 6 * MIN)).toEqual([]);
    expect(run(NOW + 5 * MIN, 0)).toEqual([]);
  });
});

describe('nextReminderAt', () => {
  it('finds the soonest future reminder, meeting lead or snooze end', () => {
    const tasks = [task({ remindAt: NOW + 30 * MIN }), task({ id: 'x', remindAt: NOW + 5 * MIN, status: 'done' })];
    const meetings = [{ id: 'm', title: '', start: NOW + 25 * MIN, end: NOW + 40 * MIN }];
    const base = { tasks, meetings, now: NOW, meetingLeadMinutes: 10, state: EMPTY_REMINDER_STATE };
    expect(nextReminderAt(base)).toBe(NOW + 15 * MIN);
    expect(nextReminderAt({ ...base, state: { fired: {}, snoozed: { k: NOW + 2 * MIN } } })).toBe(NOW + 2 * MIN);
    expect(nextReminderAt({ ...base, tasks: [], meetings: [] })).toBeNull();
  });
});

describe('reminder state', () => {
  it('prunes old bookkeeping and parses defensively', () => {
    const state = { fired: { old: NOW - 31 * 24 * 60 * MIN, recent: NOW - MIN }, snoozed: { past: NOW - 1, future: NOW + 1 } };
    expect(pruneReminderState(state, NOW)).toEqual({ fired: { recent: NOW - MIN }, snoozed: { future: NOW + 1 } });
    expect(readReminderState(null)).toEqual(EMPTY_REMINDER_STATE);
    expect(readReminderState('{bad')).toEqual(EMPTY_REMINDER_STATE);
    expect(readReminderState('{"fired":{"a":1}}')).toEqual({ fired: { a: 1 }, snoozed: {} });
  });
});
