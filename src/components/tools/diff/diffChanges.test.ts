import { describe, expect, it } from 'vitest';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { DIFF_CONFIG, allPrecise, listChanges, previewText } from './diffChanges';

const doc = (s: string) => Text.of(s.split('\n'));

function changes(a: string, b: string, conf: Parameters<typeof Chunk.build>[2] = DIFF_CONFIG) {
  const A = doc(a), B = doc(b);
  const chunks = Chunk.build(A, B, conf);
  return { chunks, list: listChanges(chunks, A, B) };
}

describe('Diff — exact changes', () => {
  it('reports the changed characters and their line:column on both sides', () => {
    const { list } = changes('alpha\nthe quick fox\nomega', 'alpha\nthe slow fox\nomega');
    expect(list).toEqual([
      expect.objectContaining({ kind: 'replace', removed: 'quick', added: 'slow', lineA: 2, colA: 5, lineB: 2, colB: 5 }),
    ]);
  });

  it('tells inserts and deletes apart', () => {
    const a = 'one\ntwo\nthree\nfour\nfive\nsix\nseven';
    const b = 'one\nthree\nfour\nfive\nsix\nseven\neight';
    const { list } = changes(a, b);
    expect(list.map((c) => [c.kind, c.removed, c.added])).toEqual([['delete', 'two\n', ''], ['insert', '', '\neight']]);
  });

  it('keeps scattered edits in a long document separate instead of one giant chunk', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => `row ${i} value ${i * 3}`);
    const edited = rows.map((r, i) => (i % 97 === 0 ? r.replace(/\d+$/, (n) => String(Number(n) + 1)) : r));
    const a = `${rows.join('\n')}\nThe service returns {"id":123,"tags":["a","b"],"active":true} and an error otherwise.`;
    const b = `${edited.join('\n')}\nThe service returns {"id":124,"tags":["a","c"],"active":false}, or an error otherwise.`;

    // The package default collapses this into one chunk spanning everything.
    expect(changes(a, b, { scanLimit: 500 }).chunks).toHaveLength(1);

    const { chunks, list } = changes(a, b);
    expect(allPrecise(chunks)).toBe(true);
    expect(chunks.length).toBe(32);
    const lastLine = list.filter((c) => c.lineA === 3001).map((c) => [c.removed, c.added]);
    // Changes one character apart are merged into one readable edit.
    expect(lastLine).toEqual([['123', '124'], ['b', 'c'], ['true} and', 'false}, or']]);
  });

  it('honours the limit', () => {
    const a = Array.from({ length: 50 }, (_, i) => `line number ${i} stays`).join('\n');
    const b = Array.from({ length: 50 }, (_, i) => `line number ${i} ${i % 5 ? 'stays' : 'moved'}`).join('\n');
    expect(changes(a, b).list.length).toBeGreaterThan(5);
    const A = doc(a), B = doc(b);
    expect(listChanges(Chunk.build(A, B, DIFF_CONFIG), A, B, 5)).toHaveLength(5);
  });

  it('makes whitespace visible in previews', () => {
    expect(previewText(' a\tb\n')).toBe('·a⇥b↵');
    expect(previewText('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
