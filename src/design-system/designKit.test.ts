import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Rào chắn cho `design/` — bộ design kit.
 *
 * Kit chỉ giữ được giá trị nếu ba điều luôn đúng:
 *   1. `design/tokens.css` là CSS THUẦN (không có cú pháp Tailwind), nếu không
 *      trang mẫu tĩnh sẽ vỡ.
 *   2. Trang mẫu không dùng biến nào chưa được định nghĩa.
 *   3. Màu trạng thái KHÔNG dẫn xuất từ accent — nếu không, đổi tone sẽ làm
 *      thẻ "thành công" đổi màu. Đây là luật gốc của cả hệ.
 *
 * Cả ba đều là thứ dễ bị phá trong một PR vô tình. Test này bắt được ngay.
 */

const root = resolve(__dirname, '../..');
const tokens = readFileSync(resolve(root, 'design/tokens.css'), 'utf-8');
const preview = readFileSync(resolve(root, 'design/preview/index.html'), 'utf-8');

/** Biến khai báo — chúng có thể nằm chung dòng, nên không neo vào đầu dòng. */
const declared = (css: string) =>
  new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

/** Bỏ comment — tài liệu trong file có nhắc tên các at-rule bị cấm. */
const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '');

describe('design kit — tokens.css', () => {
  it('là CSS thuần: không có cú pháp cần Tailwind xử lý', () => {
    // @layer / @apply bắt buộc phải qua Tailwind. Nếu lọt vào đây, trang mẫu
    // tĩnh (chỉ <link> thẳng file này) sẽ hiện sai mà không báo lỗi gì.
    expect(code).not.toMatch(/@apply\b/);
    expect(code).not.toMatch(/@layer\b/);
    expect(code).not.toMatch(/@tailwind\b/);
  });

  it('mỗi biến kênh `-c` đều có bản hsl() đi kèm', () => {
    const all = declared(tokens);
    const orphans = [...all]
      .filter((v) => v.endsWith('-c'))
      .map((v) => v.slice(0, -2))
      .filter((base) => !all.has(base));
    expect(orphans).toEqual([]);
  });

  it('bản tối định nghĩa lại kênh, không định nghĩa lại màu đã bọc hsl()', () => {
    const dark = tokens.slice(tokens.indexOf('.dark {'), tokens.indexOf('[data-accent='));
    // Nếu bản tối gán thẳng `--acc: ...` thì bản `-c` và bản bọc sẽ lệch nhau.
    const rewrapped = [...dark.matchAll(/(--[a-z0-9-]+):\s*hsl\(var\(--\1-c\)\)/g)];
    expect(rewrapped).toHaveLength(0);
  });
});

describe('design kit — luật màu trạng thái', () => {
  const statusChannels = [
    'ok', 'ok-tint', 'ok-edge',
    'warn', 'warn-tint', 'warn-edge',
    'bad', 'bad-tint', 'bad-edge',
    'info', 'info-tint', 'info-edge',
  ];

  it('không màu trạng thái nào tham chiếu kênh accent', () => {
    // Đây là luật giữ cho việc đổi tone không phá vỡ ngữ nghĩa: đổi accent sang
    // đỏ mà chip "hợp lệ" vẫn xanh lá. Xem design/RULES.md.
    for (const name of statusChannels) {
      const decls = [...tokens.matchAll(new RegExp(`--${name}-c:\\s*([^;]+);`, 'g'))];
      expect(decls.length, `--${name}-c phải được khai báo cho cả sáng và tối`).toBe(2);
      for (const [, value] of decls) {
        expect(value, `--${name}-c không được dẫn xuất từ accent`).not.toMatch(/--a-[hsl]\b/);
      }
    }
  });

  it('giữ đúng hue nghĩa ở cả hai theme', () => {
    // ok phải xanh lá (~90–170°), bad phải đỏ (~0–20° hoặc ~340–360°).
    const hueOf = (name: string) =>
      [...tokens.matchAll(new RegExp(`--${name}-c:\\s*([\\d.]+)`, 'g'))].map((m) => Number(m[1]));

    for (const h of hueOf('ok')) expect(h, `ok hue ${h} phải là xanh lá`).toBeGreaterThan(90);
    for (const h of hueOf('ok')) expect(h).toBeLessThan(170);
    for (const h of hueOf('bad')) expect(h, `bad hue ${h} phải là đỏ`).toBeLessThan(20);
  });
});

describe('design kit — trang mẫu', () => {
  it('không dùng biến CSS nào chưa được định nghĩa', () => {
    const known = new Set([...declared(tokens), ...declared(preview)]);
    const used = new Set([...preview.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !known.has(v))).toEqual([]);
  });

  it('link tới token dùng chung thay vì tự khai báo lại', () => {
    // Nếu ai đó dán một khối :root vào trang mẫu, nó sẽ trôi lệch khỏi app.
    expect(preview).toContain('href="../tokens.css"');
    expect(preview).not.toMatch(/:root\s*\{/);
  });
});
