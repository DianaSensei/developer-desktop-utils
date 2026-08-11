// Sandbox worker for API Client user scripts.
//
// Running scripts here rather than on the main thread means a script that never
// returns — `while (true) {}`, a runaway loop — can be killed by terminating the
// worker. On the main thread there is no way to interrupt synchronous JavaScript,
// so such a script froze the entire app until it was force-quit.
//
// As a side effect scripts no longer reach `window`, `document`, or the app's
// storage: they get the same `bru`/`req`/`res`/`pm` surface as before, plus the
// bundled `require()` modules, and nothing else.

import { runPhase, type PhaseInput, type PhaseOutput } from './scriptPhases';

interface RunMessage { type: 'run'; id: number; input: PhaseInput }
interface AbortMessage { type: 'abort'; id: number }
type InMessage = RunMessage | AbortMessage;

export interface WorkerDone { type: 'done'; id: number; output: PhaseOutput }
export interface WorkerFailed { type: 'failed'; id: number; message: string }
export type OutMessage = WorkerDone | WorkerFailed;

// One controller per in-flight run, so `bru.sleep()` and other abort-aware
// helpers stop promptly when the user cancels the send.
const inFlight = new Map<number, AbortController>();

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;

  if (msg.type === 'abort') {
    inFlight.get(msg.id)?.abort();
    return;
  }

  const controller = new AbortController();
  inFlight.set(msg.id, controller);
  try {
    const output = await runPhase(msg.input, controller.signal);
    const done: WorkerDone = { type: 'done', id: msg.id, output };
    (self as unknown as Worker).postMessage(done);
  } catch (e) {
    // runPhase catches script errors itself, so reaching here means something
    // structural went wrong (e.g. a value that could not be cloned back).
    const failed: WorkerFailed = {
      type: 'failed',
      id: msg.id,
      message: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage(failed);
  } finally {
    inFlight.delete(msg.id);
  }
};
