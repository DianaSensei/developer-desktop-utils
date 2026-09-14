import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createPluginSdk, getPlugin } from '@/platform';
import { migrateLegacyKey } from '@/platform/usePluginState';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';

/**
 * Bảo đảm cho đợt di trú khoá lưu trữ.
 *
 * Việc chuyển tool sang `usePluginState` đổi CHỖ LƯU của gần như mọi thứ người
 * dùng đã lưu: `devtool:redis:selectedConnId` thành
 * `devtool:redis-client:selectedConnId`, và tương tự cho 157 khoá khác. Một cặp
 * khoá khai sai ở bất kỳ đâu là dữ liệu của người dùng biến mất mà không có lỗi
 * nào báo ra — họ chỉ thấy app "tự reset".
 *
 * Bộ test này đọc THẲNG mã nguồn để lấy mọi cặp (key, legacyKey) đang khai, rồi
 * kiểm hai điều trên từng cặp: nó đúng hình dạng, và nó thật sự chuyển được dữ
 * liệu. Đọc mã nguồn thay vì liệt kê tay là có chủ ý — một danh sách chép tay sẽ
 * lạc hậu ngay lần chuyển đổi kế tiếp, mà đó đúng là lúc cần nó nhất.
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
    // Một file thuộc đúng một plugin; id lấy từ chính lời gọi lấy SDK của nó.
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
    // Rào chắn của chính rào chắn: regex hỏng thì mọi ca dưới đây "xanh" vì
    // không có gì để kiểm — kiểu hỏng tệ nhất, vì nó trông như đã an toàn.
    expect(PAIRS.length).toBeGreaterThan(100);
  });

  it('legacyKey phải bắt đầu bằng "devtool:" và KẾT THÚC bằng đúng key', () => {
    // Hai quy ước cùng tồn tại, và đó là chủ ý: Redis Client bỏ hẳn tiền tố cũ
    // ('devtool:redis:selectedConnId' → key 'selectedConnId') vì nó chỉ có một
    // không gian khoá; Encode·Hash·Encrypt thì GIỮ tiền tố phụ
    // ('devtool:codec:input' → key 'codec:input') vì bốn sub-tool trong cùng
    // một plugin sẽ giẫm khoá lên nhau nếu bỏ.
    //
    // Nên luật chung chỉ có thể là quan hệ hậu tố. Nó vẫn bắt được lỗi hay gặp
    // nhất — gõ sai phần `key`, thứ quyết định dữ liệu hạ cánh ở đâu.
    const wrong = PAIRS.filter(
      (p) => !p.legacyKey.startsWith('devtool:') || !p.legacyKey.endsWith(p.key),
    );
    expect(
      wrong.map((p) => `${p.file}: key="${p.key}" không khớp legacyKey="${p.legacyKey}"`),
    ).toEqual([]);
  });

  it('chấm live seed đúng khoá mà tool thật sự ghi', () => {
    // Đây là lỗi tôi suýt để lọt: `liveConnections.ts` seed lúc NẠP MODULE, tức
    // trước khi component nào kịp di trú khoá. Nếu khoá trong seed lệch khỏi
    // khoá tool thật sự ghi, chấm live sẽ sai — mà không có lỗi nào báo ra.
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
    // Thiếu quyền `secrets` là lỗi im lặng đắt nhất trong cả đợt: di trú vẫn
    // chép dữ liệu sang kho (nó gọi thẳng, không qua SDK), nhưng tool đọc lại
    // bằng `useSecretState` thì bị chặn và hiện ra RỖNG — trông y như mất dữ
    // liệu, trong khi dữ liệu vẫn nằm đó.
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
    // Và bảng không được rỗng: regex hỏng thì ca này cũng "xanh" một cách vô nghĩa.
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
