import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards for the design kit in `design/`:
 *   1. design/tokens.css is plain CSS (no Tailwind syntax), or the static
 *      preview page breaks;
 *   2. the preview page uses no undefined variables;
 *   3. status colors never derive from the accent, so changing the tone
 *      cannot recolor a "success" chip.
 */

const root = resolve(__dirname, '../..');
const tokens = readFileSync(resolve(root, 'design/tokens.css'), 'utf-8');
const preview = readFileSync(resolve(root, 'design/preview/index.html'), 'utf-8');

/** Declared variables; several may share a line. */
const declared = (css: string) =>
  new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

/** Comments stripped: the docs mention the forbidden at-rules. */
const code = tokens.replace(/\/\*[\s\S]*?\*\//g, '');

describe('design kit — tokens.css', () => {
  it('là CSS thuần: không có cú pháp cần Tailwind xử lý', () => {
    // @layer/@apply need Tailwind; the static preview links this file directly.
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
    // A dark override assigning `--acc: ...` directly would desync the `-c` variant.
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
    // Changing the accent must not change status meaning (design/RULES.md).
    for (const name of statusChannels) {
      const decls = [...tokens.matchAll(new RegExp(`--${name}-c:\\s*([^;]+);`, 'g'))];
      expect(decls.length, `--${name}-c phải được khai báo cho cả sáng và tối`).toBe(2);
      for (const [, value] of decls) {
        expect(value, `--${name}-c không được dẫn xuất từ accent`).not.toMatch(/--a-[hsl]\b/);
      }
    }
  });

  it('giữ đúng hue nghĩa ở cả hai theme', () => {
    // ok must be green (~90–170°), bad red (~0–20° or ~340–360°).
    const hueOf = (name: string) =>
      [...tokens.matchAll(new RegExp(`--${name}-c:\\s*([\\d.]+)`, 'g'))].map((m) => Number(m[1]));

    for (const h of hueOf('ok')) expect(h, `ok hue ${h} phải là xanh lá`).toBeGreaterThan(90);
    for (const h of hueOf('ok')) expect(h).toBeLessThan(170);
    for (const h of hueOf('bad')) expect(h, `bad hue ${h} phải là đỏ`).toBeLessThan(20);
  });
});

describe('design kit — tone chủ đạo phải phân biệt được với màu trạng thái', () => {
  /** HSL → RGB, to measure real color distance. */
  const toRgb = (h: number, s: number, l: number): [number, number, number] => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return [f(0), f(8), f(4)];
  };
  const dist = (a: number[], b: number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /** Light-theme status colors the accent must stay away from. */
  const statusHsl = (name: string) => {
    const m = tokens.match(new RegExp(`--${name}-c:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
    if (!m) throw new Error(`không tìm thấy --${name}-c`);
    return toRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  };

  const presets = [...tokens.matchAll(
    /\[data-accent="(\w+)"\]\s*\{\s*--a-h:\s*([\d.]+);\s*--a-s:\s*([\d.]+)%;\s*--a-l:\s*([\d.]+)%/g
  )];

  it('có ít nhất một bộ tone được khai báo', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  // An accent too close to --bad makes primary buttons look like errors.
  for (const [, name, h, s, l] of presets) {
    it(`tone "${name}" đủ xa --bad và --ok`, () => {
      const acc = toRgb(Number(h), Number(s), Number(l));
      expect(dist(acc, statusHsl('bad')), `"${name}" quá giống màu lỗi`).toBeGreaterThan(45);
      expect(dist(acc, statusHsl('ok')), `"${name}" quá giống màu hợp lệ`).toBeGreaterThan(45);
    });
  }
});

describe('design kit — trang mẫu', () => {
  it('không dùng biến CSS nào chưa được định nghĩa', () => {
    const known = new Set([...declared(tokens), ...declared(preview)]);
    const used = new Set([...preview.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !known.has(v))).toEqual([]);
  });

  it('swatch tone khớp đúng preset trong tokens.css', () => {
    // The preview must offer exactly the app's tones.
    const presets = [...tokens.matchAll(
      /\[data-accent="(\w+)"\]\s*\{\s*--a-h:\s*([\d.]+);\s*--a-s:\s*([\d.]+)%;\s*--a-l:\s*([\d.]+)%/g
    )].map(([, , h, s, l]) => `${h} ${s}% ${l}%`);

    const swatches = [...preview.matchAll(
      /class="sw"\s+data-h="([\d.]+)"\s+data-s="([\d.]+%)"\s+data-l="([\d.]+%)"/g
    )].map(([, h, s, l]) => `${h} ${s} ${l}`);

    expect(swatches).toEqual(presets);
  });

  it('link tới token dùng chung thay vì tự khai báo lại', () => {
    // A pasted :root block in the preview would drift from the app.
    expect(preview).toContain('href="../tokens.css"');
    expect(preview).not.toMatch(/:root\s*\{/);
  });
});
