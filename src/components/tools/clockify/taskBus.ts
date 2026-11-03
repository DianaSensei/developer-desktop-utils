// Lets the app-wide reminder runtime (reminders.tsx) and a mounted Time
// Tracker talk without sharing React state. Both persist tasks through
// usePersistentState, which has no cross-instance sync, so the runtime must
// never write tasks behind a mounted suite's back: it asks the suite to make
// the change, and only writes storage itself when no suite is mounted.

type Handlers = { complete: (id: string) => void };

let handlers: Handlers | null = null;
const changeListeners = new Set<() => void>();
const openListeners = new Set<(target: OpenTarget) => void>();
let pendingOpen: OpenTarget | null = null;

/** Called by ClockifyProvider while mounted; returns the unregister function. */
export function registerTaskHandlers(h: Handlers): () => void {
  handlers = h;
  return () => {
    if (handlers === h) handlers = null;
  };
}

/** Marks a task done through the mounted suite. False when none is mounted. */
export function completeTaskInSuite(id: string): boolean {
  if (!handlers) return false;
  handlers.complete(id);
  return true;
}

export function emitTasksChanged(): void {
  for (const fn of changeListeners) fn();
}

export function onTasksChanged(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export interface OpenTarget {
  tab: 'tasks' | 'notes';
  /** Task id for 'tasks', meeting id for 'notes'. */
  id: string;
}

/** Asks the Time Tracker to show a task or meeting; kept until a suite picks it up. */
export function requestOpen(target: OpenTarget): void {
  pendingOpen = target;
  for (const fn of openListeners) fn(target);
}

/** Reads the pending request without consuming it (safe in render). */
export function peekPendingOpen(): OpenTarget | null {
  return pendingOpen;
}

export function takePendingOpen(): OpenTarget | null {
  const t = pendingOpen;
  pendingOpen = null;
  return t;
}

export function onOpenRequest(fn: (target: OpenTarget) => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}
