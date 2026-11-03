import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { MeetingsProvider } from '@/lib/meetings';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { ClockifySuite } from './Suite';
import { requestOpen } from './taskBus';
import type { Task } from './store';

const TASKS = 'devtool:task-tracker:tasks:items';
const ENTRIES = 'devtool:task-tracker:clockify:entries';

function saved(): Task[] {
  return JSON.parse(storageGet(TASKS) ?? '[]') as Task[];
}

function seed(tasks: Partial<Task>[]) {
  storageSet(TASKS, JSON.stringify(tasks.map((t, i) => ({
    id: `t${i}`, name: `Task ${i}`, projectId: null, parentId: null, linkedIds: [], completed: false, createdAt: i, ...t,
  }))));
}

function renderSuite() {
  render(<LocaleProvider><MeetingsProvider><ClockifySuite /></MeetingsProvider></LocaleProvider>);
}

function openTasksTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
}

beforeEach(() => {
  for (const k of [TASKS, ENTRIES, 'devtool:task-tracker:tasks:view', 'devtool:task-tracker:tasks:filter']) storageRemove(k);
  storageSet('devtool:clockify:migrated', '1');
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => cleanup());

describe('Tasks tab', () => {
  it('adds a task with Enter and persists it as a to-do', () => {
    renderSuite();
    openTasksTab();
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    const input = screen.getByLabelText('Add a new task');
    fireEvent.change(input, { target: { value: 'Review PR #210' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Review PR #210')).toBeTruthy();
    expect(screen.getByText('No date')).toBeTruthy();
    expect(saved()).toMatchObject([{ name: 'Review PR #210', status: 'todo', priority: 'none', completed: false }]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('adding from Today makes the task due today', () => {
    renderSuite();
    openTasksTab();
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    const input = screen.getByLabelText('Add a new task');
    fireEvent.change(input, { target: { value: 'Ship it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const [t] = saved();
    expect(t.dueAt).toBe(new Date(new Date().setHours(0, 0, 0, 0)).getTime());
    expect(screen.getByText('Ship it')).toBeTruthy();
  });

  it('checking a task marks it done and keeps the legacy flag in step', () => {
    seed([{ name: 'Write docs' }]);
    renderSuite();
    openTasksTab();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as done' }));
    expect(saved()[0]).toMatchObject({ status: 'done', completed: true });
    expect(screen.queryByText('Write docs')).toBeNull(); // "Open" hides done
    fireEvent.click(screen.getByRole('tab', { name: 'Done' }));
    expect(screen.getByText('Write docs')).toBeTruthy();
  });

  it('groups open tasks by due date with overdue first', () => {
    const day = 24 * 3600_000;
    const today = new Date().setHours(0, 0, 0, 0);
    seed([
      { name: 'Later one', dueAt: today + 30 * day },
      { name: 'Late one', dueAt: today - 2 * day },
      { name: 'Someday' },
    ]);
    renderSuite();
    openTasksTab();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Overdue1', 'Later1', 'No date1']);
  });

  it('starting the timer from a task tracks time against it and moves it to In progress', () => {
    seed([{ name: 'Fix bug' }]);
    renderSuite();
    openTasksTab();
    fireEvent.click(screen.getByRole('button', { name: 'Track time on this task' }));
    const entries = JSON.parse(storageGet(ENTRIES) ?? '[]') as Array<{ taskId: string; description: string; end: number | null }>;
    expect(entries).toMatchObject([{ taskId: 't0', description: 'Fix bug', end: null }]);
    expect(saved()[0].status).toBe('doing');
    expect(screen.getByRole('button', { name: 'Stop tracking' })).toBeTruthy();
  });

  it('edits priority and notes in the editor', () => {
    seed([{ name: 'Plan sprint' }]);
    renderSuite();
    openTasksTab();
    fireEvent.click(screen.getByRole('button', { name: /Plan sprint/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'High' }));
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Capacity 30 pts' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved()[0]).toMatchObject({ priority: 'high', notes: 'Capacity 30 pts' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('board view moves a task to another column on drop', () => {
    seed([{ name: 'Card' }]);
    storageSet('devtool:task-tracker:tasks:view', JSON.stringify('board'));
    renderSuite();
    openTasksTab();
    const todo = screen.getByRole('region', { name: 'To do' });
    expect(within(todo).getByText('Card')).toBeTruthy();
    // Pointer-driven (HTML5 drag events never reach a Tauri webview); jsdom
    // has no layout, so point elementFromPoint at the target column.
    const drop = screen.getByRole('region', { name: 'In progress' });
    const original = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => drop);
    try {
      fireEvent.pointerDown(within(todo).getByText('Card').closest('li')!, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
      expect(drop.className).toContain('bg-acc-tint');
      fireEvent.pointerUp(window, { clientX: 40, clientY: 0 });
    } finally {
      document.elementFromPoint = original;
    }
    expect(saved()[0].status).toBe('doing');
    expect(within(screen.getByRole('region', { name: 'In progress' })).getByText('Card')).toBeTruthy();
  });

  it("a reminder's Open switches to the task and opens its editor", () => {
    seed([{ name: 'Call vendor', status: 'done', completed: true }]);
    renderSuite();
    act(() => requestOpen({ tab: 'tasks', id: 't0' }));
    expect(within(screen.getByRole('dialog')).getByDisplayValue('Call vendor')).toBeTruthy();
  });
});
