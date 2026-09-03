import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG, mergeConfig, CONFIG_FIELDS, SECTION_LABELS, type AppConfig } from '@/config/appConfig';

/**
 * `mergeConfig` là hàng phòng thủ giữa localStorage (dữ liệu người dùng cũ,
 * có thể thiếu field mới thêm sau này, hoặc hỏng hoàn toàn) và phần còn lại
 * của app luôn giả định `AppConfig` đầy đủ. Sai ở đây → Settings render field
 * `undefined` hoặc toàn app throw khi đọc `config.editor.copyFeedbackMs`.
 * `CONFIG_FIELDS`/`SECTION_LABELS` là bảng khai báo tay riêng biệt với
 * `AppConfig` — test coi đây là bảng dữ liệu để đối chiếu tính toàn vẹn, một
 * việc TypeScript không tự kiểm được (chuỗi `key` không gõ kiểu theo AppConfig).
 */

describe('mergeConfig', () => {
  it('stored null/undefined → trả về đúng bản sao của DEFAULT_APP_CONFIG', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_APP_CONFIG);
    expect(mergeConfig(undefined)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('stored không phải object (chuỗi, số, mảng rỗng coi như object nhưng không section nào khớp) → về mặc định', () => {
    expect(mergeConfig('corrupted')).toEqual(DEFAULT_APP_CONFIG);
    expect(mergeConfig(42)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('chỉ override đúng field có trong stored, các field khác giữ mặc định', () => {
    const merged = mergeConfig({ editor: { copyFeedbackMs: 9999 } });
    expect(merged.editor.copyFeedbackMs).toBe(9999);
    expect(merged.editor.historyDebounceMs).toBe(DEFAULT_APP_CONFIG.editor.historyDebounceMs);
    expect(merged.updates).toEqual(DEFAULT_APP_CONFIG.updates); // section không đụng tới thì y hệt mặc định
  });

  it('section trong stored không phải object (dữ liệu hỏng cục bộ) thì bỏ qua CẢ SECTION, không throw', () => {
    const merged = mergeConfig({ kafka: 'not-an-object', editor: { copyFeedbackMs: 1 } });
    expect(merged.kafka).toEqual(DEFAULT_APP_CONFIG.kafka);
    expect(merged.editor.copyFeedbackMs).toBe(1);
  });

  it('field lạ (đã bị xoá khỏi AppConfig ở version sau) không làm hỏng các field còn lại', () => {
    const merged = mergeConfig({ editor: { copyFeedbackMs: 1, longRemovedField: 'x' } });
    expect(merged.editor.copyFeedbackMs).toBe(1);
    expect((merged.editor as Record<string, unknown>).longRemovedField).toBe('x'); // không lọc — ghi lại đúng hành vi thật
  });

  it('không đột biến DEFAULT_APP_CONFIG dùng chung — hai lần gọi liên tiếp không rò rỉ vào nhau', () => {
    const before = structuredClone(DEFAULT_APP_CONFIG);
    mergeConfig({ generator: { maxNumberCount: 1 } });
    expect(DEFAULT_APP_CONFIG).toEqual(before);

    const a = mergeConfig({ generator: { maxNumberCount: 1 } });
    mergeConfig({ generator: { maxNumberCount: 2 } });
    expect(a.generator.maxNumberCount).toBe(1); // lần gọi sau không được ghi ngược vào kết quả lần trước
  });

  it('stored đầy đủ mọi section/field → merged khớp y hệt (round-trip)', () => {
    const full: AppConfig = {
      updates: { defaultCheckHour: 1, downloadTimeoutSeconds: 2, recheckStaleMinutes: 3 },
      editor: { historyDebounceMs: 4, copyFeedbackMs: 5 },
      generator: { maxNumberCount: 6, maxTextCount: 7, maxTextLength: 8 },
      kafka: { maxFetchMessages: 9 },
      apiClient: { scriptTimeoutMs: 10 },
    };
    expect(mergeConfig(full)).toEqual(full);
  });
});

describe('CONFIG_FIELDS / SECTION_LABELS — toàn vẹn dữ liệu với AppConfig', () => {
  it('mỗi field khai báo section/key đều thật sự tồn tại trong DEFAULT_APP_CONFIG', () => {
    // Bảng này gõ tay, tách rời khỏi type `AppConfig` (key là string thô) —
    // TypeScript không bắt được lỗi đánh máy ở đây, chỉ runtime mới thấy.
    for (const f of CONFIG_FIELDS) {
      const section = DEFAULT_APP_CONFIG[f.section] as Record<string, unknown>;
      expect(section, `section "${f.section}"`).toBeDefined();
      expect(section[f.key], `${f.section}.${f.key}`).toBeDefined();
    }
  });

  it('mỗi field có min <= giá trị mặc định <= max — nếu không, ô nhập trong Settings mở lên đã sai ngay từ đầu', () => {
    for (const f of CONFIG_FIELDS) {
      const section = DEFAULT_APP_CONFIG[f.section] as Record<string, number>;
      const value = section[f.key];
      expect(value, `${f.section}.${f.key}`).toBeGreaterThanOrEqual(f.min);
      expect(value, `${f.section}.${f.key}`).toBeLessThanOrEqual(f.max);
    }
  });

  it('mọi section của AppConfig đều có nhãn hiển thị trong SECTION_LABELS', () => {
    for (const section of Object.keys(DEFAULT_APP_CONFIG) as (keyof AppConfig)[]) {
      expect(SECTION_LABELS[section], section).toBeTruthy();
    }
  });

  it('mọi field của AppConfig đều có ít nhất một dòng trong CONFIG_FIELDS — thêm field mới mà quên khai báo UI thì bị bắt ở đây', () => {
    for (const section of Object.keys(DEFAULT_APP_CONFIG) as (keyof AppConfig)[]) {
      const keys = Object.keys(DEFAULT_APP_CONFIG[section]);
      for (const key of keys) {
        const found = CONFIG_FIELDS.some((f) => f.section === section && f.key === key);
        expect(found, `${section}.${key} thiếu trong CONFIG_FIELDS`).toBe(true);
      }
    }
  });
});
