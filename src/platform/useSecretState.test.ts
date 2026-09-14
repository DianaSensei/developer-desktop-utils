import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { FileJson } from 'lucide-react';
import { definePlugin } from '@/platform/manifest';
import { createPluginSdk } from '@/platform/sdk';
import { clearSecrets, secretGet, secretSet } from '@/platform/secrets';
import { useSecretState } from '@/platform/useSecretState';

const sdk = createPluginSdk(
  definePlugin({
    id: 'demo',
    label: 'Demo',
    icon: FileJson,
    description: 'Plugin giả lập dùng cho test.',
    route: '/demo',
    order: 10,
    defaultEnabled: true,
    permissions: ['secrets'],
    sdk: '^1.0.0',
    load: async () => () => null,
  }),
);

beforeEach(async () => {
  await clearSecrets();
});

afterEach(async () => {
  await clearSecrets();
});

describe('useSecretState', () => {
  it('đọc xong mới báo ready, và KHÔNG đè giá trị khởi tạo lên dữ liệu đã lưu', async () => {
    await secretSet('demo', 'accounts', JSON.stringify(['da-luu']));

    const { result } = renderHook(() => useSecretState<string[]>(sdk, 'accounts', []));

    // Lần render đầu chưa có dữ liệu — đây chính là cửa sổ mà một effect ghi
    // thiếu chốt `ready` sẽ đẩy `[]` đè lên dữ liệu thật.
    expect(result.current[2]).toBe(false);
    expect(result.current[0]).toEqual([]);

    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[0]).toEqual(['da-luu']);
    expect(await secretGet('demo', 'accounts')).toBe(JSON.stringify(['da-luu']));
  });

  it('ghi lại vào kho sau khi state đổi', async () => {
    const { result } = renderHook(() => useSecretState<string[]>(sdk, 'accounts', []));
    await waitFor(() => expect(result.current[2]).toBe(true));

    act(() => result.current[1](['moi']));

    await waitFor(async () =>
      expect(await secretGet('demo', 'accounts')).toBe(JSON.stringify(['moi'])),
    );
  });

  it('blob hỏng được giữ lại trước khi bị ghi đè, thay vì mất luôn', async () => {
    await secretSet('demo', 'accounts', '{khong-phai-json');

    const { result } = renderHook(() => useSecretState<string[]>(sdk, 'accounts', []));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(await secretGet('demo', 'accounts.corrupt')).toBe('{khong-phai-json');
    expect(result.current[0]).toEqual([]);
  });

  it('thiếu quyền "secrets" thì vẫn ready với giá trị khởi tạo, không treo màn hình', async () => {
    const noPerm = createPluginSdk(
      definePlugin({
        id: 'demo',
        label: 'Demo',
        icon: FileJson,
        description: 'Plugin giả lập dùng cho test.',
        route: '/demo',
        order: 10,
        defaultEnabled: true,
        permissions: [],
        sdk: '^1.0.0',
        load: async () => () => null,
      }),
    );

    const { result } = renderHook(() => useSecretState<string[]>(noPerm, 'accounts', ['mac-dinh']));
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[0]).toEqual(['mac-dinh']);
  });
});
