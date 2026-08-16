import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storageRemove, storageSet } from '@/lib/persistentStore';
import { ACCENT_TONES, getAccentPreference, setAccentPreference } from '@/lib/accentPreference';

describe('ACCENT_TONES khớp đúng preset trong design/tokens.css', () => {
  it('mọi tone khai báo trong TS đều có khối [data-accent] tương ứng', () => {
    // Đây là chỗ dễ trôi lệch nhất: sửa tone trong tokens.css mà quên sửa danh
    // sách TS (hoặc ngược lại) thì bộ chọn trong Settings sẽ hiện một tone
    // không có hiệu lực, hoặc thiếu một tone đã có sẵn.
    const tokens = readFileSync(resolve(__dirname, '../../design/tokens.css'), 'utf-8');
    const declared = [...tokens.matchAll(/\[data-accent="(\w+)"\]/g)].map((m) => m[1]);
    expect([...ACCENT_TONES].sort()).toEqual([...declared].sort());
  });
});

describe('getAccentPreference / setAccentPreference', () => {
  // storageGet/storageSet đọc/ghi cache trong bộ nhớ của persistentStore (không
  // phải localStorage thật — xem persistentStore.ts), nên dọn bằng storageRemove.
  beforeEach(() => storageRemove('devtool-accent'));

  it('mặc định là azure khi chưa lưu gì', () => {
    expect(getAccentPreference()).toBe('azure');
  });

  it('lưu rồi đọc lại đúng giá trị', () => {
    setAccentPreference('teal');
    expect(getAccentPreference()).toBe('teal');
  });

  it('giá trị lưu hỏng (không thuộc ACCENT_TONES) thì rơi về mặc định', () => {
    storageSet('devtool-accent', 'not-a-real-tone');
    expect(getAccentPreference()).toBe('azure');
  });
});
