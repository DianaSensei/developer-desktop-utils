// The two scripting phases of a request, as one pure, serializable unit of work.
//
// Everything here is deliberately free of DOM and network access so the exact
// same function can run either on the main thread or inside the sandbox worker
// (see scriptHost.ts). Input and output are plain structured-cloneable data:
//
//   pre  — inherited pre-request scripts → the request's own pre-request
//          script. Stops at the first failure, because a request built by a
//          script that threw is not worth sending.
//   post — post-response script → inherited post-response scripts → tests →
//          declarative assertions. Keeps going after a failure, since the
//          tests are usually the point of the request.
//
// Scripts mutate `draft` and the variable stores in place; the caller reads the
// returned copies back out.

import {
  evalAssertions, makeBru, makeReq, makeRes, runScript,
  type RunControl, type ScriptRun, type VarStores,
} from './runtime';
import type {
  ApiRequest, ApiResponse, Assertion, LogEntry, TestResult, VarMap,
} from './types';

export interface PhaseStores {
  collectionVar: VarMap;
  collectionEnv: VarMap;
  globalEnv: VarMap;
  collectionEnvName: string | null;
  globalEnvName: string | null;
  data?: VarMap;
}

export interface PrePhaseInput {
  phase: 'pre';
  draft: ApiRequest;
  stores: PhaseStores;
  inherited: string[];
  script: string;
}

export interface PostPhaseInput {
  phase: 'post';
  draft: ApiRequest;
  stores: PhaseStores;
  response: ApiResponse;
  inherited: string[];
  script: string;
  tests: string;
  assertions: Assertion[];
}

export type PhaseInput = PrePhaseInput | PostPhaseInput;

export interface PhaseOutput {
  draft: ApiRequest;
  stores: PhaseStores;
  tests: TestResult[];
  logs: LogEntry[];
  // One entry per failing script, already labelled with which script it was.
  errors: string[];
  // Runner flow control requested by a script, if any (see RunControl).
  control: RunControl;
}

export async function runPhase(input: PhaseInput, signal?: AbortSignal): Promise<PhaseOutput> {
  const draft = input.draft;
  const control: RunControl = {};
  const stores: VarStores = { ...input.stores, control, signal };
  const out: ScriptRun = { logs: [], tests: [], error: null };
  const errors: string[] = [];

  // Runs one script and, if it failed, records the failure against its label.
  // `out.error` is reset each time so a later success can't mask an earlier
  // failure and a later failure can't inherit an earlier label.
  const run = async (label: string, code: string, scope: Record<string, unknown>) => {
    out.error = null;
    await runScript(code, scope, out);
    if (!out.error) return true;
    errors.push(`${label}: ${out.error}`);
    out.error = null;
    return false;
  };

  const result = (): PhaseOutput => ({
    draft,
    stores: {
      collectionVar: stores.collectionVar,
      collectionEnv: stores.collectionEnv,
      globalEnv: stores.globalEnv,
      collectionEnvName: stores.collectionEnvName,
      globalEnvName: stores.globalEnvName,
      data: stores.data,
    },
    tests: out.tests,
    logs: out.logs,
    errors,
    control,
  });

  const label = (base: string, i: number, total: number) => (total > 1 ? `${base} #${i + 1}` : base);

  if (input.phase === 'pre') {
    for (let i = 0; i < input.inherited.length; i++) {
      const ok = await run(
        label('Inherited pre-request script', i, input.inherited.length),
        input.inherited[i],
        { bru: makeBru(stores), req: makeReq(draft) },
      );
      if (!ok) return result();
    }
    await run('Pre-request script', input.script, { bru: makeBru(stores), req: makeReq(draft) });
    return result();
  }

  const res = makeRes(input.response);
  const bru = makeBru(stores);
  await run('Post-response script', input.script, { bru, req: makeReq(draft), res });
  for (let i = 0; i < input.inherited.length; i++) {
    await run(
      label('Inherited post-response script', i, input.inherited.length),
      input.inherited[i],
      { bru, req: makeReq(draft), res },
    );
  }
  await run('Test script', input.tests, { bru, req: makeReq(draft), res });
  out.tests.push(...evalAssertions(input.assertions, { res, bru }));
  return result();
}
