import { describe, expect, it } from 'vitest';
import { FormatError, formatWithTool, formatterFor, parsePrettierConfig } from './format';

const spaces2 = { tabWidth: 2, useTabs: false };

describe('formatterFor', () => {
  it('maps languages to the formatter VS Code users would have', () => {
    expect(formatterFor('TypeScript')?.id).toBe('prettier');
    expect(formatterFor('JSON')?.label).toBe('Prettier');
    expect(formatterFor('PostgreSQL')?.id).toBe('sql-formatter');
    expect(formatterFor('Python')?.id).toBe('reindent');
    expect(formatterFor(null)).toBeNull();
  });
});

describe('formatWithTool', () => {
  it('formats JavaScript with Prettier defaults and the detected indent', async () => {
    const out = await formatWithTool("const a={b:1,c:'x'}\nfunction f(){return a}", 'JavaScript', 'a.js', spaces2);
    expect(out).toBe('const a = { b: 1, c: "x" };\nfunction f() {\n  return a;\n}\n');
  });

  it('honours tabs and the project config (config wins)', async () => {
    const tabs = await formatWithTool('function f(){return 1}', 'TypeScript', 'a.ts', { tabWidth: 4, useTabs: true });
    expect(tabs).toBe('function f() {\n\treturn 1;\n}\n');
    const cfg = await formatWithTool("const a = 'x'", 'JavaScript', 'a.js', { ...spaces2, prettierConfig: { singleQuote: true, semi: false } });
    expect(cfg).toBe("const a = 'x'\n");
  });

  it('formats JSON, JSONC (tsconfig with comments), CSS, HTML, YAML, Markdown and XML', async () => {
    expect(await formatWithTool('{"a":[1,2],"b":{"c":true}}', 'JSON', 'x.json', spaces2))
      .toBe('{ "a": [1, 2], "b": { "c": true } }\n');
    expect(await formatWithTool('{\n// comment\n"compilerOptions":{"strict":true,}}', 'JSON', 'tsconfig.json', spaces2))
      .toContain('// comment');
    expect(await formatWithTool('a{color:red;margin:0}', 'CSS', 'x.css', spaces2)).toBe('a {\n  color: red;\n  margin: 0;\n}\n');
    expect(await formatWithTool('<div><p>hi</p><script>let x=1</script></div>', 'HTML', 'x.html', spaces2))
      .toContain('let x = 1;');
    expect(await formatWithTool('a:   1\nb:\n    - x', 'YAML', 'x.yaml', spaces2)).toBe('a: 1\nb:\n  - x\n');
    expect(await formatWithTool('#  Title\n*  item', 'Markdown', 'x.md', spaces2)).toBe('# Title\n\n- item\n');
    expect(await formatWithTool('<a><b   x="1"/></a>', 'XML', 'x.xml', spaces2)).toBe('<a>\n  <b x="1" />\n</a>\n');
  });

  it('formats SQL per dialect with upper-case keywords', async () => {
    expect(await formatWithTool('select a,b from t where a=1', 'PostgreSQL', 'q.sql', spaces2))
      .toBe('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  a = 1');
  });

  it('reports a syntax error with its position instead of mangling the text', async () => {
    await expect(formatWithTool('const a = {', 'JavaScript', 'a.js', spaces2)).rejects.toBeInstanceOf(FormatError);
    const err = (await formatWithTool('let x = ;\n', 'JavaScript', 'a.js', spaces2).catch((e: unknown) => e)) as FormatError;
    expect(err.line).toBe(1);
    expect(err.message).not.toContain('\n');
  });

  it('leaves languages without a tool to the caller (reindent)', async () => {
    expect(await formatWithTool('def f():\npass', 'Python', 'a.py', spaces2)).toBeNull();
  });
});

describe('parsePrettierConfig', () => {
  it('reads .prettierrc as JSON or YAML, and package.json#prettier', async () => {
    expect(await parsePrettierConfig('.prettierrc', '{"semi":false}')).toEqual({ semi: false });
    expect(await parsePrettierConfig('.prettierrc', 'semi: false\nsingleQuote: true')).toEqual({ semi: false, singleQuote: true });
    expect(await parsePrettierConfig('package.json', '{"name":"x","prettier":{"tabWidth":4}}')).toEqual({ tabWidth: 4 });
    expect(await parsePrettierConfig('package.json', '{"name":"x"}')).toBeNull();
    expect(await parsePrettierConfig('.prettierrc.json', 'not json')).toBeNull();
  });
});
