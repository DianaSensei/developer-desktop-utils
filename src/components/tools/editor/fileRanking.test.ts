import { describe, expect, it } from 'vitest';
import { rankFiles } from './fileRanking';

const files = [
  'README.md',
  'src/components/tools/editor/store.ts',
  'src/components/tools/editor/store.test.ts',
  'src/components/tools/apiclient/store.ts',
  'src/lib/storage.ts',
  'docs/restore.md',
].map((rel) => ({ rel, path: `/ws/${rel}` }));

const rels = (q: string) => rankFiles(files, q).map((f) => f.rel);

describe('Quick Open ranking', () => {
  it('empty query lists everything in order', () => {
    expect(rels('')).toEqual(files.map((f) => f.rel));
  });

  it('prefers a file-name prefix, then shallower paths', () => {
    const r = rels('store');
    // All three names start with the query; the shorter path wins the tie.
    expect(r.slice(0, 3)).toEqual([
      'src/components/tools/editor/store.ts',
      'src/components/tools/apiclient/store.ts',
      'src/components/tools/editor/store.test.ts',
    ]);
    // "restore.md" only contains it.
    expect(r.indexOf('docs/restore.md')).toBeGreaterThan(2);
  });

  it('every token must match; folder tokens narrow', () => {
    expect(rels('editor store')).toEqual([
      'src/components/tools/editor/store.ts',
      'src/components/tools/editor/store.test.ts',
    ]);
    expect(rels('nothing-like-this')).toEqual([]);
  });

  it('accepts an in-order subsequence as a last resort', () => {
    expect(rels('stts')).toContain('src/components/tools/editor/store.test.ts');
  });
});
