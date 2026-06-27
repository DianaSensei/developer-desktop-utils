// Execution pipeline that ties scripting to the HTTP send, Bruno-style:
//
//   pre-request vars  →  pre-request script  →  build & SEND  →
//   post-response vars  →  post-response script  →  tests script  →  assertions
//
// Variable precedence for {{substitution}}: environment vars first, then runtime
// vars (bru.setVar) override them. Scripts may mutate the request draft and both
// variable stores; the caller persists the resulting env/runtime changes.

import type { ApiRequest, ApiResponse, Auth, Environment, LogEntry, TestResult, VarMap } from './types';
import { newRequest } from './types';
import { sendRequest } from './request';
import type { Cookie } from './cookies';
import {
  type VarStores,
  applyVars, evalAssertions, makeBru, makeReq, makeRes, runScript, type ScriptRun,
} from './runtime';

export interface ExecResult {
  response: ApiResponse | null;
  tests: TestResult[];
  logs: LogEntry[];
  error: string | null;        // transport/script error
  runtimeVars: VarMap;         // updated runtime vars
  envVars: VarMap;             // updated environment vars (to persist)
  envChanged: boolean;
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

export interface InheritedScripts { pre: string[]; post: string[]; auth?: Auth | null }

export async function executeRequest(
  request: ApiRequest,
  env: Environment | null,
  runtimeVarsIn: VarMap,
  signal?: AbortSignal,
  inherited: InheritedScripts = { pre: [], post: [] },
  cookieJar: Cookie[] = [],
  dataVars: VarMap = {},
): Promise<ExecResult> {
  // Work on copies so a failed run never mutates stored state.
  const draft = newRequest({ ...request });
  // Resolve 'inherit' auth from the collection/folder chain.
  if (draft.auth.type === 'inherit') draft.auth = inherited.auth ?? { ...draft.auth, type: 'none' };
  const stores: VarStores = {
    runtime: { ...runtimeVarsIn },
    env: envToMap(env),
    envName: env?.name ?? null,
    data: dataVars,
  };
  const out: ScriptRun = { logs: [], tests: [], error: null };

  const envBefore = JSON.stringify(stores.env);

  // Combined substitution map. Precedence: env < data-file row < runtime
  // (bru.setVar / local), so a data file overrides the environment but explicit
  // runtime sets still win — matching Postman's variable resolution order.
  const varMap = (): VarMap => ({ ...stores.env, ...dataVars, ...stores.runtime });

  // 1. inherited pre-request scripts (collection → folders), then request's own
  for (const code of inherited.pre) {
    await runScript(code, { bru: makeBru(stores), req: makeReq(draft) }, out);
    if (out.error) return finish(null, out, stores, envBefore, `Pre-request script error: ${out.error}`);
  }

  // 2. pre-request vars + script
  applyVars(request.vars.req, stores, { bru: makeBru(stores) });
  await runScript(request.script.req, { bru: makeBru(stores), req: makeReq(draft) }, out);
  if (out.error) {
    return finish(null, out, stores, envBefore, `Pre-request script error: ${out.error}`);
  }

  // 3. build & send
  let response: ApiResponse;
  try {
    response = await sendRequest(draft, varMap(), signal, cookieJar);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return finish(null, out, stores, envBefore, errToString(e));
  }

  // 4–6. post-response vars + script (request, then inherited inner→outer),
  //       tests, then assertions
  const res = makeRes(response);
  const bru = makeBru(stores);
  applyVars(request.vars.res, stores, { res, bru });
  await runScript(request.script.res, { bru, req: makeReq(draft), res }, out);
  for (const code of inherited.post) {
    await runScript(code, { bru, req: makeReq(draft), res }, out);
  }
  await runScript(request.tests, { bru, req: makeReq(draft), res }, out);
  out.tests.push(...evalAssertions(request.assertions, { res, bru }));

  return finish(response, out, stores, envBefore, out.error ? `Post-response script error: ${out.error}` : null);
}

function finish(
  response: ApiResponse | null,
  out: ScriptRun,
  stores: VarStores,
  envBefore: string,
  error: string | null,
): ExecResult {
  return {
    response,
    tests: out.tests,
    logs: out.logs,
    error,
    runtimeVars: stores.runtime,
    envVars: stores.env,
    envChanged: JSON.stringify(stores.env) !== envBefore,
  };
}
