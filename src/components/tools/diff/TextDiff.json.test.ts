import { describe, expect, it } from 'vitest';
import { computeJsonDiff, reindentJson } from '@/components/tools/diff/TextDiff';

/** JSON mode compares what the user pasted; it must not rewrite it first. */

describe('Diff — JSON mode', () => {
  it('re-indents without changing any literal', () => {
    expect(reindentJson('{"id": 9007199254740993, "price": 1.10, "s": "a,\\"b\\":{c}", "e": [], "o": {}}')).toBe(
      '{\n  "id": 9007199254740993,\n  "price": 1.10,\n  "s": "a,\\"b\\":{c}",\n  "e": [],\n  "o": {}\n}',
    );
  });

  it('leaves invalid JSON untouched', () => {
    expect(reindentJson('{"a": 1,')).toBe('{"a": 1,');
  });

  it('numbers beyond 2^53 that differ are reported as changed', () => {
    const result = computeJsonDiff('{"id": 9007199254740993}', '{"id": 9007199254740992}');
    expect(result.changes).toEqual([
      expect.objectContaining({ path: 'id', kind: 'changed' }),
    ]);
  });

  it('a key named like an Object.prototype member is an addition, not a change', () => {
    const result = computeJsonDiff('{}', '{"toString": 1}');
    expect(result.changes).toEqual([expect.objectContaining({ path: 'toString', kind: 'added' })]);
  });
});
