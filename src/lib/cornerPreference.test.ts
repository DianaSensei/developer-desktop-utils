import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storageRemove, storageSet } from '@/lib/persistentStore';
import { CORNER_STYLES, getCornerPreference, setCornerPreference } from '@/lib/cornerPreference';

describe('CORNER_STYLES khớp đúng preset trong design/tokens.css', () => {
  const tokens = readFileSync(resolve(__dirname, '../../design/tokens.css'), 'utf-8');

  it('mọi kiểu khai báo trong TS đều có khối [data-corner] tương ứng', () => {
    const declared = [...tokens.matchAll(/\[data-corner="(\w+)"\]/g)].map((m) => m[1]);
    expect([...CORNER_STYLES].sort()).toEqual([...declared].sort());
  });

  it('mỗi preset đặt lại ĐỦ thang bán kính', () => {
    // Thiếu một bậc thì bậc đó giữ giá trị mặc định — thang gãy ở đúng chỗ đó
    // và chỉ lộ ra khi nhìn tận mắt một component dùng bậc bị bỏ quên.
    const steps = ['--r-default', '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl'];
    for (const [, body] of tokens.matchAll(/\[data-corner="\w+"\]\s*\{([^}]*)\}/g)) {
      for (const step of steps) expect(body).toContain(`${step}:`);
    }
  });

  it('không preset nào đụng tới --r-full: pill vẫn là pill ở cả ba', () => {
    for (const [, body] of tokens.matchAll(/\[data-corner="\w+"\]\s*\{([^}]*)\}/g)) {
      expect(body).not.toContain('--r-full');
    }
  });
});

describe('getCornerPreference / setCornerPreference', () => {
  beforeEach(() => storageRemove('devtool-corner'));

  it('mặc định là "default" khi chưa lưu gì', () => {
    expect(getCornerPreference()).toBe('default');
  });

  it('lưu rồi đọc lại đúng giá trị', () => {
    setCornerPreference('sharp');
    expect(getCornerPreference()).toBe('sharp');
  });

  it('giá trị lưu hỏng thì rơi về mặc định', () => {
    storageSet('devtool-corner', 'not-a-real-style');
    expect(getCornerPreference()).toBe('default');
  });
});
