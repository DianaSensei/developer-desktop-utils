import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import baseline from '../../design/baseline.json';

/**
 * Rào chắn hồi quy có NGƯỠNG LÙI DẦN.
 *
 * Repo mang một khối nợ thiết kế lớn: hàng trăm màu Tailwind thô, chữ dưới 11px,
 * ba chiều cao control trộn lẫn. Không thể sửa hết trong một giai đoạn, và một
 * rule bật lên rồi kêu 500 lần thì chỉ tạo ra thói quen phớt lờ.
 *
 * Nên thay vì cấm tuyệt đối, test này ĐẾM và so với ngưỡng trong
 * design/baseline.json. Thêm vi phạm mới → đỏ. Dọn bớt → test nhắc hạ ngưỡng,
 * khoá lại thành tiến độ không lùi được.
 *
 * Mỗi giai đoạn di cư (G2–G5) hạ ngưỡng; đích cuối là 0 cho phần lớn chỉ số.
 *
 * Vì sao không phải ESLint: repo chưa có ESLint. Dựng cả toolchain chỉ để chạy
 * mấy rule chuỗi là quá nặng, trong khi vitest đã sẵn trong `npm test` và CI.
 */

const SRC = resolve(__dirname, '..');

/** Mọi file nguồn TS/TSX/CSS dưới src/, trừ chính bộ test guard. */
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
    // `text-red-500`, `bg-emerald-50`… — không theo theme, không đổi được tone.
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
    key: 'hoverLift',
    label: 'nhấc phần tử khi rê chuột',
    pattern: /hover:-translate-y/g,
    why: 'Rê chuột đổi nền/viền, không đổi vị trí — design/RULES.md.',
  },
  {
    key: 'handRolledTooltip',
    label: 'tooltip tự chế',
    pattern: /group-hover:block/g,
    why: 'Dùng component <Tooltip> — bản tự chế không xử lý bàn phím và tràn viewport.',
  },
];

/** Đếm vi phạm, kèm nơi nhiều nhất để biết chỗ nào đáng dọn trước. */
function count(rule: Rule) {
  let total = 0;
  const byFile: Array<[string, number]> = [];
  for (const file of FILES) {
    const hits = readFileSync(file, 'utf-8').match(rule.pattern)?.length ?? 0;
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

      // Dọn xong mà quên hạ ngưỡng thì lần sau vi phạm lẻn về không ai biết.
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
