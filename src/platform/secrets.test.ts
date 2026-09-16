import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSecrets,
  migrateSecretsFromSharedStore,
  secretDelete,
  secretGet,
  secretKeys,
  secretSet,
  vaultKey,
} from '@/platform/secrets';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';

/**
 * Trong jsdom `isTauri` là false, nên bộ test này chạy đường dự phòng của bản
 * web — cũng chính là đường dễ làm sai nhất: nếu nó lỡ dùng `localStorage`, bí
 * mật sẽ bị `initPersistentStore()` hút ngược vào cache dùng chung ở lần khởi
 * động sau, tức việc tách mặt phẳng khoá coi như không có tác dụng.
 */

beforeEach(async () => {
  await clearSecrets();
  localStorage.clear();
});

afterEach(async () => {
  await clearSecrets();
  localStorage.clear();
});

describe('kho bí mật', () => {
  it('khoá gắn theo plugin', () => {
    expect(vaultKey('2fa', 'accounts')).toBe('2fa/accounts');
  });

  it('ghi/đọc/xoá một vòng trọn vẹn', async () => {
    expect(await secretGet('2fa', 'accounts')).toBeNull();
    await secretSet('2fa', 'accounts', 'JBSWY3DP');
    expect(await secretGet('2fa', 'accounts')).toBe('JBSWY3DP');
    await secretDelete('2fa', 'accounts');
    expect(await secretGet('2fa', 'accounts')).toBeNull();
  });

  it('KHÔNG chạm vào localStorage — đó là nơi store dùng chung sẽ hút lên', async () => {
    await secretSet('2fa', 'accounts', 'JBSWY3DP');
    expect(localStorage.length).toBe(0);
    expect(JSON.stringify(Object.values(localStorage))).not.toContain('JBSWY3DP');
    // …và cũng không đọc được qua cửa của store dùng chung.
    expect(storageGet('devtool:2fa:accounts')).toBeNull();
    expect(storageGet('2fa/accounts')).toBeNull();
  });

  it('secretKeys chỉ trả khoá của đúng plugin đó', async () => {
    await secretSet('2fa', 'accounts', 'a');
    await secretSet('2fa', 'backup', 'b');
    await secretSet('api-client', 'tokens', 'c');
    expect(await secretKeys('2fa')).toEqual(['accounts', 'backup']);
    expect(await secretKeys('api-client')).toEqual(['tokens']);
    expect(await secretKeys('khong-co')).toEqual([]);
  });
});

/**
 * Đường di trú THẬT là đường desktop, nên phần dưới đây dựng lại nó: bật cờ
 * Tauri trước khi nạp module (giống mcpBridge.test.ts) và thay kho Rust bằng một
 * bản giả trong bộ nhớ. Kiểm nó ở đường web — nơi duy nhất chạy được nếu không
 * làm vậy — sẽ là kiểm đúng cái nhánh mà người dùng thật không bao giờ đi qua.
 */
describe('di trú từ store dùng chung — đường desktop', () => {
  async function loadDesktopSecrets() {
    vi.resetModules();
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};

    const vault = new Map<string, string>();
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: async (cmd: string, args: Record<string, string>) => {
        if (cmd === 'secret_vault_get') return vault.get(args.key) ?? null;
        if (cmd === 'secret_vault_set') { vault.set(args.key, args.value); return; }
        if (cmd === 'secret_vault_delete') { vault.delete(args.key); return; }
        if (cmd === 'secret_vault_keys') return [...vault.keys()];
        if (cmd === 'secret_vault_clear') { vault.clear(); return; }
        throw new Error(`lệnh không mong đợi: ${cmd}`);
      },
    }));
    vi.doMock('@tauri-apps/plugin-store', () => ({
      load: async () => ({
        entries: async () => [],
        clear: async () => {},
        save: async () => {},
      }),
    }));
    // `vi.resetModules()` cũng dựng lại `persistentStore`, nên cache đồng bộ
    // của nó là một instance KHÁC với instance các ca khác đang dùng. Trả về
    // luôn bản mới để test gieo và đọc đúng cái mà module đang xét nhìn thấy.
    const store = await import('@/lib/persistentStore');
    return { mod: await import('@/platform/secrets'), store, vault };
  }

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.doUnmock('@tauri-apps/api/core');
    vi.doUnmock('@tauri-apps/plugin-store');
    vi.resetModules();
  });

  it('chuyển seed 2FA sang kho rồi XOÁ bản cũ', async () => {
    const payload = JSON.stringify([{ id: '1', secret: 'JBSWY3DPEHPK3PXP' }]);
    const { mod, store, vault } = await loadDesktopSecrets();
    store.storageSet('devtool:2fa:accounts', payload);

    expect(await mod.migrateSecretsFromSharedStore()).toEqual(['devtool:2fa:accounts']);

    expect(vault.get('2fa/accounts')).toBe(payload);
    // Điểm mấu chốt: bản cũ phải BIẾN MẤT khỏi mặt phẳng khoá dùng chung —
    // chép mà không xoá thì không giải quyết được gì.
    expect(store.storageGet('devtool:2fa:accounts')).toBeNull();
  });

  it('chạy lại là no-op, không đè lên dữ liệu mới hơn trong kho', async () => {
    const { mod, store, vault } = await loadDesktopSecrets();
    store.storageSet('devtool:2fa:accounts', 'cu');
    await mod.migrateSecretsFromSharedStore();
    vault.set('2fa/accounts', 'moi');

    expect(await mod.migrateSecretsFromSharedStore()).toEqual([]);
    expect(vault.get('2fa/accounts')).toBe('moi');
  });

  it('chuyển đủ cả ba khoá bí mật đã biết, không sót khoá nào', async () => {
    const { mod, store, vault } = await loadDesktopSecrets();
    store.storageSet('devtool:2fa:accounts', 'a');
    store.storageSet('devtool:jwt:token', 'b');
    store.storageSet('devtool:apiclient:vault', 'c');

    await mod.migrateSecretsFromSharedStore();

    expect(vault.get('2fa/accounts')).toBe('a');
    expect(vault.get('jwt/token')).toBe('b');
    expect(vault.get('api-client/vault')).toBe('c');
    for (const k of ['devtool:2fa:accounts', 'devtool:jwt:token', 'devtool:apiclient:vault']) {
      expect(store.storageGet(k), k).toBeNull();
    }
  });
});

describe('di trú từ store dùng chung — đường web', () => {
  it('không có gì để chuyển thì không làm gì', async () => {
    expect(await migrateSecretsFromSharedStore()).toEqual([]);
  });

  it('bản web KHÔNG di trú — chuyển vào kho chỉ sống một phiên là XOÁ, không phải chuyển', async () => {
    // jsdom không có `__TAURI_INTERNALS__`, nên đây chính là đường của bản web.
    const payload = JSON.stringify([{ id: '1', secret: 'JBSWY3DPEHPK3PXP' }]);
    storageSet('devtool:2fa:accounts', payload);

    expect(await migrateSecretsFromSharedStore()).toEqual([]);

    // Điểm mấu chốt: dữ liệu vẫn nằm nguyên chỗ cũ. Bản desktop sẽ di trú đúng
    // cách; còn ở đây hiển thị rỗng thì phiền, nhưng xoá mất thì không sửa được.
    expect(storageGet('devtool:2fa:accounts')).toBe(payload);
    expect(await secretGet('2fa', 'accounts')).toBeNull();

    storageRemove('devtool:2fa:accounts');
  });
});
