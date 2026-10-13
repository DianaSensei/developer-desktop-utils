import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import baseline from '../../design/baseline.json';

/**
 * Regression guard with ratcheting thresholds.
 *
 * Existing design debt (raw Tailwind colors, text under 11px, mixed control
 * heights) cannot be fixed at once, so violations are counted and compared
 * with design/baseline.json: new violations fail, and cleanups must lower
 * the threshold so progress cannot regress. (No ESLint in the repo; vitest
 * already runs in CI.)
 */

const SRC = resolve(__dirname, '..');

/** Every TS/TSX/CSS source under src/, except the guard tests themselves. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles();

/**
 * Strips comments before counting, so text explaining a removed class is
 * not counted as a use. Good enough here: strings containing `//` are rare
 * and never contain the patterns.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')  // /* … */ blocks and JSX {/* … */}
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // // lines, keeping "https://"
}

interface Rule {
  key: keyof typeof baseline.limits;
  label: string;
  pattern: RegExp;
  why: string;
}

const RULES: Rule[] = [
  {
    key: 'rawColors',
    label: 'màu Tailwind thô',
    // `text-red-500`, `bg-emerald-50`...: not themeable.
    pattern:
      /\b(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|shadow|decoration|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g,
    why: 'Dùng token (ok/warn/bad/info, acc, fg, line) thay cho bảng màu Tailwind.',
  },
  {
    key: 'tinyText',
    label: 'chữ dưới 11px',
    pattern: /text-\[(?:[0-9]|10)px\]/g,
    why: 'Không đọc được ở HiDPI. Nhỏ nhất là 11px.',
  },
  {
    key: 'mixedControlHeights',
    label: 'chiều cao control rời rạc',
    pattern: /\bh-[789]\b/g,
    why: 'Chỉ dùng h-ctl (34px) và h-ctl-lg (40px).',
  },
  {
    key: 'premiumUtilities',
    label: 'utility *-premium của hệ cũ',
    pattern: /\b[a-z0-9-]+-premium\b/g,
    why: 'Bí danh bắc cầu của G1. Chuyển sang shadow / shadow-soft / shadow-lift.',
  },
  {
    key: 'hardcodedRadius',
    label: 'bo góc viết cứng',
    // `rounded-[12px]` ignores the [data-corner] presets.
    pattern: /rounded(?:-[a-z]+)?-\[[0-9.]+(?:px|rem)\]/g,
    why: 'Dùng bậc có tên: rounded-xs / -sm / -md / -lg / -xl / -full.',
  },
  {
    key: 'hoverLift',
    label: 'nhấc phần tử khi rê chuột',
    pattern: /hover:-translate-y/g,
    why: 'Rê chuột đổi nền/viền, không đổi vị trí — design/RULES.md.',
  },
  {
    key: 'offScaleText',
    label: 'cỡ chữ ngoài thang',
    // Scale: text-[11px] (hint) · text-xs (12) · text-dense (13) · text-sm (14)...
    // Other arbitrary sizes add unnamed steps.
    pattern: /text-\[(?!11px\])[0-9.]+px\]/g,
    why: 'Dùng bậc có tên: text-[11px] / text-xs / text-dense / text-sm / text-base…',
  },
  {
    key: 'handRolledTooltip',
    label: 'tooltip tự chế',
    pattern: /group-hover(?:\/\w+)?:block/g,
    why: 'Dùng component <Tooltip> — bản tự chế không xử lý bàn phím và tràn viewport.',
  },
];

/** Counts violations and the files with the most. */
function count(rule: Rule) {
  let total = 0;
  const byFile: Array<[string, number]> = [];
  for (const file of FILES) {
    const hits = stripComments(readFileSync(file, 'utf-8')).match(rule.pattern)?.length ?? 0;
    if (hits > 0) {
      total += hits;
      byFile.push([relative(SRC, file), hits]);
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe('rào chắn thiết kế — ngưỡng lùi dần', () => {
  for (const rule of RULES) {
    const limit = baseline.limits[rule.key];

    it(`${rule.label}: ≤ ${limit}`, () => {
      const { total, byFile } = count(rule);

      if (total > limit) {
        const worst = byFile.slice(0, 5).map(([f, n]) => `    ${n}× ${f}`).join('\n');
        expect.fail(
          `${rule.label}: ${total} (ngưỡng ${limit}, tăng ${total - limit}).\n` +
            `  ${rule.why}\n  Nhiều nhất ở:\n${worst}`
        );
      }

      // Lower the threshold after a cleanup so regressions are caught.
      if (total < limit) {
        expect.fail(
          `${rule.label}: còn ${total}, thấp hơn ngưỡng ${limit} — tốt!\n` +
            `  Hạ "${rule.key}" xuống ${total} trong design/baseline.json để khoá tiến độ này lại.`
        );
      }

      expect(total).toBe(limit);
    });
  }
});
