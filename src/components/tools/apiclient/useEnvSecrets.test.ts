import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createPluginSdk, getPlugin, clearSecrets, secretGet } from '@/platform';
import { usePersistentState } from '@/hooks/usePersistentState';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { useEnvSecrets } from './useEnvSecrets';
import { envSecretKey } from './envSecrets';
import type { Environment } from './types';

/**
 * Điểm đáng lo nhất của việc tách bí mật khỏi `environments` không phải là chia
 * đúng, mà là CỬA SỔ trước khi kho đọc xong: ghi vào lúc đó sẽ đẩy một bản đồ
 * rỗng đè lên token thật của người dùng. Phần lớn ca dưới đây canh đúng chỗ đó.
 */

const ENV_KEY = 'devtool:apiclient:environments';
const sdk = createPluginSdk(getPlugin('api-client')!);

/** Ghép lại đúng cách store.ts dùng hook: phần lưu trữ thường do nơi gọi giữ. */
function useSubject() {
  const [stripped, setStripped] = usePersistentState<Environment[]>(ENV_KEY, [], { debounceMs: 300 });
  return useEnvSecrets(sdk, stripped, setStripped);
}

function env(value: string): Environment[] {
  return [
    {
      id: 'e1',
      name: 'Prod',
      variables: [
        { id: 'v1', key: 'baseUrl', value: 'https://api.example.com', enabled: true },
        { id: 'v2', key: 'token', value, enabled: true, secret: true },
      ],
    },
  ];
}

beforeEach(async () => {
  await clearSecrets();
  storageRemove(ENV_KEY);
});

afterEach(async () => {
  await clearSecrets();
  storageRemove(ENV_KEY);
});

describe('useEnvSecrets', () => {
  it('di trú token nằm inline của bản cũ sang kho, và dọn khỏi store thường', async () => {
    storageSet(ENV_KEY, JSON.stringify(env('token-that')));

    const { result } = renderHook(() => useSubject());
    await waitFor(() => expect(result.current[2]).toBe(true));

    // Người dùng vẫn thấy đúng giá trị…
    await waitFor(() => expect(result.current[0][0].variables[1].value).toBe('token-that'));
    // …nhưng store thường không còn giữ nó nữa.
    await waitFor(() => expect(storageGet(ENV_KEY)).not.toContain('token-that'));
    expect(storageGet(ENV_KEY)).toContain('https://api.example.com');

    const stored = JSON.parse((await secretGet('api-client', 'envSecrets')) ?? '{}');
    expect(stored[envSecretKey('e1', 'v2')]).toBe('token-that');
  });

  it('giá trị đã có trong kho thắng tàn dư inline, không bị bản cũ đè ngược', async () => {
    await sdk.secrets.set('envSecrets', JSON.stringify({ [envSecretKey('e1', 'v2')]: 'moi' }));
    storageSet(ENV_KEY, JSON.stringify(env('cu')));

    const { result } = renderHook(() => useSubject());
    await waitFor(() => expect(result.current[2]).toBe(true));
    await waitFor(() => expect(result.current[0][0].variables[1].value).toBe('moi'));
  });

  it('ghi mới thì token vào kho, phần còn lại vào store thường', async () => {
    const { result } = renderHook(() => useSubject());
    await waitFor(() => expect(result.current[2]).toBe(true));

    act(() => result.current[1](env('token-moi')));

    await waitFor(() => {
      const raw = storageGet(ENV_KEY);
      expect(raw).toContain('https://api.example.com');
      expect(raw).not.toContain('token-moi');
    });
    await waitFor(async () =>
      expect(await secretGet('api-client', 'envSecrets')).toContain('token-moi'),
    );
    // Và bên ngoài hook vẫn nhìn thấy tài liệu đầy đủ.
    expect(result.current[0][0].variables[1].value).toBe('token-moi');
  });

  it('không có biến secret thì không tạo gì trong kho', async () => {
    const { result } = renderHook(() => useSubject());
    await waitFor(() => expect(result.current[2]).toBe(true));

    act(() =>
      result.current[1]([
        { id: 'e1', name: 'Prod', variables: [{ id: 'v1', key: 'baseUrl', value: 'x', enabled: true }] },
      ]),
    );

    await waitFor(() => expect(storageGet(ENV_KEY)).toContain('baseUrl'));
    expect(JSON.parse((await secretGet('api-client', 'envSecrets')) ?? '{}')).toEqual({});
  });
});
