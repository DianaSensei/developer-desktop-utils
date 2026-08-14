// Autocomplete for the bru/pm/req/res/assert/console scripting API — the
// sandbox `runScript` (runtime.ts) actually binds into pre-request,
// post-response, and test scripts. Without this, the editor only offers JS
// keywords and locally-declared names; typing `bru.` or `pm.response.to.have.`
// gives nothing, unlike Postman/Bruno's own script editors.
//
// Built on `scopeCompletionSource` from @codemirror/lang-javascript rather
// than a hand-rolled completion function: it already does exactly what's
// needed — walk a dotted member-expression path (`pm.response.to.have.`)
// against a real object and enumerate its properties — so this file only has
// to describe the API *shape*. The values are never called; only their
// names and `typeof` (function vs. property, for the icon) matter.
//
// Kept in sync with runtime.ts by hand — there's no practical way to derive
// this statically from the real `makeBru`/`makeReq`/`makeRes`/`makePm`
// factories, since their shape depends on closures built at call time.

import { javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import { lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { syntaxErrorLinter } from '@/design-system';

const noop = () => {};

// No prototype, so `scopeCompletionSource`'s own walk up the prototype chain
// (meant for real globals like `globalThis`) doesn't surface Object.prototype
// noise (hasOwnProperty, toString, …) alongside the real API members.
const ns = <T extends object>(shape: T): T => Object.assign(Object.create(null), shape);

const varBag = () => ns({ get: noop, set: noop, has: noop, unset: noop });

const reqShape = ns({
  url: '', method: '',
  getName: noop, getUrl: noop, setUrl: noop, getMethod: noop, setMethod: noop,
  getHeaders: noop, getHeader: noop, setHeader: noop, deleteHeader: noop,
  getParams: noop, getParam: noop, setParam: noop, deleteParam: noop,
  getTimeout: noop, setTimeout: noop, setMaxRedirects: noop, disableRedirects: noop,
  getBody: noop, setBody: noop,
});

const resShape = ns({
  status: 0, statusText: '', headers: ns({}), body: null, responseTime: 0,
  getStatus: noop, getStatusText: noop, getHeader: noop, getHeaders: noop,
  getBody: noop, setBody: noop, getResponseTime: noop, getSize: noop,
  getContentType: noop, getUrl: noop, isOk: noop,
});

const bruShape = ns({
  getVar: noop, setVar: noop, deleteVar: noop, hasVar: noop,
  getEnvVar: noop, setEnvVar: noop, hasEnvVar: noop, deleteEnvVar: noop, getEnvName: noop,
  getIterationData: noop, interpolate: noop, getVars: noop,
  setNextRequest: noop, sleep: noop,
});

// `pm.*` — Postman-compatibility shim (makePm in runtime.ts). Nested plain
// objects all the way down, so `scopeCompletionSource` can walk into
// `pm.response.to.have.` etc; only the fluent `expect(x).to.be.true` chain
// is out of reach (it resolves through a function call, which the path
// walker deliberately doesn't follow — there's no way to know what `x` is).
const pmShape = ns({
  test: noop, expect: noop,
  info: ns({ requestName: '', requestId: '' }),
  environment: ns({ ...varBag(), name: '' }),
  variables: ns({ ...varBag(), replaceIn: noop }),
  collectionVariables: ns({ ...varBag(), replaceIn: noop }),
  globals: ns({ ...varBag(), replaceIn: noop }),
  iterationData: ns({ get: noop }),
  request: reqShape,
  execution: ns({ setNextRequest: noop }),
  response: ns({
    code: 0, status: '', responseTime: 0, responseSize: 0,
    json: noop, text: noop, size: noop,
    headers: ns({ get: noop, has: noop }),
    to: ns({
      have: ns({ status: noop, header: noop, body: noop, jsonBody: noop }),
      be: ns({
        ok: null, success: null, redirection: null, clientError: null, serverError: null,
        error: null, accepted: null, badRequest: null, unauthorized: null, forbidden: null, notFound: null,
      }),
    }),
  }),
});

const assertShape = ns({
  ok: noop, isOk: noop, isNotOk: noop, fail: noop,
  equal: noop, notEqual: noop, strictEqual: noop, notStrictEqual: noop,
  deepEqual: noop, notDeepEqual: noop,
  isTrue: noop, isFalse: noop, isNull: noop, isNotNull: noop,
  isUndefined: noop, isDefined: noop, exists: noop,
  isArray: noop, isString: noop, isNumber: noop, isBoolean: noop, isObject: noop, isFunction: noop,
  include: noop, match: noop, lengthOf: noop, typeOf: noop,
});

const consoleShape = ns({
  log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop, dir: noop, table: noop,
});

const scriptScope = ns({
  bru: bruShape,
  req: reqShape,
  res: resShape,
  pm: pmShape,
  expect: noop,
  assert: assertShape,
  test: noop,
  console: consoleShape,
});

// Exposed only for scriptCompletion.test.ts's parity guard, which asserts
// every real method on runtime.ts's makeBru/makeReq/makeRes/makePm/makeAssert/
// makeConsole is present here — so a future runtime.ts change can't silently
// go stale in autocomplete without a failing test flagging it.
export const scriptCompletionShapes = {
  bru: bruShape, req: reqShape, res: resShape, pm: pmShape, assert: assertShape, console: consoleShape,
};

const scriptApiCompletion = javascriptLanguage.data.of({
  autocomplete: scopeCompletionSource(scriptScope),
});

/** Layer onto a `JavaScriptEditor`'s `extraExtensions` for any pre-request,
 *  post-response, or test script surface: the bru/pm/req/res completion
 *  source above, plus a syntax-error lint gutter — safe here (unlike the
 *  Mock Server's Rhai editor) because these scripts really are executed as
 *  JavaScript (`runScript` in runtime.ts). */
export const scriptApiExtensions: Extension[] = [scriptApiCompletion, syntaxErrorLinter(), lintGutter()];
