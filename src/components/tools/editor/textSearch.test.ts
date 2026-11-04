import { describe, expect, it } from 'vitest';
import { GlobSet, buildRegExp, gitignoreGlobs, replaceAll, replacedMatch, searchText, type TextSearchQuery } from './textSearch';

const Q = (over: Partial<TextSearchQuery> = {}): TextSearchQuery => ({
  query: 'x', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '', useIgnoreFiles: true, ...over,
});

describe('globs (same rules as editor_search.rs)', () => {
  const set = (s: string) => new GlobSet(s);
  it.each([
    ['*.ts', 'src/a/b.ts', true],
    ['*.ts', 'src/a/b.tsx', false],
    ['*.{ts,tsx}', 'b.tsx', true],
    ['docs', 'a/docs/guide.md', true],
    ['docs', 'mydocs/guide.md', false],
    ['/docs', 'docs/x', true],
    ['/docs', 'a/docs/x', false],
    ['src/**/*.test.ts', 'src/c.test.ts', true],
    ['src/**/*.test.ts', 'src/a/b/c.test.ts', true],
    ['dist/, *.min.js', 'lib/x.min.js', true],
    ['file[0-9].txt', 'file3.txt', true],
    ['file[!0-9].txt', 'file3.txt', false],
  ])('%s vs %s → %s', (glob, rel, want) => {
    expect(set(glob).matches(rel)).toBe(want);
  });

  it('reads .gitignore lines', () => {
    const gi = gitignoreGlobs('# build output\nbuild/\n!keep.txt\nlogs/*.log\n');
    expect(gi.matches('build/out.js')).toBe(true);
    expect(gi.matches('logs/a.log')).toBe(true);
    expect(gi.matches('sub/logs/a.log')).toBe(false);
    expect(gi.matches('keep.txt')).toBe(false);
  });
});

describe('searchText', () => {
  it('finds every match with line, column and a trimmed preview', () => {
    const hits = searchText('a\n    const id = id + 1;\r\nnone', buildRegExp(Q({ query: 'id', wholeWord: true }))!);
    expect(hits.map((h) => [h.line, h.column, h.length])).toEqual([[2, 10, 2], [2, 15, 2]]);
    expect(hits[0].preview).toBe('const id = id + 1;');
    expect(hits[0].preview.slice(hits[0].previewColumn, hits[0].previewColumn + 2)).toBe('id');
  });

  it('cuts long lines around the match', () => {
    const line = `${'a'.repeat(100)}X${'b'.repeat(500)}`;
    const [hit] = searchText(line, buildRegExp(Q({ query: 'X', caseSensitive: true }))!);
    expect(hit.preview.startsWith('…')).toBe(true);
    expect(hit.preview[hit.previewColumn]).toBe('X');
    expect(hit.preview.length).toBeLessThan(300);
  });

  it('respects the limit and rejects a bad regex', () => {
    expect(searchText('x x x\nx', buildRegExp(Q())!, 3)).toHaveLength(3);
    expect(() => buildRegExp(Q({ query: '(', regex: true }))).toThrow();
  });
});

describe('replace', () => {
  it('replaces literally, keeping $ and CRLF', () => {
    const out = replaceAll('price x\r\nx2', Q(), '$1');
    expect(out).toEqual({ text: 'price $1\r\n$12', count: 2 });
  });

  it('supports groups and \\n in regex mode', () => {
    const q = Q({ query: '(\\w+)=(\\d+)', regex: true });
    expect(replaceAll('a=1 b=2', q, '$2:$1').text).toBe('1:a 2:b');
    expect(replaceAll('a=1', q, '$1\\n$2').text).toBe('a\n1');
    expect(replacedMatch(q, 'a=1', '$2')).toBe('1');
  });

  it('honours case and whole word', () => {
    expect(replaceAll('Id id idx', Q({ query: 'id', wholeWord: true }), 'key')).toEqual({ text: 'key key idx', count: 2 });
    expect(replaceAll('Id id', Q({ query: 'id', caseSensitive: true }), 'k').text).toBe('Id k');
  });
});
