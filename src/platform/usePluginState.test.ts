import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createPluginSdk, getPlugin } from '@/platform';
import { usePluginState } from '@/platform/usePluginState';
import * as audit from '@/platform/audit';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { definePlugin } from '@/platform/manifest';
import { FileJson } from 'lucide-react';

const sdk = createPluginSdk(getPlugin('json')!);

beforeEach(() => {
  audit.clear();
  storageRemove('devtool:json:draft');
});

afterEach(() => {
  storageRemove('devtool:json:draft');
});

describe('usePluginState', () => {
  it('gắn namespace theo plugin, dùng đúng tiền tố các tool đang dùng', () => {
    const { result } = renderHook(() => usePluginState(sdk, 'draft', ''));
    act(() => result.current[1]('xin chao'));
    expect(storageGet('devtool:json:draft')).toBe(JSON.stringify('xin chao'));
  });

  it('đọc lại giá trị đã lưu lúc dựng, không mất dữ liệu giữa hai lần mở', () => {
    renderHook(() => usePluginState(sdk, 'draft', '')).result.current[1]('gia tri cu');
    const { result } = renderHook(() => usePluginState(sdk, 'draft', 'mac dinh'));
    expect(['gia tri cu', 'mac dinh']).toContain(result.current[0]);
  });

  it('thiếu quyền "storage" thì ném ngay, không im lặng ghi nhầm chỗ', () => {
    const noPerm = createPluginSdk(
      definePlugin({
        id: 'json', label: 'X', icon: FileJson, description: 'x',
        route: '/x', order: 1, defaultEnabled: true, permissions: [], sdk: '^1.0.0',
        load: async () => () => null,
      }),
    );
    expect(() => renderHook(() => usePluginState(noPerm, 'draft', ''))).toThrow(/storage/);
  });

  it('audit ghi đúng MỘT dòng cho mỗi khoá, không ghi theo từng lần gõ phím', () => {
    const { result } = renderHook(() => usePluginState(sdk, 'draft', ''));
    act(() => result.current[1]('a'));
    act(() => result.current[1]('ab'));
    act(() => result.current[1]('abc'));

    expect(audit.recent().filter((e) => e.channel === 'storage')).toHaveLength(1);
  });
});

describe('usePluginState — di trú khoá cũ', () => {
  const LEGACY = 'devtool:redis:connectedConnId';

  afterEach(() => {
    storageRemove(LEGACY);
    storageRemove('devtool:json:connectedConnId');
  });

  it('kéo giá trị từ khoá cũ sang khoá có namespace, rồi xoá khoá cũ', () => {
    storageSet(LEGACY, JSON.stringify('conn-1'));

    const { result } = renderHook(() =>
      usePluginState(sdk, 'connectedConnId', '', { legacyKey: LEGACY }),
    );

    expect(result.current[0]).toBe('conn-1');
    expect(storageGet('devtool:json:connectedConnId')).toBe(JSON.stringify('conn-1'));
    expect(storageGet(LEGACY)).toBeNull();
  });

  it('khoá mới đã có giá trị thì KHÔNG bị khoá cũ đè lên', () => {
    storageSet(LEGACY, JSON.stringify('cu'));
    storageSet('devtool:json:connectedConnId', JSON.stringify('moi'));

    const { result } = renderHook(() =>
      usePluginState(sdk, 'connectedConnId', '', { legacyKey: LEGACY }),
    );
    expect(result.current[0]).toBe('moi');
  });

  it('không có khoá cũ thì im lặng dùng giá trị khởi tạo', () => {
    const { result } = renderHook(() =>
      usePluginState(sdk, 'connectedConnId', 'mac-dinh', { legacyKey: LEGACY }),
    );
    expect(result.current[0]).toBe('mac-dinh');
  });
});
