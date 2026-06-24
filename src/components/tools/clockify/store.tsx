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
  start: number;
  end: number | null; // null = running
  source: EntrySource;
  /** Subtask name within the task, or null/undefined when tracked on the task directly. */
  subtask?: string | null;
}

/** A named subtask under a task. Persisted so a task can list subtasks with zero time yet. */
export interface Subtask {
  id: string;
  task: string; // task group key = task name, lowercased
  name: string;
  createdAt: number;
}

export interface Settings {
  workMinutes: number;
  breakMinutes: number;
  pomodoro: boolean;
  sound: boolean;
  weekStartsMon: boolean;
  dailyTargetHours: number;
  // Work schedule as time ranges (local "HH:MM"). Work happens before and after a
  // lunch break, so the break itself is the lunchStart–lunchEnd range.
  workStart: string;
  lunchStart: string;
  lunchEnd: string;
  workEnd: string;
}

export const DEFAULT_SETTINGS: Settings = {
  workMinutes: 25,
  breakMinutes: 5,
  pomodoro: false,
  sound: true,
  weekStartsMon: true,
  dailyTargetHours: 8,
  workStart: '09:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  workEnd: '18:00',
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
  subtasks: Subtask[];
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
  /** Rename a task group: rewrites every matching entry's description and subtask registry key. */
  renameTask: (oldName: string, newName: string) => void;
  // subtasks
  addSubtask: (taskName: string, name: string) => void;
  deleteSubtask: (taskName: string, name: string) => void;
  addEntry: (entry: Omit<TimeEntry, 'id'>) => TimeEntry;
  updateEntry: (id: string, patch: Partial<TimeEntry>) => void;
  deleteEntry: (id: string) => void;
  /** Set the total duration (ms) for a project/task on a given day (timesheet semantics). */
  setDayTotal: (projectId: string | null, taskId: string | null, dayTs: number, ms: number) => void;
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
  const [subtasks, setSubtasks] = usePersistentState<Subtask[]>('devtool:clockify:subtasks', []);
  const [settingsRaw, setSettings] = usePersistentState<Settings>('devtool:tasks:settings', DEFAULT_SETTINGS);
  // Old installs persisted only the original Pomodoro fields; merge defaults on
  // every read so new fields (weekStartsMon, work-hours, …) are present
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
                  start: r.start,
                  end: r.end,
                  source: 'tracker' as EntrySource,
                }))
          );
        }
      }

      // merge any newer default settings fields onto persisted settings
      setSettings((cur) => ({ ...DEFAULT_SETTINGS, ...cur }));

      localStorage.setItem('devtool:clockify:migrated', '1');
    } catch {
      // migration is best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- one-time purge of removed features (expenses, billable, schedule, time off) ---
  // Drops the orphaned data stores and strips the now-unused `billable` flag from
  // any persisted entries/projects so no removed-feature data lingers.
  const purged = useRef(false);
  useEffect(() => {
    if (purged.current) return;
    purged.current = true;
    try {
      if (localStorage.getItem('devtool:clockify:purged-v2')) return;
      for (const key of [
        'devtool:clockify:expenses',
        'devtool:clockify:schedule',
        'devtool:clockify:timeoff',
        'devtool:clockify:timeoff-policies',
      ]) {
        localStorage.removeItem(key);
      }
      const strip = <T extends object>(o: T): T => {
        if (!('billable' in o)) return o;
        const copy = { ...o } as Record<string, unknown>;
        delete copy.billable;
        return copy as T;
      };
      setEntries((prev) => (prev.some((e) => 'billable' in e) ? prev.map(strip) : prev));
      setProjects((prev) => (prev.some((p) => 'billable' in p) ? prev.map(strip) : prev));
      localStorage.setItem('devtool:clockify:purged-v2', '1');
    } catch {
      // best-effort
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
    },
    [setProjects, setEntries, setTasks]
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
            start: ts,
            end: null,
            source: partial.source ?? 'tracker',
            subtask: partial.subtask ?? null,
          },
        ];
      });
    },
    [setEntries]
  );

  // --- rename a task group ---
  // Tasks are grouped by (lowercased) description, so renaming rewrites the
  // description on every matching entry and re-keys its subtask definitions.
  const renameTask = useCallback(
    (oldName: string, newName: string) => {
      const from = oldName.trim().toLowerCase();
      const to = newName.trim();
      if (!from || !to || to.toLowerCase() === from) return;
      const toKey = to.toLowerCase();
      setEntries((prev) =>
        prev.map((e) => (e.description.trim().toLowerCase() === from ? { ...e, description: to } : e))
      );
      setSubtasks((prev) => {
        const renamed = prev.map((s) => (s.task === from ? { ...s, task: toKey } : s));
        // Drop duplicate subtask names that now collide under the destination key.
        const seen = new Set<string>();
        return renamed.filter((s) => {
          if (s.task !== toKey) return true;
          const k = s.name.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      });
    },
    [setEntries, setSubtasks]
  );

  // --- subtasks ---
  const addSubtask = useCallback(
    (taskName: string, name: string) => {
      const task = taskName.trim().toLowerCase();
      const n = name.trim();
      if (!task || !n) return;
      setSubtasks((prev) =>
        prev.some((s) => s.task === task && s.name.toLowerCase() === n.toLowerCase())
          ? prev
          : [...prev, { id: uid(), task, name: n, createdAt: Date.now() }]
      );
    },
    [setSubtasks]
  );
  // Remove a subtask: drop its definition and fold any of its time back onto the task directly.
  const deleteSubtask = useCallback(
    (taskName: string, name: string) => {
      const task = taskName.trim().toLowerCase();
      const lname = name.trim().toLowerCase();
      setSubtasks((prev) => prev.filter((s) => !(s.task === task && s.name.toLowerCase() === lname)));
      setEntries((prev) =>
        prev.map((e) =>
          e.description.trim().toLowerCase() === task && (e.subtask ?? '').toLowerCase() === lname
            ? { ...e, subtask: null }
            : e
        )
      );
    },
    [setSubtasks, setEntries]
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

  const value: ClockifyContextValue = {
    projects, tasks, tags, entries, subtasks, settings,
    running, now,
    projectById, taskById, tagById,
    updateSettings,
    addProject, updateProject, deleteProject,
    addTask, updateTask, deleteTask,
    addTag,
    startEntry, stopRunning, addEntry, updateEntry, deleteEntry, setDayTotal,
    renameTask, addSubtask, deleteSubtask,
  };

  return <ClockifyContext.Provider value={value}>{children}</ClockifyContext.Provider>;
}

export function useClockify(): ClockifyContextValue {
  const ctx = useContext(ClockifyContext);
  if (!ctx) throw new Error('useClockify must be used within ClockifyProvider');
  return ctx;
}
