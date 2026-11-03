// App-wide reminder runtime for the Time Tracker's tasks and the shared
// meetings. Mounted once in App.tsx so reminders ring whichever tool is open.
// Shows an in-app card (Done / Snooze / Open / Dismiss), plays the Time
// Tracker chime, and — when the window isn't focused — a system notification
// through `sdk.notify`. Everything stays on this machine.
//
// Tasks are read straight from the task-tracker's storage (re-read on every
// change a mounted suite announces, and on a timer otherwise); this runtime
// never writes them while a suite is mounted (see taskBus.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, Check, X } from 'lucide-react';
import { getPlugin, getPluginSdk, type PluginSdk } from '@/platform';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale, useMessages } from '@/contexts/LocaleContext';
import { useMeetings } from '@/lib/meetings';
import { liveConnections } from '@/lib/liveConnections';
import { navBadges } from '@/lib/navBadges';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import MESSAGES from './reminders.messages';
import { DEFAULT_SETTINGS, type Settings, type Task } from './store';
import { playBeep } from './time';
import {
  dueBucket, dueReminders, nextReminderAt, statusOf, pruneReminderState, readReminderState, statusPatch,
  type DueReminder, type ReminderState,
} from './todo';
import { completeTaskInSuite, onTasksChanged, requestOpen } from './taskBus';

const PLUGIN_ID = 'task-tracker';
const STATE_KEY = 'reminders:state';
const TASKS_KEY = 'tasks:items';
const SETTINGS_KEY = 'tasks:settings';
/** Fallback poll; precise wake-ups come from nextReminderAt. */
const POLL_MS = 30_000;
const MIN = 60_000;
const VISIBLE = 3;

function readJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Renders nothing unless the Time Tracker is enabled. */
export function TaskReminders() {
  const { isFeatureEnabled } = useFeatures();
  if (!isFeatureEnabled(PLUGIN_ID) || !getPlugin(PLUGIN_ID)) return null;
  return <ReminderRuntime />;
}

function ReminderRuntime() {
  const sdk = useMemo(() => getPluginSdk(PLUGIN_ID), []);
  const { meetings } = useMeetings();
  const navigate = useNavigate();
  const m = useMessages(MESSAGES);
  const mRef = useRef(m);
  mRef.current = m;
  const [active, setActive] = useState<DueReminder[]>([]);
  const stateRef = useRef<ReminderState>(readReminderState(sdk.storage.get(STATE_KEY)));
  /** Reminders already announced (chime / system notification) this session. */
  const announced = useRef(new Set<string>());
  const meetingsRef = useRef(meetings);
  meetingsRef.current = meetings;
  const timer = useRef<number | undefined>(undefined);

  const evaluate = useCallback(() => {
    const now = Date.now();
    const tasks = readJson<Task[]>(sdk.storage.get(TASKS_KEY), []);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(sdk.storage.get(SETTINGS_KEY), {}) };
    const input = {
      tasks: Array.isArray(tasks) ? tasks : [],
      meetings: meetingsRef.current,
      now,
      meetingLeadMinutes: settings.meetingReminderMinutes,
      state: stateRef.current,
    };
    const due = dueReminders(input);
    publishDueBadge(input.tasks, now, mRef.current);
    const fresh = due.filter((r) => !announced.current.has(r.key));
    if (fresh.length) {
      for (const r of fresh) announced.current.add(r.key);
      if (settings.sound) playBeep();
      if (settings.systemNotifications && !document.hasFocus()) {
        for (const r of fresh) void announce(sdk, r, now, mRef.current);
      }
    }
    setActive((prev) => (sameKeys(prev, due) ? prev : due));

    window.clearTimeout(timer.current);
    const next = nextReminderAt(input);
    const delay = next == null ? POLL_MS : Math.min(POLL_MS, Math.max(1000, next - now + 50));
    timer.current = window.setTimeout(evaluate, delay);
  }, [sdk]);

  // A timer left running last session: show the "running" dot right away,
  // before the Time Tracker is opened (its provider keeps it up to date).
  useEffect(() => {
    const entries = readJson<Array<{ end: number | null }>>(sdk.storage.get('clockify:entries'), []);
    if (Array.isArray(entries) && entries.some((e) => e.end === null)) liveConnections.set(PLUGIN_ID, true);
  }, [sdk]);

  useEffect(() => {
    evaluate();
    const offTasks = onTasksChanged(evaluate);
    const onVisible = () => { if (document.visibilityState === 'visible') evaluate(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offTasks();
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timer.current);
    };
  }, [evaluate]);

  useEffect(() => { evaluate(); }, [meetings, evaluate]);

  const save = useCallback((mutate: (s: ReminderState) => ReminderState) => {
    stateRef.current = pruneReminderState(mutate(stateRef.current), Date.now());
    sdk.storage.set(STATE_KEY, JSON.stringify(stateRef.current));
    evaluate();
  }, [sdk, evaluate]);

  const dismiss = useCallback((keys: string[]) => {
    const now = Date.now();
    save((s) => ({ ...s, fired: { ...s.fired, ...Object.fromEntries(keys.map((k) => [k, now])) } }));
  }, [save]);

  const snooze = useCallback((r: DueReminder, until: number) => {
    announced.current.delete(r.key);
    save((s) => ({ ...s, snoozed: { ...s.snoozed, [r.key]: until } }));
  }, [save]);

  const complete = useCallback((r: DueReminder) => {
    if (!completeTaskInSuite(r.id)) {
      // No Time Tracker mounted, so nobody holds the list in memory.
      const tasks = readJson<Task[]>(sdk.storage.get(TASKS_KEY), []);
      const patch = statusPatch('done', Date.now());
      sdk.storage.set(TASKS_KEY, JSON.stringify(tasks.map((t) => (t.id === r.id ? { ...t, ...patch } : t))));
    }
    dismiss([r.key]);
  }, [sdk, dismiss]);

  const open = useCallback((r: DueReminder) => {
    requestOpen({ tab: r.kind === 'task' ? 'tasks' : 'notes', id: r.id });
    const route = getPlugin(PLUGIN_ID)?.route;
    if (route) navigate(route);
    dismiss([r.key]);
  }, [navigate, dismiss]);

  if (active.length === 0) return null;
  return (
    <ReminderStack
      reminders={active}
      onDismiss={(r) => dismiss([r.key])}
      onDismissAll={() => dismiss(active.map((r) => r.key))}
      onSnooze={snooze}
      onComplete={complete}
      onOpen={open}
    />
  );
}

/** Overdue + due-today open tasks as a sidebar badge on the Time Tracker. */
function publishDueBadge(tasks: Task[], now: number, m: Translate) {
  let overdue = 0;
  let today = 0;
  for (const t of tasks) {
    if (statusOf(t) === 'done') continue;
    const bucket = dueBucket(t, now);
    if (bucket === 'overdue') overdue++;
    else if (bucket === 'today') today++;
  }
  const parts = [overdue && m('badgeOverdue', { n: overdue }), today && m('badgeToday', { n: today })].filter(Boolean);
  navBadges.set(PLUGIN_ID, { count: overdue + today, tone: overdue ? 'bad' : 'info', label: parts.join(' · ') });
}

function sameKeys(a: DueReminder[], b: DueReminder[]): boolean {
  return a.length === b.length && a.every((r, i) => r.key === b[i].key && r.title === b[i].title);
}

type Translate = ReturnType<typeof useMessages<typeof MESSAGES>>;

function headingFor(r: DueReminder, now: number, m: Translate): string {
  if (r.kind === 'task') return m('taskReminder');
  const minsLeft = Math.ceil((r.at - now) / MIN);
  return minsLeft > 0 ? m('meetingSoon', { n: minsLeft }) : m('meetingNow');
}

function titleFor(r: DueReminder, m: Translate): string {
  return r.title.trim() || (r.kind === 'task' ? '—' : m('untitledMeeting'));
}

async function announce(sdk: PluginSdk, r: DueReminder, now: number, m: Translate): Promise<void> {
  const time = new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  try {
    await sdk.notify({ title: titleFor(r, m), body: `${headingFor(r, now, m)} · ${time}` });
  } catch {
    // The in-app card is still shown.
  }
}

export interface ReminderStackProps {
  reminders: DueReminder[];
  onDismiss: (r: DueReminder) => void;
  onDismissAll: () => void;
  onSnooze: (r: DueReminder, until: number) => void;
  onComplete: (r: DueReminder) => void;
  onOpen: (r: DueReminder) => void;
}

export function ReminderStack({ reminders, onDismiss, onDismissAll, onSnooze, onComplete, onOpen }: ReminderStackProps) {
  const m = useMessages(MESSAGES);
  const shown = reminders.slice(0, VISIBLE);
  const hidden = reminders.length - shown.length;
  return (
    <section
      aria-label={m('region')}
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {shown.map((r) => (
        <ReminderCard
          key={r.key}
          reminder={r}
          onDismiss={() => onDismiss(r)}
          onSnooze={(until) => onSnooze(r, until)}
          onComplete={() => onComplete(r)}
          onOpen={() => onOpen(r)}
        />
      ))}
      {reminders.length > 1 && (
        <div className="pointer-events-auto flex items-center justify-end gap-2 text-[11px] text-fg-mute">
          {hidden > 0 && <span>{m('more', { n: hidden })}</span>}
          <button type="button" onClick={onDismissAll} className="rounded-xs px-1 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
            {m('dismissAll')}
          </button>
        </div>
      )}
    </section>
  );
}

function ReminderCard({ reminder: r, onDismiss, onSnooze, onComplete, onOpen }: {
  reminder: DueReminder;
  onDismiss: () => void;
  onSnooze: (until: number) => void;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const m = useMessages(MESSAGES);
  const { locale } = useLocale();
  const now = Date.now();
  const time = new Date(r.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const isTask = r.kind === 'task';
  const Icon = isTask ? Bell : CalendarClock;
  const tomorrow9 = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  })();
  return (
    <div className="pointer-events-auto rounded-lg border border-line bg-card p-3 shadow-lift">
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', isTask ? 'bg-acc-tint text-acc-ink' : 'bg-bg-2 text-info')}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-mute">{headingFor(r, now, m)}</p>
          <p className="mt-0.5 break-words text-sm font-medium text-fg">
            {titleFor(r, m)}
          </p>
          <p className="text-xs text-fg-mute">{isTask ? time : m('meetingNotify', { time })}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={m('dismiss')}
          title={m('dismiss')}
          className="rounded-xs p-0.5 text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-ctl items-center rounded-sm px-2.5 text-xs font-medium text-fg-mute transition-colors hover:bg-sunk hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
            {m('snooze')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 p-1.5">
            <DropdownMenuItem onClick={() => onSnooze(Date.now() + 10 * MIN)}>{m('snooze10')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(Date.now() + 60 * MIN)}>{m('snooze60')}</DropdownMenuItem>
            {isTask && <DropdownMenuItem onClick={() => onSnooze(tomorrow9)}>{m('snoozeTomorrow')}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="text-xs" onClick={onOpen}>{m('open')}</Button>
        {isTask && (
          <Button size="sm" className="gap-1 text-xs" onClick={onComplete}>
            <Check className="h-3.5 w-3.5" />
            {m('markDone')}
          </Button>
        )}
      </div>
    </div>
  );
}
