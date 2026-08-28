import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ScriptSandboxUnavailableError, ScriptTimeoutError, __setSandboxWorkerFactory,
  runPhaseSandboxed, stopScriptSandbox,
} from './scriptHost';
import type { PhaseInput, PhaseOutput } from './scriptPhases';
import { newRequest } from './types';

const prePhase = (script: string): PhaseInput => ({
  phase: 'pre',
  draft: newRequest({ url: 'https://api.test/x' }),
  stores: { runtime: {}, collectionVar: {}, collectionEnv: {}, globalEnv: {}, collectionEnvName: null, globalEnvName: null },
  inherited: [],
  vars: [],
  script,
});

// A stand-in for the sandbox worker whose behaviour each test controls.
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor(private behaviour: 'reply' | 'silent' | 'fail' = 'reply') {}

  postMessage(msg: { type: string; id: number; input?: PhaseInput }) {
    this.posted.push(msg);
    if (msg.type !== 'run' || this.behaviour === 'silent') return;
    queueMicrotask(() => {
      if (this.behaviour === 'fail') {
        this.onmessage?.({ data: { type: 'failed', id: msg.id, message: 'clone failed' } } as MessageEvent);
        return;
      }
      const output: PhaseOutput = {
        draft: msg.input!.draft,
        stores: msg.input!.stores,
        tests: [{ name: 'from worker', passed: true }],
        logs: [],
        errors: [],
        control: {},
      };
      this.onmessage?.({ data: { type: 'done', id: msg.id, output } } as MessageEvent);
    });
  }

  terminate() { this.terminated = true; }
}

afterEach(() => {
  __setSandboxWorkerFactory(null);
  stopScriptSandbox();
  vi.useRealTimers();
});

describe('runPhaseSandboxed — no sandbox means no execution', () => {
  // The point of these three: a collection script must never execute on the
  // main thread, where it would reach window, app storage and the Tauri IPC
  // bridge. Refusing the phase is the correct outcome, not a fallback.

  it('refuses to run when no worker is available', async () => {
    // jsdom provides no Worker, and no factory is installed.
    await expect(runPhaseSandboxed(prePhase('bru.setVar("x", "1");')))
      .rejects.toBeInstanceOf(ScriptSandboxUnavailableError);
  });

  it('refuses to run when the worker fails to construct', async () => {
    __setSandboxWorkerFactory(() => { throw new Error('no workers here'); });
    await expect(runPhaseSandboxed(prePhase('bru.setVar("y", "2");')))
      .rejects.toBeInstanceOf(ScriptSandboxUnavailableError);
  });

  it('does not evaluate the script it refuses', async () => {
    // A script with a visible side effect: if the refusal ever regressed into a
    // main-thread fallback, this global would be set.
    const g = globalThis as Record<string, unknown>;
    delete g.__sandboxEscape;
    __setSandboxWorkerFactory(() => { throw new Error('no workers here'); });
    await expect(runPhaseSandboxed(prePhase('globalThis.__sandboxEscape = true;')))
      .rejects.toBeInstanceOf(ScriptSandboxUnavailableError);
    expect(g.__sandboxEscape).toBeUndefined();
  });

  it('keeps refusing within the reprobe window, then retries construction once it elapses', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    __setSandboxWorkerFactory(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return new FakeWorker('reply') as unknown as Worker;
    });

    await expect(runPhaseSandboxed(prePhase('// a'))).rejects.toThrow();
    expect(attempts).toBe(1);

    // Still inside the 30s reprobe window: no retry, still refusing.
    await expect(runPhaseSandboxed(prePhase('// b'))).rejects.toThrow();
    expect(attempts).toBe(1);

    vi.advanceTimersByTime(30_001);

    // Sandbox is back, so scripts run again.
    const out = await runPhaseSandboxed(prePhase('// c'));
    expect(attempts).toBe(2);
    expect(out.tests).toEqual([{ name: 'from worker', passed: true }]);
  });
});

describe('runPhaseSandboxed — worker path', () => {
  it('resolves with the worker output', async () => {
    const fake = new FakeWorker('reply');
    __setSandboxWorkerFactory(() => fake as unknown as Worker);

    const out = await runPhaseSandboxed(prePhase('// noop'));
    expect(out.tests).toEqual([{ name: 'from worker', passed: true }]);
    expect((fake.posted[0] as { type: string }).type).toBe('run');
  });

  it('reuses one worker across calls', async () => {
    const fake = new FakeWorker('reply');
    const factory = vi.fn(() => fake as unknown as Worker);
    __setSandboxWorkerFactory(factory);

    await runPhaseSandboxed(prePhase('// a'));
    await runPhaseSandboxed(prePhase('// b'));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.posted).toHaveLength(2);
  });

  it('surfaces a structural worker failure', async () => {
    __setSandboxWorkerFactory(() => new FakeWorker('fail') as unknown as Worker);
    await expect(runPhaseSandboxed(prePhase('// x'))).rejects.toThrow('clone failed');
  });

  it('forwards an abort to the worker', async () => {
    const fake = new FakeWorker('silent');
    __setSandboxWorkerFactory(() => fake as unknown as Worker);
    const ctl = new AbortController();

    const pending = runPhaseSandboxed(prePhase('// x'), 50, ctl.signal);
    ctl.abort();
    expect(fake.posted.some((m) => (m as { type: string }).type === 'abort')).toBe(true);

    // The run itself still ends via the timeout; swallow it.
    await expect(pending).rejects.toBeInstanceOf(ScriptTimeoutError);
  });
});

describe('runPhaseSandboxed — timeout', () => {
  it('rejects with ScriptTimeoutError and kills the worker', async () => {
    const fake = new FakeWorker('silent');
    __setSandboxWorkerFactory(() => fake as unknown as Worker);

    await expect(runPhaseSandboxed(prePhase('while (true) {}'), 20))
      .rejects.toBeInstanceOf(ScriptTimeoutError);
    // The runaway script is still spinning inside it, so it has to be replaced.
    expect(fake.terminated).toBe(true);
  });

  it('reports the configured limit in the message', async () => {
    __setSandboxWorkerFactory(() => new FakeWorker('silent') as unknown as Worker);
    await expect(runPhaseSandboxed(prePhase('while (true) {}'), 25))
      .rejects.toThrow(/timed out after 25 ms/);
  });

  it('starts a fresh worker for the next call after a timeout', async () => {
    const workers: FakeWorker[] = [];
    __setSandboxWorkerFactory(() => {
      const w = new FakeWorker(workers.length === 0 ? 'silent' : 'reply');
      workers.push(w);
      return w as unknown as Worker;
    });

    await expect(runPhaseSandboxed(prePhase('while (true) {}'), 20)).rejects.toBeInstanceOf(ScriptTimeoutError);
    const out = await runPhaseSandboxed(prePhase('// fine'), 500);
    expect(out.tests).toEqual([{ name: 'from worker', passed: true }]);
    expect(workers).toHaveLength(2);
  });
});
