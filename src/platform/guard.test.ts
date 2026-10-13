import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import baseline from './baseline.json';
import { PLUGINS } from '@/platform';

/**
 * Platform boundary guard, using the same ratchet as
 * `design-system/guard.test.ts`.
 *
 * Counts are frozen in baseline.json and may only go down.
 * `directTauriInPluginCode` is 0, so built-in plugin code reaches Tauri only
 * through the SDK; `sharedStoreInPluginCode` allows two migration exceptions.
 *
 * `manifestForeignImports` and `secretishKeyInSharedStore` are invariants,
 * not debt: manifests stay declarative and secrets never return to the
 * shared store (the latter is a key-name tripwire, not proof).
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

/** Strips comments before counting, so a comment that mentions
 *  `@tauri-apps` is not counted as a use. */
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

/** What a manifest may import. Importing a tool component would break code
 *  splitting; importing a heavy library would make metadata a runtime dependency. */
const MANIFEST_ALLOWED = new Set(['lucide-react', '@/platform']);

const RULES: Rule[] = [
  {
    key: 'directTauriInPluginCode',
    label: 'code plugin gọi thẳng @tauri-apps',
    why: 'Đi qua sdk.native / sdk.files / sdk.clipboard / sdk.http để quyền trong manifest có hiệu lực và audit ghi được.',
    // Counts both static imports and `await import('@tauri-apps/…')`; the
    // codebase mostly uses dynamic imports.
    count: () => countPattern(PLUGIN_FILES, /(?:from|import\()\s*'@tauri-apps\/[^']+'/g),
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
        // Only top-level imports count; `load: () => import('…')` is the lazy
        // closure that keeps code splitting.
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
    key: 'anchorDownloadInPluginCode',
    label: 'code plugin tải file bằng <a download>',
    why: 'Trong webview Tauri thẻ đó không ghi ra file — dùng saveTextFile / saveBinaryFile của lib/fileio.ts (có nhánh hộp Save của OS).',
    // QR Code and Time Tracker use this tag only in their web fallback;
    // count files without a Tauri branch.
    count: () => {
      let total = 0;
      const byFile: Array<[string, number]> = [];
      for (const file of PLUGIN_FILES) {
        const src = stripComments(readFileSync(file, 'utf-8'));
        const hits = src.match(/\.download\s*=/g)?.length ?? 0;
        if (hits > 0 && !/isTauri|IS_TAURI/.test(src)) {
          total += hits;
          byFile.push([relative(SRC, file), hits]);
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
  // Guard the guard: if the paths change and nothing is scanned, every rule
  // would pass vacuously.
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

      // Lower the threshold after a cleanup so regressions are caught.
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
