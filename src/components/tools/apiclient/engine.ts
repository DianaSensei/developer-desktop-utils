// Execution pipeline that ties scripting to the HTTP send, Bruno-style:
//
//   prepareRequest: pre-request vars  →  pre-request script
//   →  build & SEND (or build a code snippet, see codegen.ts)  →
//   post-response vars  →  post-response script  →  tests script  →  assertions
//
// Variable precedence for {{substitution}}: Collection Variables first, then
// the Global environment, then the Collection environment (each can override
// the one before it), then a data-file row wins over all of them. Scripts may
// mutate the request draft and any of the three persisted variable stores;
// the caller persists the resulting collection-var/collection-env/global-env
// changes.

import type { ApiRequest, ApiResponse, Auth, Environment, KeyValue, LogEntry, TestResult, VarMap } from './types';
import { newRequest } from './types';
import { sendRequest } from './request';
import type { Cookie } from './cookies';
import type { PhaseStores } from './scriptPhases';
import { DEFAULT_SCRIPT_TIMEOUT_MS, ScriptTimeoutError, runPhaseSandboxed } from './scriptHost';

export interface ExecResult {
  response: ApiResponse | null;
  tests: TestResult[];
  logs: LogEntry[];
  error: string | null;        // transport/script error
  collectionVars: VarMap;      // updated Collection Variables (to persist)
  collectionVarsChanged: boolean;
  collectionEnvVars: VarMap;   // updated Collection environment vars (to persist)
  collectionEnvChanged: boolean;
  globalEnvVars: VarMap;       // updated Global environment vars (to persist)
  globalEnvChanged: boolean;
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

// What every send and every generated snippet are built from: the request
// with 'inherit' auth resolved and the pre-request scripts applied, plus the
// {{}} substitution map as it stands after them. Send (`executeRequest`) and
// Generate Code both start here, so a snippet is the request Send transmits.
export interface PreparedRequest {
  request: ApiRequest;
  vars: VarMap;
  // Collection/folder headers that apply ahead of the request's own.
  inheritedHeaders: KeyValue[][];
  stores: PhaseStores;
  tests: TestResult[];
  logs: LogEntry[];
  // Script failures so far; a non-empty list means Send must not go out.
  errors: string[];
  nextRequest?: string | null;
}

// Combined substitution map. Precedence: vault < collection var < global env
// < collection env < data-file row — a Collection Variable is a shared
// default either environment can still override, the Collection
// environment (scoped, specific) wins over the Global one (cross-collection,
// general) on a name collision, and a data file overrides both — matching
// Postman's variable resolution order. Vault secrets are namespaced
// (`vault.<key>`) and merged only here — they never enter the script-visible
// stores, so scripts can't read or persist them.
const mergeVars = (vault: VarMap, stores: PhaseStores, dataVars: VarMap): VarMap => (
  { ...vault, ...stores.collectionVar, ...stores.globalEnv, ...stores.collectionEnv, ...dataVars }
);

// Most requests have no scripts, vars, or assertions at all. Skipping the
// phase for those avoids both loading the sandbox worker bundle and paying a
// structured clone of the request/response on every single send.
const hasWork = (...parts: (string | unknown[])[]) =>
  parts.some((p) => (typeof p === 'string' ? p.trim() !== '' : p.length > 0));

// Run one script phase and fold it back into `state`. A phase that overran its
// timeout comes back as a single error and no results — the worker carrying
// them had to be terminated to stop the runaway script.
async function runPhaseInto(
  state: PreparedRequest,
  input: Parameters<typeof runPhaseSandboxed>[0],
  label: string,
  scriptTimeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const out = await runPhaseSandboxed(input, scriptTimeoutMs, signal);
    state.request = out.draft;
    state.stores = out.stores;
    state.tests.push(...out.tests);
    state.logs.push(...out.logs);
    state.errors.push(...out.errors);
    // A later phase's request wins, matching Postman: the last call to
    // setNextRequest during a request is the one that takes effect.
    if ('nextRequest' in out.control) state.nextRequest = out.control.nextRequest;
    return true;
  } catch (e) {
    state.errors.push(e instanceof ScriptTimeoutError ? `${label}: ${e.message}` : `${label}: ${errToString(e)}`);
    return false;
  }
}

// Steps 1–2 of the pipeline: resolve 'inherit' auth, run the inherited
// (collection → folders) and then the request's own pre-request script, and
// merge the variables. Scripts run in the same sandbox as for a send and have
// no network access, so preparing without sending (Generate Code) is safe;
// the caller decides whether the script-set variables are persisted.
export async function prepareRequest(
  request: ApiRequest,
  collectionEnv: Environment | null,
  globalEnv: Environment | null,
  signal?: AbortSignal,
  inherited: InheritedScripts = { pre: [], post: [] },
  dataVars: VarMap = {},
  scriptTimeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  vault: VarMap = {},
  collectionVarsIn: VarMap = {},
): Promise<PreparedRequest> {
  // Work on copies so a failed run never mutates stored state.
  const draft = newRequest({ ...request });
  if (draft.auth.type === 'inherit') draft.auth = inherited.auth ?? { ...draft.auth, type: 'none' };
  const state: PreparedRequest = {
    request: draft,
    vars: {},
    inheritedHeaders: inherited.headers ?? [],
    stores: {
      collectionVar: { ...collectionVarsIn },
      collectionEnv: envToMap(collectionEnv),
      globalEnv: envToMap(globalEnv),
      collectionEnvName: collectionEnv?.name ?? null,
      globalEnvName: globalEnv?.name ?? null,
      data: dataVars,
    },
    tests: [],
    logs: [],
    errors: [],
  };
  if (hasWork(request.script.req, inherited.pre)) {
    await runPhaseInto(state, {
      phase: 'pre',
      draft: state.request,
      stores: state.stores,
      inherited: inherited.pre,
      script: request.script.req,
    }, 'Pre-request script', scriptTimeoutMs, signal);
  }
  state.vars = mergeVars(vault, state.stores, dataVars);
  return state;
}

export async function executeRequest(
  request: ApiRequest,
  collectionEnv: Environment | null,
  globalEnv: Environment | null,
  signal?: AbortSignal,
  inherited: InheritedScripts = { pre: [], post: [] },
  cookieJar: Cookie[] = [],
  dataVars: VarMap = {},
  scriptTimeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  vault: VarMap = {},
  collectionVarsIn: VarMap = {},
): Promise<ExecResult> {
  const collectionVarBefore = JSON.stringify(collectionVarsIn);
  const collectionEnvBefore = JSON.stringify(envToMap(collectionEnv));
  const globalEnvBefore = JSON.stringify(envToMap(globalEnv));

  // 1–2. resolve auth, run the pre-request scripts. Any failure cancels the send.
  const state = await prepareRequest(
    request, collectionEnv, globalEnv, signal, inherited, dataVars, scriptTimeoutMs, vault, collectionVarsIn,
  );

  const finish = (response: ApiResponse | null): ExecResult => ({
    response,
    tests: state.tests,
    logs: state.logs,
    error: state.errors.length ? state.errors.join('\n') : null,
    collectionVars: state.stores.collectionVar,
    collectionVarsChanged: JSON.stringify(state.stores.collectionVar) !== collectionVarBefore,
    collectionEnvVars: state.stores.collectionEnv,
    collectionEnvChanged: JSON.stringify(state.stores.collectionEnv) !== collectionEnvBefore,
    globalEnvVars: state.stores.globalEnv,
    globalEnvChanged: JSON.stringify(state.stores.globalEnv) !== globalEnvBefore,
    nextRequest: state.nextRequest,
  });

  if (state.errors.length) return finish(null);

  // 3. build & send
  let response: ApiResponse;
  try {
    response = await sendRequest(state.request, state.vars, signal, cookieJar, state.inheritedHeaders);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    state.errors.push(errToString(e));
    return finish(null);
  }

  // 4–6. post-response script (request, then inherited inner→outer), tests,
  //      then assertions. A failing script here does not stop the rest: the
  //      tests are usually the reason the request was sent.
  if (hasWork(request.script.res, request.tests, request.assertions, inherited.post)) {
    await runPhaseInto(state, {
      phase: 'post',
      draft: state.request,
      stores: state.stores,
      // Binary bodies are kept as base64 for the viewer, but scripts only ever
      // read the decoded `body`. Cloning a multi-megabyte base64 string into the
      // worker on every send would cost far more than running the script does.
      response: response.bodyBase64 ? { ...response, bodyBase64: undefined } : response,
      inherited: inherited.post,
      script: request.script.res,
      tests: request.tests,
      assertions: request.assertions,
    }, 'Post-response script', scriptTimeoutMs, signal);
  }

  return finish(response);
}
