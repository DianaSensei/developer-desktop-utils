// Static one-click snippets for the script editors — Postman/Bruno both ship
// a "add test" style snippet menu; this editor had none. Purely an authoring
// aid: no new engine capability, just template text against the real bru/req/
// res API these scripts already run with (see runtime.ts).

export interface ScriptSnippet {
  label: string;
  code: string;
}

export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'Set a header',
    code: `req.setHeader('X-Trace-Id', Date.now().toString());`,
  },
  {
    label: 'Read an environment variable',
    code: `const token = bru.getEnvVar('token');`,
  },
];

export const POST_RESPONSE_SNIPPETS: ScriptSnippet[] = [
  {
    label: 'Assert status code',
    code: `test('status code is 200', () => {\n  expect(res.getStatus()).to.equal(200);\n});`,
  },
  {
    label: 'Assert response time',
    code: `test('response time is below 500ms', () => {\n  expect(res.getResponseTime()).to.be.below(500);\n});`,
  },
  {
    label: 'Assert a JSON body field',
    code: `test('response has expected field', () => {\n  expect(res.getBody()).to.have.property('id');\n});`,
  },
  {
    label: 'Set an environment variable from the response',
    code: `bru.setEnvVar('token', res.getBody().token);`,
  },
];

// Appends a snippet to the current script text (a blank line between them if
// there's already something there) — the editors here have no imperative
// cursor-insert API (CodeSurface doesn't expose a ref), so this is simpler
// than true at-cursor insertion but covers the common case: reaching for a
// snippet on a mostly-empty or already-linear script.
export function appendSnippet(current: string, snippet: ScriptSnippet): string {
  return current.trim() ? `${current}\n\n${snippet.code}` : snippet.code;
}
