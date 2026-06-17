import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { dayStart, splitRunningAcrossDays, uid } from './time';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  color: string;
  billable: boolean;
  archived: boolean;
  createdAt: number;
}

export interface Task {
  id: string;
  name: string;
  projectId: string | null;
  parentId: string | null;
  linkedIds: string[];
  completed: boolean;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
}

export type EntrySource = 'tracker' | 'timesheet' | 'manual';

export interface TimeEntry {
  id: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  tagIds: string[];
  billable: boolean;
  start: number;
  end: number | null; // null = running
  source: EntrySource;
}

export interface Expense {
  id: string;
  date: number; // day-start timestamp
  projectId: string | null;
  category: string;
  amount: number;
  note: string;
  billable: boolean;
}

export interface TimeOffPolicy {
  id: string;
  name: string;
  color: string;
  balanceDays: number | null; // null = unlimited
}

export interface TimeOffRequest {
  id: string;
  policyId: string;
  start: number; // day-start
  end: number; // day-start (inclusive)
  note: string;
}

export interface ScheduleAssignment {
  id: string;
  projectId: string | null;
  taskId: string | null;
  date: number; // day-start
  hours: number;
  note: string;
}

export interface Settings {
  workMinutes: number;
  breakMinutes: number;
  pomodoro: boolean;
  sound: boolean;
  weekStartsMon: boolean;
  dailyTargetHours: number;
  currencySymbol: string;
  expenseCategories: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  workMinutes: 25,
  breakMinutes: 5,
  pomodoro: false,
  sound: true,
  weekStartsMon: true,
  dailyTargetHours: 8,
  currencySymbol: '$',
  expenseCategories: ['General', 'Travel', 'Meals', 'Equipment', 'Software', 'Other'],
};

export const PROJECT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
];

export function randomColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface ClockifyContextValue {
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  entries: TimeEntry[];
  expenses: Expense[];
  policies: TimeOffPolicy[];
  timeOff: TimeOffRequest[];
  schedule: ScheduleAssignment[];
  settings: Settings;

  /** The currently running entry (end === null), if any. */
  running: TimeEntry | null;
  /** Live "now" — ticks every second while a timer runs, else updates on render. */
  now: number;

  // lookups
  projectById: (id: string | null) => Project | undefined;
  taskById: (id: string | null) => Task | undefined;
  tagById: (id: string) => Tag | undefined;

  // settings
  updateSettings: (patch: Partial<Settings>) => void;

  // projects
  addProject: (name: string, color?: string) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // tasks
  addTask: (name: string, projectId: string | null, parentId?: string | null) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;

  // tags
  addTag: (name: string) => Tag;

  // entries
  startEntry: (partial: Partial<Omit<TimeEntry, 'id' | 'start' | 'end'>>) => void;
  stopRunning: () => void;
  addEntry: (entry: Omit<TimeEntry, 'id'>) => TimeEntry;
  updateEntry: (id: string, patch: Partial<TimeEntry>) => void;
  deleteEntry: (id: string) => void;
  /** Set the total duration (ms) for a project/task on a given day (timesheet semantics). */
  setDayTotal: (projectId: string | null, taskId: string | null, dayTs: number, ms: number) => void;

  // expenses
  addExpense: (expense: Omit<Expense, 'id'>) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;

  // time off
  addPolicy: (name: string, color: string, balanceDays: number | null) => void;
  updatePolicy: (id: string, patch: Partial<TimeOffPolicy>) => void;
  deletePolicy: (id: string) => void;
  addTimeOff: (req: Omit<TimeOffRequest, 'id'>) => void;
  deleteTimeOff: (id: string) => void;

  // schedule
  addAssignment: (a: Omit<ScheduleAssignment, 'id'>) => void;
  updateAssignment: (id: string, patch: Partial<ScheduleAssignment>) => void;
  deleteAssignment: (id: string) => void;
}

const ClockifyContext = createContext<ClockifyContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ClockifyProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = usePersistentState<Project[]>('devtool:clockify:projects', []);
  const [tasks, setTasks] = usePersistentState<Task[]>('devtool:tasks:items', []);
  const [tags, setTags] = usePersistentState<Tag[]>('devtool:clockify:tags', []);
  const [entries, setEntries] = usePersistentState<TimeEntry[]>('devtool:clockify:entries', []);
  const [expenses, setExpenses] = usePersistentState<Expense[]>('devtool:clockify:expenses', []);
  const [policies, setPolicies] = usePersistentState<TimeOffPolicy[]>('devtool:clockify:timeoff-policies', []);
  const [timeOff, setTimeOff] = usePersistentState<TimeOffRequest[]>('devtool:clockify:timeoff', []);
  const [schedule, setSchedule] = usePersistentState<ScheduleAssignment[]>('devtool:clockify:schedule', []);
  const [settingsRaw, setSettings] = usePersistentState<Settings>('devtool:tasks:settings', DEFAULT_SETTINGS);
  // Old installs persisted only the original Pomodoro fields; merge defaults on
  // every read so new fields (weekStartsMon, expenseCategories, …) are present
  // before the migration effect runs.
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...settingsRaw }), [settingsRaw]);

  // --- one-time migration from the old single Task Tracker tool ---
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    try {
      if (localStorage.getItem('devtool:clockify:migrated')) return;

      // normalize tasks loaded from the old key (add projectId if absent)
      setTasks((prev) =>
        prev.map((t) => ({
          ...t,
          parentId: t.parentId ?? null,
          linkedIds: t.linkedIds ?? [],
          completed: t.completed ?? false,
          createdAt: t.createdAt ?? Date.now(),
          projectId: t.projectId ?? null,
        }))
      );

      // convert old time records → time entries (only if we have none yet)
      const rawRecords = localStorage.getItem('devtool:tasks:records');
      if (rawRecords) {
        const old = JSON.parse(rawRecords) as Array<{ id: string; taskId: string; start: number; end: number | null }>;
        if (old.length) {
          setEntries((cur) =>
            cur.length
              ? cur
              : old.map((r) => ({
                  id: r.id,
                  description: '',
                  projectId: null,
                  taskId: r.taskId,
                  tagIds: [],
                  billable: false,
                  start: r.start,
                  end: r.end,
                  source: 'tracker' as EntrySource,
                }))
          );
        }
      }

      // seed default time-off policies if none exist
      setPolicies((cur) =>
        cur.length
          ? cur
          : [
              { id: uid(), name: 'Vacation', color: '#3b82f6', balanceDays: 20 },
              { id: uid(), name: 'Sick leave', color: '#f97316', balanceDays: 10 },
            ]
      );

      // merge any newer default settings fields onto persisted settings
      setSettings((cur) => ({ ...DEFAULT_SETTINGS, ...cur }));

      localStorage.setItem('devtool:clockify:migrated', '1');
    } catch {
      // migration is best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- live tick while a timer runs ---
  const running = useMemo(() => entries.find((e) => e.end === null) ?? null, [entries]);
  const isRunning = !!running;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // auto-split a running entry across midnights
  useEffect(() => {
    if (!isRunning) return;
    setEntries((prev) => splitRunningAcrossDays(prev, Date.now()));
  });

  const now = Date.now();

  // --- lookups ---
  const projMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const projectById = useCallback((id: string | null) => (id ? projMap.get(id) : undefined), [projMap]);
  const taskById = useCallback((id: string | null) => (id ? taskMap.get(id) : undefined), [taskMap]);
  const tagById = useCallback((id: string) => tagMap.get(id), [tagMap]);

  // --- settings ---
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings]
  );

  // --- projects ---
  const addProject = useCallback(
    (name: string, color?: string) => {
      const p: Project = {
        id: uid(),
        name: name.trim() || 'Untitled',
        color: color ?? randomColor(),
        billable: false,
        archived: false,
        createdAt: Date.now(),
      };
      setProjects((prev) => [...prev, p]);
      return p;
    },
    [setProjects]
  );
  const updateProject = useCallback(
    (id: string, patch: Partial<Project>) =>
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    [setProjects]
  );
  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      // detach references rather than deleting the time data
      setEntries((prev) => prev.map((e) => (e.projectId === id ? { ...e, projectId: null } : e)));
      setTasks((prev) => prev.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)));
      setExpenses((prev) => prev.map((x) => (x.projectId === id ? { ...x, projectId: null } : x)));
      setSchedule((prev) => prev.map((a) => (a.projectId === id ? { ...a, projectId: null } : a)));
    },
    [setProjects, setEntries, setTasks, setExpenses, setSchedule]
  );

  // --- tasks ---
  const addTask = useCallback(
    (name: string, projectId: string | null, parentId: string | null = null) => {
      const t: Task = {
        id: uid(),
        name: name.trim() || 'Untitled',
        projectId,
        parentId,
        linkedIds: [],
        completed: false,
        createdAt: Date.now(),
      };
      setTasks((prev) => [...prev, t]);
      return t;
    },
    [setTasks]
  );
  const updateTask = useCallback(
    (id: string, patch: Partial<Task>) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [setTasks]
  );
  const deleteTask = useCallback(
    (id: string) => {
      setTasks((prev) =>
        prev
          .filter((t) => t.id !== id)
          .map((t) => ({
            ...t,
            parentId: t.parentId === id ? null : t.parentId,
            linkedIds: t.linkedIds.filter((x) => x !== id),
          }))
      );
      setEntries((prev) => prev.map((e) => (e.taskId === id ? { ...e, taskId: null } : e)));
    },
    [setTasks, setEntries]
  );

  // --- tags ---
  const addTag = useCallback(
    (name: string) => {
      const existing = tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) return existing;
      const tag: Tag = { id: uid(), name: name.trim() };
      setTags((prev) => [...prev, tag]);
      return tag;
    },
    [tags, setTags]
  );

  // --- entries ---
  const startEntry = useCallback(
    (partial: Partial<Omit<TimeEntry, 'id' | 'start' | 'end'>>) => {
      const ts = Date.now();
      setEntries((prev) => {
        const stopped = prev.map((e) => (e.end === null ? { ...e, end: ts } : e));
        return [
          ...stopped,
          {
            id: uid(),
            description: partial.description ?? '',
            projectId: partial.projectId ?? null,
            taskId: partial.taskId ?? null,
            tagIds: partial.tagIds ?? [],
            billable: partial.billable ?? false,
            start: ts,
            end: null,
            source: partial.source ?? 'tracker',
          },
        ];
      });
    },
    [setEntries]
  );
  const stopRunning = useCallback(() => {
    const ts = Date.now();
    setEntries((prev) => prev.map((e) => (e.end === null ? { ...e, end: ts } : e)));
  }, [setEntries]);
  const addEntry = useCallback(
    (entry: Omit<TimeEntry, 'id'>) => {
      const full: TimeEntry = { ...entry, id: uid() };
      setEntries((prev) => [...prev, full]);
      return full;
    },
    [setEntries]
  );
  const updateEntry = useCallback(
    (id: string, patch: Partial<TimeEntry>) =>
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    [setEntries]
  );
  const deleteEntry = useCallback(
    (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)),
    [setEntries]
  );

  const setDayTotal = useCallback(
    (projectId: string | null, taskId: string | null, dayTs: number, ms: number) => {
      const ds = dayStart(dayTs);
      setEntries((prev) => {
        const matches = (e: TimeEntry) =>
          e.projectId === projectId && e.taskId === taskId && dayStart(e.start) === ds && e.end !== null;
        const currentTotal = prev.filter(matches).reduce((s, e) => s + (e.end! - e.start), 0);
        const target = Math.max(0, ms);
        const delta = target - currentTotal;
        if (Math.abs(delta) < 1000) return prev;

        // adjust the existing timesheet entry if present, else create one
        const sheetEntry = prev.find((e) => matches(e) && e.source === 'timesheet');
        if (delta > 0) {
          if (sheetEntry) {
            return prev.map((e) => (e.id === sheetEntry.id ? { ...e, end: e.end! + delta } : e));
          }
          const start = ds + 9 * 3600_000; // 09:00
          return [
            ...prev,
            {
              id: uid(),
              description: '',
              projectId,
              taskId,
              tagIds: [],
              billable: false,
              start,
              end: start + delta,
              source: 'timesheet' as EntrySource,
            },
          ];
        }
        // delta < 0: shrink the timesheet entry (don't touch tracked time)
        if (sheetEntry) {
          const dur = sheetEntry.end! - sheetEntry.start;
          const newDur = Math.max(0, dur + delta);
          if (newDur <= 0) return prev.filter((e) => e.id !== sheetEntry.id);
          return prev.map((e) => (e.id === sheetEntry.id ? { ...e, end: e.start + newDur } : e));
        }
        return prev; // can't reduce tracked-only time below itself
      });
    },
    [setEntries]
  );

  // --- expenses ---
  const addExpense = useCallback(
    (expense: Omit<Expense, 'id'>) => setExpenses((prev) => [...prev, { ...expense, id: uid() }]),
    [setExpenses]
  );
  const updateExpense = useCallback(
    (id: string, patch: Partial<Expense>) =>
      setExpenses((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    [setExpenses]
  );
  const deleteExpense = useCallback(
    (id: string) => setExpenses((prev) => prev.filter((x) => x.id !== id)),
    [setExpenses]
  );

  // --- time off ---
  const addPolicy = useCallback(
    (name: string, color: string, balanceDays: number | null) =>
      setPolicies((prev) => [...prev, { id: uid(), name: name.trim() || 'Policy', color, balanceDays }]),
    [setPolicies]
  );
  const updatePolicy = useCallback(
    (id: string, patch: Partial<TimeOffPolicy>) =>
      setPolicies((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    [setPolicies]
  );
  const deletePolicy = useCallback(
    (id: string) => {
      setPolicies((prev) => prev.filter((p) => p.id !== id));
      setTimeOff((prev) => prev.filter((r) => r.policyId !== id));
    },
    [setPolicies, setTimeOff]
  );
  const addTimeOff = useCallback(
    (req: Omit<TimeOffRequest, 'id'>) => setTimeOff((prev) => [...prev, { ...req, id: uid() }]),
    [setTimeOff]
  );
  const deleteTimeOff = useCallback(
    (id: string) => setTimeOff((prev) => prev.filter((r) => r.id !== id)),
    [setTimeOff]
  );

  // --- schedule ---
  const addAssignment = useCallback(
    (a: Omit<ScheduleAssignment, 'id'>) => setSchedule((prev) => [...prev, { ...a, id: uid() }]),
    [setSchedule]
  );
  const updateAssignment = useCallback(
    (id: string, patch: Partial<ScheduleAssignment>) =>
      setSchedule((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a))),
    [setSchedule]
  );
  const deleteAssignment = useCallback(
    (id: string) => setSchedule((prev) => prev.filter((a) => a.id !== id)),
    [setSchedule]
  );

  const value: ClockifyContextValue = {
    projects, tasks, tags, entries, expenses, policies, timeOff, schedule, settings,
    running, now,
    projectById, taskById, tagById,
    updateSettings,
    addProject, updateProject, deleteProject,
    addTask, updateTask, deleteTask,
    addTag,
    startEntry, stopRunning, addEntry, updateEntry, deleteEntry, setDayTotal,
    addExpense, updateExpense, deleteExpense,
    addPolicy, updatePolicy, deletePolicy, addTimeOff, deleteTimeOff,
    addAssignment, updateAssignment, deleteAssignment,
  };

  return <ClockifyContext.Provider value={value}>{children}</ClockifyContext.Provider>;
}

export function useClockify(): ClockifyContextValue {
  const ctx = useContext(ClockifyContext);
  if (!ctx) throw new Error('useClockify must be used within ClockifyProvider');
  return ctx;
}
