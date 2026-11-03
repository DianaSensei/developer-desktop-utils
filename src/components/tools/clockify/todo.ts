// To-do side of the Time Tracker: task status/priority/due date helpers and
// the reminder schedule. Pure functions only, shared by the Tasks tab
// (TaskList.tsx) and the app-wide reminder runtime (reminders.tsx).

import type { Task } from './store';
import { dayStart } from './time';

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';

export const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
export const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low', 'none'];
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Tasks saved before the Tasks tab only have `completed`. */
export function statusOf(t: Pick<Task, 'status' | 'completed'>): TaskStatus {
  return t.status ?? (t.completed ? 'done' : 'todo');
}

export function priorityOf(t: Pick<Task, 'priority'>): TaskPriority {
  return t.priority ?? 'none';
}

/** Patch that moves a task to `status`, keeping the legacy `completed` flag
 *  (still read by the project/task picker) in step. */
export function statusPatch(status: TaskStatus, now: number): Partial<Task> {
  return { status, completed: status === 'done', completedAt: status === 'done' ? now : null };
}

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

/** Where a due date falls relative to `now`. A date-only due (no time) is
 *  overdue from the next day on; a timed one from that minute. */
export function dueBucket(t: Pick<Task, 'dueAt' | 'dueHasTime'>, now: number): DueBucket {
  if (t.dueAt == null) return 'none';
  const today = dayStart(now);
  const day = dayStart(t.dueAt);
  if (t.dueHasTime ? t.dueAt < now : day < today) return 'overdue';
  if (day === today) return 'today';
  if (day === dayStart(today + DAY + DAY / 2)) return 'tomorrow';
  if (day < today + 7 * DAY + DAY / 2) return 'week';
  return 'later';
}

/** Open tasks first by due date (overdue → none), then priority, then age;
 *  done tasks newest-completed first. */
export function compareTasks(a: Task, b: Task): number {
  const da = statusOf(a) === 'done';
  const db = statusOf(b) === 'done';
  if (da !== db) return da ? 1 : -1;
  if (da) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
  const ad = a.dueAt ?? Number.POSITIVE_INFINITY;
  const bd = b.dueAt ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad < bd ? -1 : 1;
  const pr = PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
  if (pr !== 0) return pr;
  return a.createdAt - b.createdAt;
}

/** Reminder offsets offered in the editor, minutes before the due time. */
export const REMIND_OFFSETS = [0, 10, 30, 60, 24 * 60] as const;

/** The moment a "N minutes before due" reminder fires. Date-only dues count
 *  from 09:00 that day, so "1 day before" a Friday task rings Thursday 09:00. */
export function remindAtFor(t: Pick<Task, 'dueAt' | 'dueHasTime'>, offsetMin: number): number | null {
  if (t.dueAt == null) return null;
  const base = t.dueHasTime ? t.dueAt : dayStart(t.dueAt) + 9 * 60 * MIN;
  return base - offsetMin * MIN;
}

// ---------------------------------------------------------------------------
// Reminder schedule
// ---------------------------------------------------------------------------

export interface MeetingLike {
  id: string;
  title: string;
  start: number;
  end: number;
}

export interface ReminderState {
  /** Reminder key → when it was shown or dismissed. */
  fired: Record<string, number>;
  /** Reminder key → snoozed until. */
  snoozed: Record<string, number>;
}

export const EMPTY_REMINDER_STATE: ReminderState = { fired: {}, snoozed: {} };

export interface DueReminder {
  /** Includes the scheduled time, so moving a reminder makes it ring again. */
  key: string;
  kind: 'task' | 'meeting';
  id: string;
  title: string;
  /** When it was scheduled for (task reminder time / meeting start). */
  at: number;
}

/** A reminder missed while the app was closed still shows within this window. */
export const CATCH_UP_MS = 12 * 60 * MIN;
/** Meeting reminders keep showing until this long after the meeting starts. */
const MEETING_GRACE_MS = 5 * MIN;

export function taskReminderKey(t: Pick<Task, 'id'>, at: number): string {
  return `task:${t.id}:${at}`;
}

export function meetingReminderKey(m: Pick<MeetingLike, 'id' | 'start'>): string {
  return `meeting:${m.id}:${m.start}`;
}

/** Reminders that should be on screen at `now`. */
export function dueReminders(opts: {
  tasks: Task[];
  meetings: MeetingLike[];
  now: number;
  meetingLeadMinutes: number;
  state: ReminderState;
}): DueReminder[] {
  const { tasks, meetings, now, meetingLeadMinutes, state } = opts;
  const pending = (key: string) => !(key in state.fired) && !((state.snoozed[key] ?? 0) > now);
  const out: DueReminder[] = [];
  for (const t of tasks) {
    const at = t.remindAt;
    if (at == null || statusOf(t) === 'done' || at > now || now - at > CATCH_UP_MS) continue;
    const key = taskReminderKey(t, at);
    if (pending(key)) out.push({ key, kind: 'task', id: t.id, title: t.name, at });
  }
  if (meetingLeadMinutes > 0) {
    for (const m of meetings) {
      if (m.start - meetingLeadMinutes * MIN > now || now > m.start + MEETING_GRACE_MS) continue;
      const key = meetingReminderKey(m);
      if (pending(key)) out.push({ key, kind: 'meeting', id: m.id, title: m.title, at: m.start });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The next moment something could become due, to schedule a precise wake-up
 *  instead of only polling. Null when nothing is scheduled. */
export function nextReminderAt(opts: {
  tasks: Task[];
  meetings: MeetingLike[];
  now: number;
  meetingLeadMinutes: number;
  state: ReminderState;
}): number | null {
  const { tasks, meetings, now, meetingLeadMinutes, state } = opts;
  let next = Number.POSITIVE_INFINITY;
  for (const t of tasks) {
    if (t.remindAt != null && t.remindAt > now && statusOf(t) !== 'done') next = Math.min(next, t.remindAt);
  }
  if (meetingLeadMinutes > 0) {
    for (const m of meetings) {
      const at = m.start - meetingLeadMinutes * MIN;
      if (at > now) next = Math.min(next, at);
    }
  }
  for (const until of Object.values(state.snoozed)) if (until > now) next = Math.min(next, until);
  return Number.isFinite(next) ? next : null;
}

/** Drops bookkeeping for reminders too old to matter again. */
export function pruneReminderState(state: ReminderState, now: number): ReminderState {
  const keep = (rec: Record<string, number>, minTs: number) =>
    Object.fromEntries(Object.entries(rec).filter(([, ts]) => ts >= minTs));
  return { fired: keep(state.fired, now - 30 * DAY), snoozed: keep(state.snoozed, now) };
}

/** Parses the persisted state, tolerating anything malformed. */
export function readReminderState(raw: string | null): ReminderState {
  if (!raw) return EMPTY_REMINDER_STATE;
  try {
    const v = JSON.parse(raw) as Partial<ReminderState>;
    return {
      fired: v.fired && typeof v.fired === 'object' ? v.fired : {},
      snoozed: v.snoozed && typeof v.snoozed === 'object' ? v.snoozed : {},
    };
  } catch {
    return EMPTY_REMINDER_STATE;
  }
}
