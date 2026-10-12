import { describe, expect, it } from 'vitest';
import { TOOL_DEFS } from '@/lib/toolDefs';
import {
  TOOL_GROUPS,
  GROUP_OF_TOOL,
  buildNavEntries,
  countFavoriteEntries,
  clusterToolOrder,
} from '@/lib/toolGroups';

const ALL = new Set(TOOL_DEFS.map((t) => t.id));
const idsOf = (entries: ReturnType<typeof buildNavEntries>) => entries.map((e) => e.key);

describe('bản đồ nhóm', () => {
  it('mọi id trong nhóm đều là tool có thật', () => {
    // A renamed tool missing from its group would vanish from the sidebar.
    for (const g of TOOL_GROUPS) {
      for (const id of g.toolIds) {
        expect(ALL.has(id), `nhóm "${g.id}" trỏ tới tool không tồn tại: ${id}`).toBe(true);
      }
    }
  });

  it('không tool nào thuộc hai nhóm', () => {
    const seen = new Set<string>();
    for (const g of TOOL_GROUPS) {
      for (const id of g.toolIds) {
        expect(seen.has(id), `${id} nằm ở nhiều nhóm`).toBe(false);
        seen.add(id);
      }
    }
  });

  it('không nhóm nào chỉ có một tool', () => {
    // A one-tool group is pointless; remove it from TOOL_GROUPS.
    for (const g of TOOL_GROUPS) {
      expect(g.toolIds.length, `nhóm "${g.id}" chỉ có một tool`).toBeGreaterThan(1);
    }
  });
});

describe('buildNavEntries', () => {
  it('gộp mọi tool thành đúng số mục, không mất tool nào', () => {
    const entries = buildNavEntries({ enabledIds: ALL });
    expect(entries).toHaveLength(14);

    const flat = entries.flatMap((e) => e.tools.map((t) => t.id));
    expect(new Set(flat).size).toBe(TOOL_DEFS.length);
    expect(flat).toHaveLength(TOOL_DEFS.length);
  });

  it('bỏ qua tool đang tắt', () => {
    const enabled = new Set(ALL);
    enabled.delete('markdown');
    const entries = buildNavEntries({ enabledIds: enabled });
    const format = entries.find((e) => e.key === 'sql-formatter' || e.key === 'g-format');
    // Only SQL is left in Format, so it collapses to SQL's own entry.
    expect(format?.isGroup).toBe(false);
    expect(format?.label).toBe('SQL Formatter');
  });

  it('nhóm còn một tool bật thì thoái thành mục đơn', () => {
    const enabled = new Set(['json', 'regex']);
    const entries = buildNavEntries({ enabledIds: enabled });
    expect(entries.every((e) => !e.isGroup)).toBe(true);
    expect(idsOf(entries).sort()).toEqual(['json', 'regex']);
  });

  it('nhóm lấy vị trí của thành viên đứng sớm nhất', () => {
    // The group takes its earliest member's position.
    const entries = buildNavEntries({
      enabledIds: ALL,
      order: ['qrcode', 'regex', 'generator', 'json'],
    });
    // qrcode (in Generate) is first in `order`, so Generate leads.
    expect(idsOf(entries)[0]).toBe('g-generate');
  });

  it('yêu thích nổi lên đầu, giữ thứ tự đánh dấu', () => {
    const entries = buildNavEntries({
      enabledIds: ALL,
      favorites: ['network', 'regex'],
    });
    expect(idsOf(entries).slice(0, 2)).toEqual(['network', 'regex']);
  });

  it('yêu thích một tool trong nhóm thì nổi cả nhóm', () => {
    // Favorites are still tool ids; no migration needed.
    const entries = buildNavEntries({ enabledIds: ALL, favorites: ['text-counter'] });
    expect(idsOf(entries)[0]).toBe('g-text');
  });

  it('tool mới chưa có trong thứ tự đã lưu thì xuống cuối', () => {
    const entries = buildNavEntries({
      enabledIds: new Set(['regex', 'network']),
      order: ['network'],
    });
    expect(idsOf(entries)).toEqual(['network', 'regex']);
  });

  it('danh sách rỗng khi không tool nào bật', () => {
    expect(buildNavEntries({ enabledIds: new Set() })).toEqual([]);
  });

  it('thứ tự tab con theo đúng bản đồ, không theo thứ tự sidebar', () => {
    // Sub-tab order is fixed by the group, not by sidebar reordering.
    const entries = buildNavEntries({ enabledIds: ALL, order: ['deduplicate', 'text-counter'] });
    const text = entries.find((e) => e.key === 'g-text');
    expect(text?.tools.map((t) => t.id)).toEqual([
      'text-transform',
      'text-counter',
      'deduplicate',
    ]);
  });
});

describe('countFavoriteEntries', () => {
  it('đếm mục có ít nhất một tool được yêu thích', () => {
    const favorites = ['text-counter', 'regex'];
    const entries = buildNavEntries({ enabledIds: ALL, favorites });
    expect(countFavoriteEntries(entries, favorites)).toBe(2);
  });

  it('trả 0 khi không có yêu thích', () => {
    const entries = buildNavEntries({ enabledIds: ALL });
    expect(countFavoriteEntries(entries, [])).toBe(0);
  });
});

describe('GROUP_OF_TOOL', () => {
  it('tool đứng riêng không có trong bản đồ', () => {
    expect(GROUP_OF_TOOL.has('api-client')).toBe(false);
    expect(GROUP_OF_TOOL.has('kafka-explorer')).toBe(false);
    expect(GROUP_OF_TOOL.get('text-counter')?.id).toBe('g-text');
  });
});

describe('clusterToolOrder', () => {
  it('kéo các tool cùng nhóm đứng liền nhau, tại vị trí thành viên sớm nhất', () => {
    // qrcode's group (generator, qrcode, lucky-wheel) moves up right after
    // api-client, in the group's own toolIds order.
    const order = ['api-client', 'qrcode', 'text-counter', 'generator', 'lucky-wheel'];
    expect(clusterToolOrder(order)).toEqual([
      'api-client', 'generator', 'qrcode', 'lucky-wheel', 'text-counter',
    ]);
  });

  it('không đổi thứ tự khi không có nhóm nào', () => {
    const order = ['api-client', 'mock-server', 'regex'];
    expect(clusterToolOrder(order)).toEqual(order);
  });

  it('giữ nguyên danh sách khi input rỗng', () => {
    expect(clusterToolOrder([])).toEqual([]);
  });

  it('nhóm chỉ còn một thành viên trong input thì đứng y nguyên vị trí đó', () => {
    // As when search leaves one member: absent members are not pulled in.
    const order = ['api-client', 'qrcode', 'text-counter'];
    expect(clusterToolOrder(order)).toEqual(order);
  });

  it('không đánh rơi hay nhân đôi tool nào so với danh sách đầy đủ', () => {
    const order = TOOL_DEFS.map((t) => t.id);
    const clustered = clusterToolOrder(order);
    expect(clustered).toHaveLength(order.length);
    expect(new Set(clustered)).toEqual(new Set(order));
  });
});
