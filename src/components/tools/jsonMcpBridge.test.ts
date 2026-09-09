import { describe, expect, it } from 'vitest';
import { buildJsonHandlers } from './jsonMcpBridge';

const handlers = buildJsonHandlers();

describe('jsonMcpBridge — json_format', () => {
  it('pretty-prints with the default 2-space indent', async () => {
    const res = await handlers.json_format({ text: '{"a":1,"b":[1,2]}' });
    expect(res).toEqual({ output: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}' });
  });

  it('accepts a 4-space indent', async () => {
    const res = await handlers.json_format({ text: '{"a":1}', indent: '4' });
    expect(res).toEqual({ output: '{\n    "a": 1\n}' });
  });

  it('accepts lenient input (comments, trailing comma, unquoted keys, single quotes)', async () => {
    const res = await handlers.json_format({ text: "{ // note\n  a: 1, b: 'x', }" });
    expect(res).toEqual({ output: '{\n  "a": 1,\n  "b": "x"\n}' });
  });

  it('errors on genuinely invalid input', async () => {
    await expect(handlers.json_format({ text: '{not json at all' })).rejects.toThrow();
  });
});

describe('jsonMcpBridge — json_minify', () => {
  it('collapses to one line with no whitespace', async () => {
    const res = await handlers.json_minify({ text: '{\n  "a": 1\n}' });
    expect(res).toEqual({ output: '{"a":1}' });
  });
});

describe('jsonMcpBridge — json_to_string', () => {
  it('escapes the minified JSON as a string literal', async () => {
    const res = await handlers.json_to_string({ text: '{"a":1}' });
    expect(res).toEqual({ output: '"{\\"a\\":1}"' });
  });
});

describe('jsonMcpBridge — json_validate', () => {
  it('reports valid input', async () => {
    const res = await handlers.json_validate({ text: '{"a":1}' });
    expect(res).toEqual({ valid: true });
  });

  it('reports invalid input with an error message', async () => {
    const res = await handlers.json_validate({ text: '{not json' }) as { valid: boolean; error: string };
    expect(res.valid).toBe(false);
    expect(res.error).toEqual(expect.any(String));
  });
});
