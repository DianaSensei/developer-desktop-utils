// End-to-end-ish coverage of the Runner dialog's run loop. The aggregation
// itself is unit-tested in runnerStats.test.ts; what this covers is the part
// that only exists inside the React tree — records living in refs with a
// throttled flush (so a 100k-iteration run doesn't re-render per request),
// which is exactly the plumbing where a result can be counted but never
// reach the screen.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RunnerDialog } from './RunnerDialog';
import { newRequest } from './types';
import { pickDataFile, saveTextFile } from './fileio';
import type { ExecResult } from './engine';
import type { ApiRequest, TestResult, VarMap } from './types';

// The file pickers touch the Tauri dialog/fs plugins (or an <input type=file>
// the test can't drive), so the data-file and export paths are exercised
// through mocked I/O — everything between the picker and the written text is
// the real code.
vi.mock('./fileio', () => ({
  pickDataFile: vi.fn(),
  saveTextFile: vi.fn(async () => {}),
  saveJsonFile: vi.fn(async () => {}),
}));

function execOk(status: number, ms = 10, tests: TestResult[] = []): ExecResult {
  return {
    response: {
      status,
      statusText: status === 200 ? 'OK' : 'Server Error',
      ok: status < 400,
      headers: [],
      body: '{}',
      contentType: 'application/json',
      timeMs: ms,
      sizeBytes: 100,
      url: 'https://api.test/x',
    },
    tests,
    logs: [],
    error: null,
    collectionVars: {}, collectionVarsChanged: false,
    collectionEnvVars: {}, collectionEnvChanged: false,
    globalEnvVars: {}, globalEnvChanged: false,
  };
}

function execError(message: string): ExecResult {
  return {
    response: null,
    tests: [],
    logs: [],
    error: message,
    collectionVars: {}, collectionVarsChanged: false,
    collectionEnvVars: {}, collectionEnvChanged: false,
    globalEnvVars: {}, globalEnvChanged: false,
  };
}

const login = newRequest({ id: 'r1', name: 'Login', method: 'POST', url: 'https://api.test/login' });
const getUser = newRequest({ id: 'r2', name: 'Get user', method: 'GET', url: 'https://api.test/user/{{userId}}' });

function setup(
  runRequest: (req: ApiRequest, dataVars?: VarMap) => Promise<ExecResult>,
  requests = [login, getUser],
) {
  return render(
    <RunnerDialog
      title="My collection"
      requests={requests}
      runRequest={(req, dataVars) => runRequest(req, dataVars)}
      environments={[]}
      defaultEnvId={null}
      open
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.mocked(pickDataFile).mockReset();
  vi.mocked(saveTextFile).mockClear();
});

const clickRun = () => fireEvent.click(screen.getByRole('button', { name: /Run \d+ request/ }));

// The dashboard tile for a label, e.g. Requests / Passed / Failed.
const statValue = (label: string) => {
  const tile = screen.getByText(label).closest('div');
  return tile?.textContent?.replace(label, '').trim() ?? '';
};

describe('RunnerDialog run loop', () => {
  it('runs every selected request and surfaces the results', async () => {
    const runRequest = vi.fn(async () => execOk(200));
    setup(runRequest);

    clickRun();

    await waitFor(() => expect(runRequest).toHaveBeenCalledTimes(2));
    // The throttled flush must actually publish — this is the assertion that
    // fails if records stay stranded in their ref.
    await waitFor(() => expect(statValue('Requests')).toBe('2'));
    expect(statValue('Passed')).toBe('2');
    expect(statValue('Failed')).toBe('0');
  });

  it('tracks the response code of each request', async () => {
    const runRequest = vi.fn(async (req: ApiRequest) => (req.name === 'Login' ? execOk(200) : execOk(500)));
    setup(runRequest);

    clickRun();

    await waitFor(() => expect(statValue('Failed')).toBe('1'));
    // Run-wide status breakdown.
    expect(screen.getByRole('button', { name: /^200\s*×1$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^500\s*×1$/ })).toBeTruthy();
  });

  it('buckets a request that never responded under "error", not 0', async () => {
    const runRequest = vi.fn(async (req: ApiRequest) => (
      req.name === 'Login' ? execOk(200) : execError('ECONNREFUSED')
    ));
    setup(runRequest);

    clickRun();

    await waitFor(() => expect(statValue('Failed')).toBe('1'));
    expect(screen.getByRole('button', { name: /^error\s*×1$/ })).toBeTruthy();
  });

  it('rolls response codes up per request across iterations', async () => {
    // Get user alternates 200 / 500 across the two iterations.
    let getUserCalls = 0;
    const runRequest = vi.fn(async (req: ApiRequest) => {
      if (req.name === 'Login') return execOk(200, 20);
      getUserCalls += 1;
      return execOk(getUserCalls === 1 ? 500 : 200, 40);
    });
    setup(runRequest);

    fireEvent.change(screen.getByRole('textbox', { name: /Iterations/i }), { target: { value: '2' } });
    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('4'));

    fireEvent.click(screen.getByRole('tab', { name: 'By request' }));

    // Scoped to the rollup table: the sequence pane stays mounted (hidden) so
    // switching views keeps its scroll position, and it names requests too.
    const table = within(screen.getByRole('table'));
    const loginRow = table.getByText('Login').closest('tr')!;
    expect(within(loginRow).getByRole('button', { name: /^200\s*×2$/ })).toBeTruthy();

    const userRow = table.getByText('Get user').closest('tr')!;
    expect(within(userRow).getByRole('button', { name: /^200\s*×1$/ })).toBeTruthy();
    expect(within(userRow).getByRole('button', { name: /^500\s*×1$/ })).toBeTruthy();
  });

  it('jumps to the iteration a status code came from', async () => {
    // Only the second iteration's Get user fails, so the jump has to land on
    // iteration 2 rather than wherever the view happens to be.
    let getUserCalls = 0;
    const runRequest = vi.fn(async (req: ApiRequest) => {
      if (req.name === 'Login') return execOk(200);
      getUserCalls += 1;
      return execOk(getUserCalls === 2 ? 500 : 200);
    });
    setup(runRequest);

    fireEvent.change(screen.getByRole('textbox', { name: /Iterations/i }), { target: { value: '2' } });
    clickRun();
    await waitFor(() => expect(statValue('Requests')).toBe('4'));

    // Pin the view to iteration 1, then jump via the 500 chip.
    fireEvent.click(screen.getByRole('button', { name: /Iteration 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /^500\s*×1$/ }));

    await waitFor(() => {
      const failing = screen.getAllByTitle('500 Server Error');
      expect(failing.length).toBeGreaterThan(0);
    });
  });

  it('stops the run when "Stop run if an error occurs" is on', async () => {
    const runRequest = vi.fn(async () => execOk(500));
    setup(runRequest);

    fireEvent.click(screen.getByRole('switch', { name: 'Stop run if an error occurs' }));
    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(runRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps counting correctly across many iterations (the throttled-flush path)', async () => {
    const runRequest = vi.fn(async () => execOk(200));
    setup(runRequest, [login]);

    fireEvent.change(screen.getByRole('textbox', { name: /Iterations/i }), { target: { value: '250' } });
    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('250'), { timeout: 10_000 });
    expect(statValue('Passed')).toBe('250');
    expect(runRequest).toHaveBeenCalledTimes(250);
    expect(screen.getByRole('button', { name: /^200\s*×250$/ })).toBeTruthy();
  });

  it('counts a 2xx with a failing assertion as a failure', async () => {
    const runRequest = vi.fn(async () => execOk(200, 10, [
      { name: 'status is 200', passed: true },
      { name: 'body has id', passed: false, error: 'missing id' },
    ]));
    setup(runRequest, [login]);

    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(statValue('Passed')).toBe('0');
    expect(statValue('Failed')).toBe('1');
    // Two scripted assertions plus the built-in HTTP check, which passed.
    expect(statValue('Assertions')).toBe('2/3');
    // HTTP itself was fine — that is the point of counting it separately.
    expect(statValue('HTTP 2xx')).toContain('1/1');
  });
});

// "Most of the time a 200 is all I need, and writing that test into every
// request is too much hassle" — so the Runner asserts it by default.
describe('RunnerDialog built-in HTTP 2xx check', () => {
  const httpOption = () => screen.getByRole('switch', { name: 'Require HTTP 2xx' });

  it('is on by default and fails a non-2xx with no script written', async () => {
    const runRequest = vi.fn(async () => execOk(404));
    setup(runRequest, [login]);

    expect(httpOption().getAttribute('aria-checked')).toBe('true');
    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(statValue('Failed')).toBe('1');
    // Counted like any assertion, so the run reports it rather than just
    // colouring the status code.
    expect(statValue('Assertions')).toBe('0/1');
    expect(statValue('HTTP 2xx')).toContain('0/1');
  });

  it('treats a redirect as a failure too — only 2xx is success', async () => {
    const runRequest = vi.fn(async () => execOk(302));
    setup(runRequest, [login]);

    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(statValue('Failed')).toBe('1');
    expect(statValue('Assertions')).toBe('0/1');
  });

  it('counts a request that never responded as a failed check', async () => {
    const runRequest = vi.fn(async () => execError('ECONNREFUSED'));
    setup(runRequest, [login]);

    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(statValue('Assertions')).toBe('0/1');
    expect(statValue('HTTP 2xx')).toContain('0/1');
  });

  it('passes a 2xx without inventing a failure', async () => {
    const runRequest = vi.fn(async () => execOk(201));
    setup(runRequest, [login]);

    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(statValue('Passed')).toBe('1');
    expect(statValue('Assertions')).toBe('1/1');
  });

  it('turning it off restores the lenient behaviour (3xx passes, no assertions)', async () => {
    const runRequest = vi.fn(async () => execOk(302));
    setup(runRequest, [login]);

    fireEvent.click(httpOption());
    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(statValue('Passed')).toBe('1');
    expect(statValue('Assertions')).toBe('0/0');
    // The HTTP tile still reports the truth regardless of the option.
    expect(statValue('HTTP 2xx')).toContain('0/1');
  });

  it('still counts HTTP failures per request in the rollup', async () => {
    const runRequest = vi.fn(async (req: ApiRequest) => (req.name === 'Login' ? execOk(200) : execOk(500)));
    setup(runRequest);

    clickRun();
    await waitFor(() => expect(statValue('Requests')).toBe('2'));

    fireEvent.click(screen.getByRole('tab', { name: 'By request' }));
    const table = within(screen.getByRole('table'));
    expect(within(table.getByText('Login').closest('tr')!).getByText('1/1')).toBeTruthy();
    expect(within(table.getByText('Get user').closest('tr')!).getByText('0/1')).toBeTruthy();
  });
});

describe('RunnerDialog data-driven run', () => {
  const csv = 'userId,token\n1,alpha\n2,beta\n3,gamma\n';

  const loadCsv = async () => {
    vi.mocked(pickDataFile).mockResolvedValue({ name: 'users.csv', text: csv });
    fireEvent.click(screen.getByRole('button', { name: /Select CSV or JSON file/ }));
    await screen.findByText('users.csv');
  };

  it('binds one iteration per row and passes each row as variables', async () => {
    const seen: (VarMap | undefined)[] = [];
    const runRequest = vi.fn(async (_req: ApiRequest, dataVars?: VarMap) => {
      seen.push(dataVars);
      return execOk(200);
    });
    setup(runRequest, [getUser]);

    await loadCsv();
    expect(screen.getByText(/3 rows · 2 columns · comma-separated/)).toBeTruthy();

    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('3'));
    expect(seen).toEqual([
      { userId: '1', token: 'alpha' },
      { userId: '2', token: 'beta' },
      { userId: '3', token: 'gamma' },
    ]);
  });

  it('runs only the sampled rows when the row limit is on', async () => {
    const runRequest = vi.fn(async () => execOk(200));
    setup(runRequest, [getUser]);

    await loadCsv();
    fireEvent.click(screen.getByRole('checkbox', { name: /Test with only the first/ }));

    // Default sample is min(10, rows) — here, all three rows; narrow it to one.
    fireEvent.change(screen.getByRole('textbox', { name: 'Rows to run' }), { target: { value: '1' } });
    clickRun();

    await waitFor(() => expect(statValue('Requests')).toBe('1'));
    expect(runRequest).toHaveBeenCalledTimes(1);
  });

  it('exports a CSV whose rows carry the status code and the data that produced them', async () => {
    let call = 0;
    const runRequest = vi.fn(async () => { call += 1; return execOk(call === 2 ? 500 : 200); });
    setup(runRequest, [getUser]);

    await loadCsv();
    clickRun();
    await waitFor(() => expect(statValue('Requests')).toBe('3'));

    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /CSV/ }));

    await waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    const [name, text] = vi.mocked(saveTextFile).mock.calls[0];
    expect(name).toBe('My-collection.run-results.csv');

    const lines = (text as string).split('\n');
    expect(lines[0]).toContain('status,statusText,httpOk,outcome');
    expect(lines[0].endsWith('userId,token')).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('200');
    expect(lines[1].endsWith('1,alpha')).toBe(true);
    expect(lines[2]).toContain('500');
    expect(lines[2]).toContain('fail');
    expect(lines[2].endsWith('2,beta')).toBe(true);
  });
});
