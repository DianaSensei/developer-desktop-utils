import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import type { Detected, ProfileSnapshot, SessionInfo, UsageBucket } from './usage';

/**
 * Renders the tool against a mocked `claude_monitor_*` IPC. `isTauri` is read
 * at module load, so `__TAURI_INTERNALS__` is set before the tool is imported.
 */

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const HOUR = Math.floor(Date.now() / 3_600_000);
const KEYS = ['profiles', 'tab', 'range', 'autoRefresh', 'autoDetected', 'ignoredDirs'].map((k) => `devtool:claude-manager:${k}`);

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

const found = (configDir: string, over: Partial<Detected> = {}): Detected => ({
  configDir, source: 'scan', valid: true, email: null, sessions: 1, ...over,
});
/** What a rescan of the machine finds; each test sets its own. */
let onMachine: Detected[] = [];

let Tool: ComponentType;
let Providers: ComponentType<{ children: ReactNode }>;
const ClaudeManager = () => <Providers><Tool /></Providers>;
let storageSet: (key: string, value: string) => void;
let storageRemove: (key: string) => void;

beforeAll(async () => {
  // `invoke` here too: the tool makes two IPC calls on mount, each through
  // its own dynamic import, and under Vitest the second one can resolve to
  // the real module instead of the mock above.
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string, args?: unknown) => invokeMock(command, args),
  };
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
  onMachine = [found('~/.claude', { source: 'default' })];
  invokeMock.mockImplementation(async (command: string, args?: { dirs?: string[]; roots?: string[] | null }) => {
    if (command === 'claude_monitor_detect') {
      if (!args?.roots) return onMachine;
      return args.roots.map((root) => found(root, { source: 'custom', valid: root.includes('claude') }));
    }
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

  it('tracks everything it finds the first time it opens, wherever other tools keep it', async () => {
    onMachine = [found('~/.claude', { source: 'default' }), found('~/.switcher/instances/claude-work', { source: 'process' })];
    setTab('accounts');
    render(<ClaudeManager />);
    await screen.findByText('~/.switcher/instances/claude-work');
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'claude_monitor_scan', { dirs: ['~/.claude', '~/.switcher/instances/claude-work'] }));
    // Nothing left to offer.
    expect(screen.queryByText(/Found on this machine|Tìm thấy trên máy/)).toBeNull();
  });

  it('after the first run, only offers new finds — and a removed directory stays removed', async () => {
    storageSet(KEYS[4], JSON.stringify(true));
    onMachine = [found('~/.claude', { source: 'default' }), found('~/.claude-work', { email: 'me@work.example' })];
    setTab('accounts');
    render(<ClaudeManager />);
    await screen.findByText(/Found on this machine|Tìm thấy trên máy/);
    expect(invokeMock).not.toHaveBeenCalledWith('claude_monitor_scan', { dirs: ['~/.claude', '~/.claude-work'] });

    fireEvent.click(screen.getByRole('button', { name: /^Ignore$|^Bỏ qua$/ }));
    expect(screen.queryByText(/Found on this machine|Tìm thấy trên máy/)).toBeNull();
    expect(screen.getByText(/1 directories ignored|Đang bỏ qua 1 thư mục/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Show them again|Hiện lại/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Add all$|^Thêm tất cả$/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'claude_monitor_scan', { dirs: ['~/.claude', '~/.claude-work'] }));
  });

  it('adds a custom path, and says so when the folder holds no Claude data', async () => {
    storageSet(KEYS[4], JSON.stringify(true));
    setTab('accounts');
    render(<ClaudeManager />);
    await screen.findByText('me@example.com');
    const path = screen.getByLabelText(/Config directory|Thư mục cấu hình/);

    fireEvent.change(path, { target: { value: '/data/photos' } });
    fireEvent.keyDown(path, { key: 'Enter' });
    expect(await screen.findByText(/No Claude Code data in "\/data\/photos"|Không thấy dữ liệu Claude Code trong "\/data\/photos"/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Label$|^Tên gọi$/), { target: { value: 'Client A' } });
    fireEvent.change(path, { target: { value: '/opt/tools/claude-accounts/a' } });
    fireEvent.keyDown(path, { key: 'Enter' });
    expect(await screen.findByText('Client A')).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith('claude_monitor_detect', { roots: ['/opt/tools/claude-accounts/a'] });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      'claude_monitor_scan', { dirs: ['~/.claude', '/opt/tools/claude-accounts/a'] }));
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
