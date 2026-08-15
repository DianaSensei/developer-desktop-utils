import { describe, expect, it } from 'vitest';
import { DICTIONARY, translate, detectDefaultLocale, LOCALES } from '@/lib/i18n';

describe('DICTIONARY', () => {
  it('mọi khoá có đủ bản dịch VI và EN, không rỗng', () => {
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      for (const locale of LOCALES) {
        const text = entry[locale as keyof typeof entry];
        expect(text, `${key}.${locale} rỗng hoặc thiếu`).toBeTruthy();
      }
    }
  });

  it('VI và EN không được trùng nhau y hệt (dấu hiệu quên dịch)', () => {
    const untranslated = Object.entries(DICTIONARY).filter(([, e]) => e.vi === e.en);
    // Ký hiệu ngắn (viết tắt, tên riêng) có thể trùng hợp lệ; nếu danh sách này
    // phình ra, kiểm tra lại xem có khoá nào bị copy-paste nhầm không.
    expect(untranslated).toEqual([]);
  });
});

describe('translate', () => {
  it('trả đúng bản dịch theo locale', () => {
    expect(translate('shell.section.favorites', 'vi')).toBe('Yêu thích');
    expect(translate('shell.section.favorites', 'en')).toBe('Favorites');
  });

  it('nội suy tham số {{name}}', () => {
    expect(translate('shell.search.noMatch', 'vi', { query: 'cron' })).toBe(
      'Không có tool nào khớp "cron"',
    );
    expect(translate('shell.search.noMatch', 'en', { query: 'cron' })).toBe(
      'No tools match "cron"',
    );
  });

  it('khoá không tồn tại trả về chính khoá đó, không ném lỗi', () => {
    // @ts-expect-error — cố tình truyền khoá sai để kiểm tra đường lỗi lúc chạy
    expect(translate('shell.does.not.exist', 'vi')).toBe('shell.does.not.exist');
  });
});

describe('detectDefaultLocale', () => {
  it('trả về "vi" hoặc "en"', () => {
    expect(LOCALES).toContain(detectDefaultLocale());
  });
});
