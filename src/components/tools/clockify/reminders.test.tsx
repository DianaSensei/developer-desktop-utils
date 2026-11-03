import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { MeetingsProvider } from '@/lib/meetings';
import { TaskReminders } from './reminders';
import { registerTaskHandlers, takePendingOpen } from './taskBus';
import type { Task } from './store';

const TASKS = 'devtool:task-tracker:tasks:items';
const SETTINGS = 'devtool:task-tracker:tasks:settings';
const STATE = 'devtool:task-tracker:reminders:state';
const MIN = 60_000;

function Where() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderRuntime() {
  render(
    <MemoryRouter initialEntries={['/json']}>
      <LocaleProvider>
        <FeatureProvider>
          <MeetingsProvider>
            <Where />
            <TaskReminders />
          </MeetingsProvider>
        </FeatureProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

function seedTask(patch: Partial<Task>) {
  storageSet(TASKS, JSON.stringify([{
    id: 'a', name: 'Send invoice', projectId: null, parentId: null, linkedIds: [], completed: false, createdAt: 1, ...patch,
  }]));
}

const savedTasks = () => JSON.parse(storageGet(TASKS) ?? '[]') as Task[];
const savedState = () => JSON.parse(storageGet(STATE) ?? '{}') as { fired?: Record<string, number>; snoozed?: Record<string, number> };

beforeEach(() => {
  for (const k of [TASKS, STATE, 'devtool:meetings']) storageRemove(k);
  storageSet(SETTINGS, JSON.stringify({ sound: false, systemNotifications: false }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskReminders', () => {
  it('shows nothing when no reminder is due', () => {
    seedTask({ remindAt: Date.now() + 10 * MIN });
    renderRuntime();
    expect(screen.queryByRole('region', { name: 'Reminders' })).toBeNull();
  });

  it('rings a due task reminder, and Done completes the task when no suite is mounted', () => {
    const remindAt = Date.now() - MIN;
    seedTask({ remindAt });
    renderRuntime();
    expect(screen.getByText('Send invoice')).toBeTruthy();
    expect(screen.getByText('Task reminder')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(savedTasks()[0]).toMatchObject({ status: 'done', completed: true });
    expect(savedState().fired).toHaveProperty(`task:a:${remindAt}`);
    expect(screen.queryByText('Send invoice')).toBeNull();
  });

  it('Done goes through a mounted suite instead of writing storage behind it', () => {
    seedTask({ remindAt: Date.now() - MIN });
    const complete = vi.fn();
    const off = registerTaskHandlers({ complete });
    try {
      renderRuntime();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(complete).toHaveBeenCalledWith('a');
      expect(savedTasks()[0].status).toBeUndefined();
    } finally {
      off();
    }
  });

  it('a reminder set while the app runs rings at its time', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    seedTask({ remindAt: Date.now() + 2 * MIN });
    renderRuntime();
    expect(screen.queryByText('Send invoice')).toBeNull();
    act(() => { vi.advanceTimersByTime(2 * MIN + 100); });
    expect(screen.getByText('Send invoice')).toBeTruthy();
  });

  it('dismiss records the reminder so it does not come back', () => {
    seedTask({ remindAt: Date.now() - MIN });
    renderRuntime();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Send invoice')).toBeNull();
    cleanup();
    renderRuntime();
    expect(screen.queryByText('Send invoice')).toBeNull();
  });

  it('snooze hides it until the snooze ends', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    seedTask({ remindAt: Date.now() - MIN });
    renderRuntime();
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'In 10 minutes' }));
    expect(screen.queryByText('Send invoice')).toBeNull();
    act(() => { vi.advanceTimersByTime(10 * MIN + 100); });
    expect(screen.getByText('Send invoice')).toBeTruthy();
  });

  it('Open navigates to the Time Tracker and asks it to show the task', () => {
    seedTask({ remindAt: Date.now() - MIN });
    renderRuntime();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('path').textContent).toBe('/task-tracker');
    expect(takePendingOpen()).toEqual({ tab: 'tasks', id: 'a' });
  });

  it('reminds before a meeting', () => {
    const start = Date.now() + 5 * MIN;
    storageSet('devtool:meetings', JSON.stringify([{
      id: 'm1', title: 'Sprint review', start, end: start + 30 * MIN,
      participants: '', agenda: '', decisions: '', actions: '', createdAt: 1, updatedAt: 1,
    }]));
    renderRuntime();
    expect(screen.getByText('Sprint review')).toBeTruthy();
    expect(screen.getByText('Meeting in 5 min')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('a system notification goes out when the window is not focused', async () => {
    storageSet(SETTINGS, JSON.stringify({ sound: false, systemNotifications: true }));
    const shown: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = async () => 'granted' as NotificationPermission;
      onclick: (() => void) | null = null;
      constructor(title: string) { shown.push(title); }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    try {
      seedTask({ remindAt: Date.now() - MIN });
      renderRuntime();
      await act(async () => { await Promise.resolve(); });
      expect(shown).toEqual(['Send invoice']);
    } finally {
      focus.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
