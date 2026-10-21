// @vitest-environment node
//
// macOS and Windows file systems are case-insensitive: two modules whose
// names differ only in case (`PipelineTemplates.tsx` / `pipelineTemplates.ts`)
// resolve to whichever the OS finds first, so the release build broke there
// while Linux CI stayed green. This keeps such pairs out of `src/`.

import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, parse, relative } from 'node:path';

const ROOT = join(__dirname);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Module specifier a file answers to: path without extension (and without `.test`). */
const moduleKey = (file: string) => {
  const { dir, name } = parse(relative(ROOT, file));
  return join(dir, name);
};

describe('source file names', () => {
  it('never differ from another module only in letter case', () => {
    const byLower = new Map<string, Set<string>>();
    for (const f of walk(ROOT)) {
      const key = moduleKey(f);
      const set = byLower.get(key.toLowerCase()) ?? new Set<string>();
      set.add(key);
      byLower.set(key.toLowerCase(), set);
    }
    const clashes = [...byLower.values()].filter((s) => s.size > 1).map((s) => [...s].join(' ↔ '));
    expect(clashes).toEqual([]);
  });
});
