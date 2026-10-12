import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storageRemove, storageSet } from '@/lib/persistentStore';
import { MONO_FONT_PREFERENCES, getMonoFontPreference, setMonoFontPreference } from '@/lib/monoFontPreference';

describe('MONO_FONT_PREFERENCES khớp đúng preset trong design/tokens.css', () => {
  it('mọi lựa chọn khai báo trong TS đều có khối [data-mono-font] tương ứng', () => {
    // TS list and tokens.css must stay in sync.
    const tokens = readFileSync(resolve(__dirname, '../../design/tokens.css'), 'utf-8');
    const declared = [...tokens.matchAll(/\[data-mono-font="([\w-]+)"\]/g)].map((m) => m[1]);
    expect([...MONO_FONT_PREFERENCES].sort()).toEqual([...declared].sort());
  });
});

describe('getMonoFontPreference / setMonoFontPreference', () => {
  beforeEach(() => storageRemove('devtool-mono-font'));

  it('mặc định là "ibm-plex-mono" khi chưa lưu gì', () => {
    expect(getMonoFontPreference()).toBe('ibm-plex-mono');
  });

  it('lưu rồi đọc lại đúng giá trị', () => {
    setMonoFontPreference('fira-code');
    expect(getMonoFontPreference()).toBe('fira-code');
  });

  it('giá trị lưu hỏng (không thuộc MONO_FONT_PREFERENCES) thì rơi về mặc định', () => {
    storageSet('devtool-mono-font', 'not-a-real-font');
    expect(getMonoFontPreference()).toBe('ibm-plex-mono');
  });
});
