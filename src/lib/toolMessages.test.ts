import { describe, expect, it } from 'vitest';
import type { Messages } from '@/lib/i18n';

/**
 * Every tool dictionary (`*.messages.ts`) must have non-empty VI and EN text
 * with the same `{{param}}`s in both.
 */
const modules = import.meta.glob<{ default: Messages }>('../components/**/*.messages.ts', { eager: true });

const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('tool message dictionaries', () => {
  it('finds at least one dictionary', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  for (const [file, mod] of Object.entries(modules)) {
    it(`${file.replace('../components/', '')}: complete VI/EN with matching params`, () => {
      const problems: string[] = [];
      for (const [key, entry] of Object.entries(mod.default)) {
        if (!entry.vi?.trim() || !entry.en?.trim()) problems.push(`${key}: empty`);
        else if (params(entry.vi).join() !== params(entry.en).join()) problems.push(`${key}: params differ`);
      }
      expect(problems).toEqual([]);
    });
  }
});
