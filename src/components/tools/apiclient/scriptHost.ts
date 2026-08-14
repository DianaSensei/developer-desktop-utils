// Runs a scripting phase in the sandbox worker, with a wall-clock timeout.
//
// The worker is created lazily and reused across requests (spinning one up per
// send would add tens of milliseconds to every call). It is terminated and
// replaced only when a script overruns its timeout — that termination is the
// whole point, since a synchronous infinite loop cannot be interrupted any
// other way.
//
// If Workers are unavailable, or the worker fails to start, execution falls back
// to the main thread: scripts keep working exactly as before, just without the
// timeout guarantee.

import { runPhase, type PhaseInput, type PhaseOutput } from './scriptPhases';
import type { OutMessage } from './scriptSandbox.worker';

export const DEFAULT_SCRIPT_TIMEOUT_MS = 5000;
// A worker that fails to load once is very likely a transient bundling/CSP
// hiccup, not a permanent platform limitation — give it another chance after
// this long instead of running every script unsandboxed for the rest of the
// session.
const REPROBE_INTERVAL_MS = 30_000;

interface Pending {
  resolve: (out: PhaseOutput) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
// Null until we've tried; false once we know workers aren't usable here (see
// REPROBE_INTERVAL_MS above — "false" is re-checked periodically, not final).
let workerUsable: boolean | null = null;
let unusableAt: number | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

type WorkerFactory = () => Worker;
let workerFactory: WorkerFactory | null = null;

type SandboxStatusListener = (degraded: boolean) => void;
const statusListeners = new Set<SandboxStatusListener>();

/** True while scripts are running unsandboxed on the main thread (no timeout/interrupt). */
export function isScriptSandboxDegraded(): boolean {
  return workerUsable === false;
}

/** Notified whenever the sandbox flips between usable and degraded. */
export function subscribeSandboxStatus(listener: SandboxStatusListener): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

function markUsable() {
  const wasDegraded = workerUsable === false;
  workerUsable = true;
  unusableAt = null;
  if (wasDegraded) for (const l of statusListeners) l(false);
}

function markUnusable() {
  const wasUsable = workerUsable !== false;
  workerUsable = false;
  unusableAt = Date.now();
  if (wasUsable) for (const l of statusListeners) l(true);
}

/**
 * Test seam: substitute the sandbox worker so the timeout/abort plumbing can be
 * exercised without a real one (jsdom has no Worker). Pass null to restore the
 * default and reset the cached availability probe.
 */
export function __setSandboxWorkerFactory(factory: WorkerFactory | null): void {
  disposeWorker();
  workerFactory = factory;
  workerUsable = null;
  unusableAt = null;
}

function disposeWorker() {
  worker?.terminate();
  worker = null;
  // Anything still waiting can never be answered by the terminated worker.
  for (const p of pending.values()) p.reject(new Error('Script sandbox stopped'));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUsable === false) {
    // Keep falling back immediately until the reprobe window elapses, so one
    // bad load doesn't retry-storm on every single script run.
    if (unusableAt !== null && Date.now() - unusableAt < REPROBE_INTERVAL_MS) return null;
  }
  if (!workerFactory && typeof Worker === 'undefined') {
    markUnusable();
    return null;
  }
  try {
    const w = workerFactory
      ? workerFactory()
      : new Worker(new URL('./scriptSandbox.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<OutMessage>) => {
      const msg = event.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'done') p.resolve(msg.output);
      else p.reject(new Error(msg.message));
    };
    w.onerror = () => {
      // A load/parse failure in the worker bundle: fall back until the next
      // reprobe window instead of failing every request from here on.
      markUnusable();
      disposeWorker();
    };
    worker = w;
    markUsable();
    return w;
  } catch {
    markUnusable();
    return null;
  }
}

// Terminate the sandbox (used on tool unmount so a stuck script can't keep a
// core busy after the user has navigated away).
export function stopScriptSandbox(): void {
  if (worker) disposeWorker();
}

export async function runPhaseSandboxed(
  input: PhaseInput,
  timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<PhaseOutput> {
  const w = getWorker();
  if (!w) return runPhase(input, signal);

  const id = nextId++;
  const forwardAbort = () => w.postMessage({ type: 'abort', id });
  signal?.addEventListener('abort', forwardAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<PhaseOutput>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          pending.delete(id);
          // The script is still spinning inside the worker, so the worker has to
          // go; the next request gets a fresh one.
          disposeWorker();
          reject(new ScriptTimeoutError(timeoutMs));
        }, timeoutMs);
      }
      w.postMessage({ type: 'run', id, input });
    });
  } finally {
    if (timer) clearTimeout(timer);
    pending.delete(id);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export class ScriptTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Script timed out after ${timeoutMs} ms — check for an unterminated loop.`);
    this.name = 'ScriptTimeoutError';
  }
}
