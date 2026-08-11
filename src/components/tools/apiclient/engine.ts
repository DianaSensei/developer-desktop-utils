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
    signal,
  };
  const out: ScriptRun = { logs: [], tests: [], error: null };

  const envBefore = JSON.stringify(stores.env);

  // Combined substitution map. Precedence: env < data-file row < runtime
  // (bru.setVar / local), so a data file overrides the environment but explicit
  // runtime sets still win — matching Postman's variable resolution order.
  const varMap = (): VarMap => ({ ...stores.env, ...dataVars, ...stores.runtime });

  // Errors are collected per script and tagged with which one failed —
  // "Post-response script error" alone doesn't say whether the fault was in the
  // request's own script, an inherited folder script, or the tests.
  const errors: string[] = [];
  const runLabeled = async (label: string, code: string, scope: Record<string, unknown>) => {
    out.error = null;
    await runScript(code, scope, out);
    if (out.error) {
      errors.push(`${label}: ${out.error}`);
      out.error = null;
      return false;
    }
    return true;
  };
  const joined = () => (errors.length ? errors.join('\n') : null);

  // 1. inherited pre-request scripts (collection → folders), then request's own
  for (let i = 0; i < inherited.pre.length; i++) {
    const label = inherited.pre.length > 1 ? `Inherited pre-request script #${i + 1}` : 'Inherited pre-request script';
    if (!await runLabeled(label, inherited.pre[i], { bru: makeBru(stores), req: makeReq(draft) })) {
      return finish(null, out, stores, envBefore, joined());
    }
  }

  // 2. pre-request vars + script
  applyVars(request.vars.req, stores, { bru: makeBru(stores) });
  if (!await runLabeled('Pre-request script', request.script.req, { bru: makeBru(stores), req: makeReq(draft) })) {
    return finish(null, out, stores, envBefore, joined());
  }

  // 3. build & send
  let response: ApiResponse;
  try {
    response = await sendRequest(draft, varMap(), signal, cookieJar);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    errors.push(errToString(e));
    return finish(null, out, stores, envBefore, joined());
  }

  // 4–6. post-response vars + script (request, then inherited inner→outer),
  //       tests, then assertions.
  // A failing script here does not stop the rest: the tests and assertions are
  // usually the reason the request was sent, so they still run and report.
  const res = makeRes(response);
  const bru = makeBru(stores);
  applyVars(request.vars.res, stores, { res, bru });
  await runLabeled('Post-response script', request.script.res, { bru, req: makeReq(draft), res });
  for (let i = 0; i < inherited.post.length; i++) {
    const label = inherited.post.length > 1 ? `Inherited post-response script #${i + 1}` : 'Inherited post-response script';
    await runLabeled(label, inherited.post[i], { bru, req: makeReq(draft), res });
  }
  await runLabeled('Test script', request.tests, { bru, req: makeReq(draft), res });
  out.tests.push(...evalAssertions(request.assertions, { res, bru }));

  return finish(response, out, stores, envBefore, joined());
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
