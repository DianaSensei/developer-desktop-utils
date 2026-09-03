import { describe, expect, it } from 'vitest';
import { TOOL_ROUTES, allTools, TOOL_PATHS, toolPath } from '@/lib/toolRegistry';
import { TOOL_DEFS } from '@/lib/toolDefs';

/**
 * `TOOL_ROUTES` là bảng khai báo tay, RIÊNG BIỆT với `TOOL_DEFS` (nguồn sự
 * thật của danh sách tool trong sidebar). `allTools` ráp hai bảng lại bằng
 * `...TOOL_ROUTES[def.id]` — spread một `undefined` (khi id không khớp) là
 * hợp lệ về cú pháp JS và KHÔNG throw, nên một tool bị thiếu route sẽ lặng lẽ
 * mất `path`/`component` thay vì báo lỗi ngay lúc build. Test này đối chiếu
 * tính toàn vẹn giữa hai bảng — việc TypeScript không tự làm được vì
 * `TOOL_ROUTES` gõ theo `Record<string, …>` chứ không theo union id thật.
 */

describe('TOOL_ROUTES ↔ TOOL_DEFS — toàn vẹn dữ liệu', () => {
  it('mọi tool trong TOOL_DEFS đều có route khớp, đủ cả path lẫn component', () => {
    for (const def of TOOL_DEFS) {
      const route = TOOL_ROUTES[def.id];
      expect(route, `tool "${def.id}" thiếu trong TOOL_ROUTES`).toBeDefined();
      expect(route.path, `tool "${def.id}"`).toBeTruthy();
      expect(route.component, `tool "${def.id}"`).toBeDefined();
    }
  });

  it('không hai tool nào trỏ chung một đường dẫn (route trùng thì router chỉ vào được một tool)', () => {
    const paths = Object.values(TOOL_ROUTES).map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('mỗi đường dẫn bắt đầu bằng "/" — router dùng absolute path', () => {
    for (const [id, route] of Object.entries(TOOL_ROUTES)) {
      expect(route.path.startsWith('/'), id).toBe(true);
    }
  });
});

describe('allTools', () => {
  it('có đúng số lượng: mọi tool trong TOOL_DEFS cộng thêm đúng một mục "settings"', () => {
    expect(allTools).toHaveLength(TOOL_DEFS.length + 1);
    expect(allTools.at(-1)?.featureId).toBe('settings');
  });

  it('không featureId nào bị trùng lặp', () => {
    const ids = allTools.map((t) => t.featureId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mỗi tool mang theo đủ path và component thật (không phải undefined do spread hỏng)', () => {
    for (const t of allTools) {
      expect(t.path, t.featureId).toBeTruthy();
      expect(t.component, t.featureId).toBeDefined();
    }
  });

  it('cờ experimental/keywords có giá trị mặc định hợp lý khi TOOL_DEFS không khai báo', () => {
    const withoutExtras = TOOL_DEFS.find((d) => d.experimental === undefined && d.keywords === undefined);
    if (withoutExtras) {
      const t = allTools.find((x) => x.featureId === withoutExtras.id)!;
      expect(t.experimental).toBe(false);
      expect(t.keywords).toEqual([]);
    }
  });
});

describe('TOOL_PATHS / toolPath', () => {
  it('có một entry cho mỗi tool trong allTools, kể cả "settings"', () => {
    expect(TOOL_PATHS.size).toBe(allTools.length);
    expect(TOOL_PATHS.get('settings')).toBe('/settings');
  });

  it('toolPath() tra đúng đường dẫn cho id hợp lệ', () => {
    const [first] = TOOL_DEFS;
    expect(toolPath(first.id)).toBe(TOOL_ROUTES[first.id].path);
  });

  it('toolPath() với id không tồn tại thì rơi về "/" thay vì trả undefined', () => {
    expect(toolPath('this-tool-does-not-exist')).toBe('/');
  });
});
