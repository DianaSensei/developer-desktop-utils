// Execution pipeline that ties scripting to the HTTP send, Bruno-style:
//
//   pre-request vars  →  pre-request script  →  build & SEND  →
//   post-response vars  →  post-response script  →  tests script  →  assertions
//
// Variable precedence for {{substitution}}: environment vars first, then runtime
// vars (bru.setVar) override them. Scripts may mutate the request draft and both
// variable stores; the caller persists the resulting env/runtime changes.

import type { ApiRequest, ApiResponse, Auth, Environment, KeyValue, LogEntry, TestResult, VarMap } from './types';
import { newRequest } from './types';
import { sendRequest } from './request';
import type { Cookie } from './cookies';
import type { PhaseOutput, PhaseStores } from './scriptPhases';
import { DEFAULT_SCRIPT_TIMEOUT_MS, ScriptTimeoutError, runPhaseSandboxed } from './scriptHost';

export interface ExecResult {
  response: ApiResponse | null;
  tests: TestResult[];
  logs: LogEntry[];
  error: string | null;        // transport/script error
  runtimeVars: VarMap;         // updated runtime vars
  envVars: VarMap;             // updated environment vars (to persist)
  envChanged: boolean;
  // Flow control from setNextRequest: a request name to jump to, null to end
  // the iteration, or undefined when no script asked for anything. Only the
  // Runner acts on it — a single Send has no sequence to steer.
  nextRequest?: string | null;
}

// Tauri rejects commands with a plain string (not an Error), so reading
// `e.message` loses the real cause. Normalize any thrown value to readable text
// so transport failures (scope denials, connection refused, …) are visible.
export function errToString(e: unknown): string {
  if (e == null) return 'Request failed';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

function envToMap(env: Environment | null): VarMap {
  const map: VarMap = {};
  if (env) for (const v of env.variables) if (v.enabled && v.key) map[v.key] = v.value;
  return map;
}

export interface InheritedScripts { pre: string[]; post: string[]; auth?: Auth | null; headers?: KeyValue[][] }

export async function executeRequest(
  request: ApiRequest,
  env: Environment | null,
  runtimeVarsIn: VarMap,
  signal?: AbortSignal,
  inherited: InheritedScripts = { pre: [], post: [] },
  cookieJar: Cookie[] = [],
  dataVars: VarMap = {},
  scriptTimeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  vault: VarMap = {},
  collectionVars: VarMap = {},
): Promise<ExecResult> {
  // Work on copies so a failed run never mutates stored state.
  let draft = newRequest({ ...request });
  // Resolve 'inherit' auth from the collection/folder chain.
  if (draft.auth.type === 'inherit') draft.auth = inherited.auth ?? { ...draft.auth, type: 'none' };
  let stores: PhaseStores = {
    runtime: { ...runtimeVarsIn },
    env: envToMap(env),
    envName: env?.name ?? null,
    data: dataVars,
  };

  const envBefore = JSON.stringify(stores.env);
  const tests: TestResult[] = [];
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  // Combined substitution map. Precedence: vault < collection < env < data-file
  // row < runtime (bru.setVar / local) — a collection variable is a shared
  // default that the environment (and everything after it) can still override,
  // and a data file overrides the environment but explicit runtime sets still
  // win — matching Postman's variable resolution order. Vault secrets are
  // namespaced (`vault.<key>`) and merged only here, at send time — they never
  // enter `stores.env`, so scripts can't read or persist them.
  const varMap = (): VarMap => (
    { ...vault, ...collectionVars, ...stores.env, ...dataVars, ...stores.runtime }
  );

  // Fold a completed phase back into the local state. A phase that overran its
  // timeout comes back as a single error and no results — the worker carrying
  // them had to be terminated to stop the runaway script.
  let nextRequest: string | null | undefined;
  const absorb = (out: PhaseOutput) => {
    draft = out.draft;
    stores = out.stores;
    tests.push(...out.tests);
    logs.push(...out.logs);
    errors.push(...out.errors);
    // A later phase's request wins, matching Postman: the last call to
    // setNextRequest during a request is the one that takes effect.
    if ('nextRequest' in out.control) nextRequest = out.control.nextRequest;
  };

  const runPhaseSafely = async (input: Parameters<typeof runPhaseSandboxed>[0], label: string) => {
    try {
      absorb(await runPhaseSandboxed(input, scriptTimeoutMs, signal));
      return true;
    } catch (e) {
      errors.push(e instanceof ScriptTimeoutError ? `${label}: ${e.message}` : `${label}: ${errToString(e)}`);
      return false;
    }
  };

  // Most requests have no scripts, vars, or assertions at all. Skipping the
  // phase for those avoids both loading the sandbox worker bundle and paying a
  // structured clone of the request/response on every single send.
  const hasWork = (...parts: (string | unknown[])[]) =>
    parts.some((p) => (typeof p === 'string' ? p.trim() !== '' : p.length > 0));

  const finish = (response: ApiResponse | null): ExecResult => ({
    response,
    tests,
    logs,
    error: errors.length ? errors.join('\n') : null,
    runtimeVars: stores.runtime,
    envVars: stores.env,
    envChanged: JSON.stringify(stores.env) !== envBefore,
    nextRequest,
  });

  // 1–2. inherited pre-request scripts (collection → folders), the request's
  //      own vars, then its pre-request script. Any failure cancels the send.
  if (hasWork(request.script.req, request.vars.req, inherited.pre)) {
    const preOk = await runPhaseSafely({
      phase: 'pre',
      draft,
      stores,
      inherited: inherited.pre,
      vars: request.vars.req,
      script: request.script.req,
    }, 'Pre-request script');
    if (!preOk || errors.length) return finish(null);
  }

  // 3. build & send
  let response: ApiResponse;
  try {
    response = await sendRequest(draft, varMap(), signal, cookieJar, inherited.headers ?? []);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    errors.push(errToString(e));
    return finish(null);
  }

  // 4–6. post-response vars + script (request, then inherited inner→outer),
  //      tests, then assertions. A failing script here does not stop the rest:
  //      the tests are usually the reason the request was sent.
  if (hasWork(request.script.res, request.tests, request.vars.res, request.assertions, inherited.post)) {
    await runPhaseSafely({
      phase: 'post',
      draft,
      stores,
      // Binary bodies are kept as base64 for the viewer, but scripts only ever
      // read the decoded `body`. Cloning a multi-megabyte base64 string into the
      // worker on every send would cost far more than running the script does.
      response: response.bodyBase64 ? { ...response, bodyBase64: undefined } : response,
      inherited: inherited.post,
      vars: request.vars.res,
      script: request.script.res,
      tests: request.tests,
      assertions: request.assertions,
    }, 'Post-response script');
  }

  return finish(response);
}
