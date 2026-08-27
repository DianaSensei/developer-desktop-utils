import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storageRemove, storageSet } from '@/lib/persistentStore';
import { FONT_PREFERENCES, getFontPreference, setFontPreference } from '@/lib/fontPreference';

describe('FONT_PREFERENCES khớp đúng preset trong design/tokens.css', () => {
  it('mọi lựa chọn khai báo trong TS đều có khối [data-font] tương ứng', () => {
    // Cùng rủi ro trôi lệch như ACCENT_TONES/accentPreference.test.ts: sửa
    // preset trong tokens.css mà quên sửa danh sách TS (hoặc ngược lại) thì
    // bộ chọn trong Settings sẽ hiện một lựa chọn không có hiệu lực, hoặc
    // thiếu một lựa chọn đã có sẵn.
    const tokens = readFileSync(resolve(__dirname, '../../design/tokens.css'), 'utf-8');
    const declared = [...tokens.matchAll(/\[data-font="(\w+)"\]/g)].map((m) => m[1]);
    expect([...FONT_PREFERENCES].sort()).toEqual([...declared].sort());
  });
});

describe('getFontPreference / setFontPreference', () => {
  beforeEach(() => storageRemove('devtool-font'));

  it('mặc định là "default" khi chưa lưu gì', () => {
    expect(getFontPreference()).toBe('default');
  });

  it('lưu rồi đọc lại đúng giá trị', () => {
    setFontPreference('system');
    expect(getFontPreference()).toBe('system');
  });

  it('giá trị lưu hỏng (không thuộc FONT_PREFERENCES) thì rơi về mặc định', () => {
    storageSet('devtool-font', 'not-a-real-font');
    expect(getFontPreference()).toBe('default');
  });
});
