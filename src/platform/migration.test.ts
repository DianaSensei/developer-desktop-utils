import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createPluginSdk, getPlugin } from '@/platform';
import { migrateLegacyKey } from '@/platform/usePluginState';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';

/**
 * Guards the storage key migration.
 *
 * Moving tools to `usePluginState` changed where saved data lives (e.g.
 * `devtool:redis:selectedConnId` → `devtool:redis-client:selectedConnId`).
 * A wrong key pair silently loses user data. These tests read the source to
 * collect every (key, legacyKey) pair, so the list cannot go stale, and check
 * each pair's shape and that it really migrates data.
 */

const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Pair {
  file: string;
  pluginId: string;
  key: string;
  legacyKey: string;
}

function collectPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const file of sourceFiles(join(SRC, 'components', 'tools')).concat(sourceFiles(join(SRC, 'plugins')))) {
    const src = readFileSync(file, 'utf-8');
    // Each file belongs to one plugin; the id comes from its SDK lookup.
    const owner = /use?PluginSdkFor\('([a-z0-9-]+)'\)|getPluginSdk\('([a-z0-9-]+)'\)/.exec(src);
    const pluginId = owner?.[1] ?? owner?.[2];
    if (!pluginId) continue;

    for (const m of src.matchAll(/usePluginState(?:<[^>]*>)?\(\s*sdk,\s*'([^']+)'[\s\S]*?legacyKey:\s*'([^']+)'/g)) {
      pairs.push({ file: relative(SRC, file), pluginId, key: m[1], legacyKey: m[2] });
    }
    for (const m of src.matchAll(/migrateLegacyKey\(sdk,\s*([A-Z_]+|'[^']+'),\s*'([^']+)'\)/g)) {
      const key = m[1].startsWith("'") ? m[1].slice(1, -1)
        : new RegExp(`const ${m[1]} = '([^']+)'`).exec(src)?.[1];
      if (key) pairs.push({ file: relative(SRC, file), pluginId, key, legacyKey: m[2] });
    }
  }
  return pairs;
}

const PAIRS = collectPairs();

describe('di trú khoá lưu trữ', () => {
  it('quét ra được các cặp khoá, không phải mảng rỗng', () => {
    // Guard the guard: a broken regex would make every case pass vacuously.
    expect(PAIRS.length).toBeGreaterThan(100);
  });

  it('legacyKey phải bắt đầu bằng "devtool:" và KẾT THÚC bằng đúng key', () => {
    // Two conventions coexist: some plugins drop the old prefix
    // ('devtool:redis:selectedConnId' → 'selectedConnId'), others keep a
    // sub-prefix ('devtool:codec:input' → 'codec:input') so sub-tools do not
    // collide. So the rule is a suffix relation, which still catches typos
    // in `key`.
    const wrong = PAIRS.filter(
      (p) => !p.legacyKey.startsWith('devtool:') || !p.legacyKey.endsWith(p.key),
    );
    expect(
      wrong.map((p) => `${p.file}: key="${p.key}" không khớp legacyKey="${p.legacyKey}"`),
    ).toEqual([]);
  });

  it('chấm live seed đúng khoá mà tool thật sự ghi', () => {
    // liveConnections.ts seeds at module load, before any component
    // migrates its keys, so its keys must match what tools write.
    const src = readFileSync(join(SRC, 'lib', 'liveConnections.ts'), 'utf-8');
    const problems: string[] = [];

    for (const m of src.matchAll(/seed\('([a-z0-9-]+)',\s*'([^']+)'(?:,\s*'([^']+)')?\)/g)) {
      const [, featureId, seedKey, seedLegacy] = m;
      const pair = PAIRS.find((p) => `devtool:${p.pluginId}:${p.key}` === seedKey);
      if (!pair) {
        problems.push(`seed('${featureId}', '${seedKey}') không khớp khoá nào tool đang ghi`);
        continue;
      }
      if (pair.pluginId !== featureId) {
        problems.push(`seed('${featureId}', …) nhưng khoá thuộc plugin "${pair.pluginId}"`);
      }
      if (seedLegacy !== pair.legacyKey) {
        problems.push(
          `seed('${featureId}') dùng khoá cũ '${seedLegacy}' còn tool khai '${pair.legacyKey}'`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it('không hai chỗ nào cùng nhận một khoá cũ — nếu có, ai mount trước sẽ nuốt mất của người kia', () => {
    const seen = new Map<string, Pair>();
    const clashes: string[] = [];
    for (const p of PAIRS) {
      const prev = seen.get(p.legacyKey);
      if (prev && (prev.pluginId !== p.pluginId || prev.key !== p.key)) {
        clashes.push(`${p.legacyKey}: ${prev.file} (${prev.pluginId}/${prev.key}) ↔ ${p.file} (${p.pluginId}/${p.key})`);
      }
      seen.set(p.legacyKey, p);
    }
    expect(clashes).toEqual([]);
  });

  it('mọi plugin được nhắc tới đều có thật trong registry', () => {
    const unknown = [...new Set(PAIRS.map((p) => p.pluginId))].filter((id) => !getPlugin(id));
    expect(unknown).toEqual([]);
  });
});

describe('di trú sang kho bí mật', () => {
  it('mọi khoá trong bảng MIGRATIONS trỏ tới plugin có thật VÀ plugin đó khai quyền "secrets"', () => {
    // Without the `secrets` permission, migrated data is in the vault but
    // `useSecretState` is denied and shows nothing, which looks like data loss.
    const src = readFileSync(join(SRC, 'platform', 'secrets.ts'), 'utf-8');
    const problems: string[] = [];

    for (const m of src.matchAll(/\{ from: '([^']+)', pluginId: '([^']+)', key: '([^']+)' \}/g)) {
      const [, from, pluginId] = m;
      const plugin = getPlugin(pluginId);
      if (!plugin) {
        problems.push(`${from} → plugin "${pluginId}" không có trong registry`);
      } else if (!plugin.permissions.includes('secrets')) {
        problems.push(`${from} → plugin "${pluginId}" thiếu quyền "secrets"`);
      }
    }

    expect(problems).toEqual([]);
    // The table must not be empty either.
    expect([...src.matchAll(/\{ from: '([^']+)', pluginId:/g)].length).toBeGreaterThan(0);
  });
});

describe('di trú khoá lưu trữ — chạy thật trên từng cặp', () => {
  beforeEach(() => {
    for (const p of PAIRS) {
      storageRemove(p.legacyKey);
      storageRemove(`devtool:${p.pluginId}:${p.key}`);
    }
  });

  it('mỗi cặp thật sự chuyển được dữ liệu sang khoá mới và dọn khoá cũ', () => {
    const failures: string[] = [];

    for (const p of PAIRS) {
      const sdk = createPluginSdk(getPlugin(p.pluginId)!);
      const sentinel = JSON.stringify(`gia-tri-cu-cua-${p.key}`);
      storageSet(p.legacyKey, sentinel);

      migrateLegacyKey(sdk, p.key, p.legacyKey);

      const moved = storageGet(`devtool:${p.pluginId}:${p.key}`);
      if (moved !== sentinel) failures.push(`${p.file}: ${p.legacyKey} không sang được khoá mới`);
      if (storageGet(p.legacyKey) !== null) failures.push(`${p.file}: ${p.legacyKey} vẫn còn sau khi chuyển`);
    }

    expect(failures).toEqual([]);
  });

  it('giá trị đã có ở khoá mới không bị khoá cũ đè lên', () => {
    const p = PAIRS[0];
    const sdk = createPluginSdk(getPlugin(p.pluginId)!);
    storageSet(p.legacyKey, JSON.stringify('cu'));
    storageSet(`devtool:${p.pluginId}:${p.key}`, JSON.stringify('moi'));

    migrateLegacyKey(sdk, p.key, p.legacyKey);

    expect(storageGet(`devtool:${p.pluginId}:${p.key}`)).toBe(JSON.stringify('moi'));
  });
});
