import { describe, expect, it } from 'vitest';
import type { Messages } from '@/lib/i18n';

/**
 * Mọi từ điển tool (`*.messages.ts`) phải có đủ VI và EN, không rỗng, và mọi
 * `{{param}}` có mặt ở cả hai bản — thiếu param ở một bên là câu hiện ra với
 * chỗ trống hoặc `{{n}}` thô.
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
