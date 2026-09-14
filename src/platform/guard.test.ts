import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import baseline from './baseline.json';
import { PLUGINS } from '@/platform';

/**
 * Rào chắn RANH GIỚI PLATFORM — cùng cơ chế ngưỡng lùi dần như
 * `design-system/guard.test.ts`, áp cho một khối nợ khác.
 *
 * Manifest plugin khai `permissions`, nhưng 26 tool hiện có vẫn gọi thẳng
 * `@tauri-apps/*` và store dùng chung, tức quyền mới chỉ là MÔ TẢ chứ chưa được
 * thực thi. Cấm tuyệt đối ngay bây giờ sẽ đỏ hàng chục chỗ trong một lần và
 * chỉ tạo thói quen phớt lờ; nên: đếm, đóng băng con số, và mỗi tool chuyển
 * sang SDK thì hạ ngưỡng. Khi một chỉ số về 0 thì quyền tương ứng chuyển từ mô
 * tả thành thực thi — không cần đổi gì trong code sản phẩm.
 *
 * Hai luật cuối KHÔNG lùi dần: chúng bảo vệ tính chất đã đúng ở hiện tại
 * (manifest phải khai báo thuần, bí mật không được quay lại store dùng chung),
 * nên ngưỡng của chúng là bất biến, không phải nợ.
 */

const SRC = resolve(__dirname, '..');
const PLUGIN_CODE = [join(SRC, 'components', 'tools'), join(SRC, 'plugins')];

function filesUnder(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

/** Bỏ comment trước khi đếm — xem lý do dài trong design-system/guard.test.ts:
 *  không có bước này, một dòng giải thích *vì sao* đã bỏ `@tauri-apps` lại bị
 *  tính là một lần dùng `@tauri-apps`. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PLUGIN_FILES = filesUnder(PLUGIN_CODE);
const MANIFESTS = PLUGIN_FILES.filter(
  (f) => f.startsWith(join(SRC, 'plugins')) && f.endsWith('plugin.ts'),
);

interface Rule {
  key: keyof typeof baseline.limits;
  label: string;
  why: string;
  count(): { total: number; byFile: Array<[string, number]> };
}

function countPattern(files: string[], pattern: RegExp) {
  let total = 0;
  const byFile: Array<[string, number]> = [];
  for (const file of files) {
    const hits = stripComments(readFileSync(file, 'utf-8')).match(pattern)?.length ?? 0;
    if (hits > 0) {
      total += hits;
      byFile.push([relative(SRC, file), hits]);
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/** Thứ manifest được phép nhập. Bất cứ gì khác kéo theo rủi ro thật: import
 *  thẳng component tool sẽ phá code-split (chunk tool chui vào bundle khởi
 *  động), import lib nặng biến file metadata thành phụ thuộc lúc chạy. */
const MANIFEST_ALLOWED = new Set(['lucide-react', '@/platform']);

const RULES: Rule[] = [
  {
    key: 'directTauriInPluginCode',
    label: 'code plugin gọi thẳng @tauri-apps',
    why: 'Đi qua sdk.native / sdk.clipboard / sdk.http để quyền trong manifest có hiệu lực và audit ghi được.',
    count: () => countPattern(PLUGIN_FILES, /from '@tauri-apps\/[^']+'/g),
  },
  {
    key: 'sharedStoreInPluginCode',
    label: 'code plugin dùng thẳng store dùng chung',
    why: 'Đi qua sdk.storage (đã gắn namespace + audit), hoặc sdk.secrets nếu là credential.',
    count: () =>
      countPattern(PLUGIN_FILES, /from '@\/hooks\/usePersistentState'|from '@\/lib\/persistentStore'/g),
  },
  {
    key: 'manifestForeignImports',
    label: 'manifest nhập thứ ngoài danh sách cho phép',
    why: `Manifest chỉ được nhập ${[...MANIFEST_ALLOWED].join(' và ')} — nhập thứ khác phá code-split.`,
    count: () => {
      let total = 0;
      const byFile: Array<[string, number]> = [];
      for (const file of MANIFESTS) {
        const src = stripComments(readFileSync(file, 'utf-8'));
        // Chỉ xét import ở đầu file; `load: () => import('…')` là closure lười,
        // đúng thứ giữ được code-split, nên không tính.
        const specs = [...src.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
        const bad = specs.filter((s) => !MANIFEST_ALLOWED.has(s));
        if (bad.length > 0) {
          total += bad.length;
          byFile.push([`${relative(SRC, file)} → ${bad.join(', ')}`, bad.length]);
        }
      }
      return { total, byFile };
    },
  },
  {
    key: 'secretishKeyInSharedStore',
    label: 'khoá mang dáng credential nằm trong store dùng chung',
    why: 'Credential thuộc về kho bí mật (sdk.secrets / useSecretState), xem src/platform/secrets.ts.',
    count: () =>
      countPattern(
        filesUnder([SRC]).filter((f) => !f.includes(join('src', 'platform'))),
        /'devtool[:-][^']*(?:secret|token|password|passphrase|credential|apikey|api_key)[^']*'/gi,
      ),
  },
];

describe('rào chắn ranh giới Platform — ngưỡng lùi dần', () => {
  // Rào chắn của chính rào chắn: nếu đường dẫn đổi mà quét ra mảng rỗng thì mọi
  // luật dưới đây "xanh" vì không có gì để đếm — kiểu hỏng tệ nhất của một
  // guard, vì nó trông hệt như đã dọn sạch.
  it('quét ra đúng vùng code plugin, không phải mảng rỗng', () => {
    expect(PLUGIN_FILES.length).toBeGreaterThan(50);
    expect(MANIFESTS.length).toBe(PLUGINS.length);
  });

  for (const rule of RULES) {
    const limit = baseline.limits[rule.key];

    it(`${rule.label}: ≤ ${limit}`, () => {
      const { total, byFile } = rule.count();

      if (total > limit) {
        const worst = byFile.slice(0, 5).map(([f, n]) => `    ${n}× ${f}`).join('\n');
        expect.fail(
          `${rule.label}: ${total} (ngưỡng ${limit}, tăng ${total - limit}).\n` +
            `  ${rule.why}\n  Nhiều nhất ở:\n${worst}`,
        );
      }

      // Dọn xong mà quên hạ ngưỡng thì lần sau vi phạm lẻn về không ai biết.
      if (total < limit) {
        expect.fail(
          `${rule.label}: còn ${total}, thấp hơn ngưỡng ${limit} — tốt!\n` +
            `  Hạ "${rule.key}" xuống ${total} trong src/platform/baseline.json để khoá tiến độ này lại.`,
        );
      }

      expect(total).toBe(limit);
    });
  }
});
