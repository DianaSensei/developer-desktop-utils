import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import type { ProfileSnapshot, SessionInfo, UsageBucket } from './usage';

/**
 * Renders the tool against a mocked `claude_monitor_*` IPC. `isTauri` is read
 * at module load, so `__TAURI_INTERNALS__` is set before the tool is imported.
 */

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const HOUR = Math.floor(Date.now() / 3_600_000);
const KEYS = ['profiles', 'tab', 'range', 'autoRefresh'].map((k) => `devtool:claude-manager:${k}`);

const bucket = (over: Partial<UsageBucket>): UsageBucket => ({
  hour: HOUR, model: 'claude-opus-5-5', input: 1_000_000, output: 100_000, cacheWrite5m: 0, cacheWrite1h: 0,
  cacheRead: 0, requests: 3, ...over,
});

const session = (over: Partial<SessionInfo>): SessionInfo => ({
  id: 'sess-1', project: '-work-app', cwd: '/work/app', gitBranch: 'main', title: 'Fix login bug',
  version: '2.1.0', startedAt: Date.now() - 3_600_000, lastActivityAt: Date.now() - 60 * 60_000, prompts: 4,
  subagents: 0, lastRole: 'assistant', lastStopReason: 'end_turn', live: null, buckets: [bucket({})], ...over,
});

const personal: ProfileSnapshot = {
  configDir: '~/.claude',
  exists: true,
  account: { email: 'me@example.com', organization: 'Personal', displayName: null },
  sessions: [
    session({
      id: 'live-1', title: 'Build claude manager', subagents: 2,
      live: { pid: 4242, status: 'busy', kind: 'interactive', name: 'app', entrypoint: 'cli', updatedAt: null },
    }),
    session({}),
  ],
};
const work: ProfileSnapshot = {
  configDir: '~/.claude-work',
  exists: true,
  account: { email: 'me@work.example', organization: 'Acme', displayName: null },
  sessions: [session({ id: 'work-1', title: 'Review PR', cwd: '/work/site', buckets: [bucket({ model: 'claude-haiku-5-5' })] })],
};

let Tool: ComponentType;
let Providers: ComponentType<{ children: ReactNode }>;
const ClaudeManager = () => <Providers><Tool /></Providers>;
let storageSet: (key: string, value: string) => void;
let storageRemove: (key: string) => void;

beforeAll(async () => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  ({ storageSet, storageRemove } = await import('@/lib/persistentStore'));
  ({ AppConfigProvider: Providers } = await import('@/contexts/AppConfigContext'));
  ({ ClaudeManager: Tool } = await import('./ClaudeManager'));
});

afterAll(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

beforeEach(() => {
  KEYS.forEach((key) => storageRemove(key));
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, args?: { dirs?: string[] }) => {
    if (command === 'claude_monitor_detect') return ['~/.claude', '~/.claude-work'];
    return (args?.dirs ?? []).map((dir) => (dir === '~/.claude-work' ? work : personal));
  });
});

afterEach(() => cleanup());

const setTab = (tab: string) => storageSet(KEYS[1], JSON.stringify(tab));

describe('ClaudeManager', () => {
  it('scans the default directory and shows running sessions with their status', async () => {
    render(<ClaudeManager />);
    await screen.findByText('Build claude manager');
    expect(invokeMock).toHaveBeenCalledWith('claude_monitor_scan', { dirs: ['~/.claude'] });
    expect(screen.getByText(/^working$|^đang chạy$/)).toBeTruthy();
    expect(screen.getByText(/2 subagents|2 agent con/)).toBeTruthy();
    expect(screen.getByText(/PID 4242/)).toBeTruthy();
    // The ended session sits under "Recent".
    expect(screen.getByText('Fix login bug')).toBeTruthy();
    // 2 sessions × (1M input + 100K output) on opus-5-5 = 2.2M tokens, $12.
    expect(screen.getAllByText('2.20M').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$12.00').length).toBeGreaterThan(0);
  });

  it('filters the session list by status and text', async () => {
    setTab('sessions');
    render(<ClaudeManager />);
    await screen.findByText('Fix login bug');
    fireEvent.click(screen.getByRole('tab', { name: /^Running$|^Đang mở$/ }));
    expect(screen.queryByText('Fix login bug')).toBeNull();
    expect(screen.getByText('Build claude manager')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Search title|Tìm theo tiêu đề/), { target: { value: 'nothing-like-this' } });
    expect(screen.getByText(/No sessions match|Không có phiên nào khớp/)).toBeTruthy();
  });

  it('detects a second account and rescans both directories', async () => {
    setTab('accounts');
    render(<ClaudeManager />);
    await screen.findByText('me@example.com');
    fireEvent.click(screen.getByRole('button', { name: /^Detect$|^Tự tìm$/ }));
    await screen.findByText('me@work.example');
    expect(screen.getByText('~/.claude-work')).toBeTruthy();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('claude_monitor_scan', { dirs: ['~/.claude', '~/.claude-work'] }));
  });

  it('breaks usage down by account, model, project and day', async () => {
    storageSet(KEYS[0], JSON.stringify([
      { id: 'default', label: 'Default', configDir: '~/.claude' },
      { id: 'w', label: 'Work', configDir: '~/.claude-work' },
    ]));
    setTab('usage');
    render(<ClaudeManager />);
    await screen.findByText('haiku-5-5');
    expect(screen.getByText('opus-5-5')).toBeTruthy();
    expect(screen.getByText('site')).toBeTruthy();
    for (const heading of [/By account|Theo tài khoản/, /By model|Theo model/, /By project|Theo dự án/, /By day|Theo ngày/]) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
  });

  it('shows the scan error instead of an empty list', async () => {
    invokeMock.mockRejectedValue(new Error('boom'));
    render(<ClaudeManager />);
    expect(await screen.findByText('boom')).toBeTruthy();
  });
});
