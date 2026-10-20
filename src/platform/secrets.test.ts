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
 * In jsdom `isTauri` is false, so these tests cover the web fallback. It must
 * use sessionStorage: localStorage would be pulled back into the shared cache.
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
    // ...and is not readable through the shared store.
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
 * The real migration runs on desktop, so these tests set the Tauri flag
 * before loading the module and replace the Rust vault with an in-memory fake.
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
    // `vi.resetModules()` also recreates `persistentStore`; return the new
    // instance so the test seeds and reads what the module sees.
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
    // The original must be removed from the shared store, not just copied.
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
    expect(vault.get('base64/jwt:token')).toBe('b');
    expect(vault.get('api-client/vault')).toBe('c');
    for (const k of ['devtool:2fa:accounts', 'devtool:jwt:token', 'devtool:apiclient:vault']) {
      expect(store.storageGet(k), k).toBeNull();
    }
  });

  it('chuyển khoá jwt/* sang base64/jwt:*, xoá bản cũ, chạy lại không làm gì', async () => {
    const { mod, vault } = await loadDesktopSecrets();
    vault.set('jwt/token', 'tok');
    vault.set('jwt/private-key', 'pem');

    expect(await mod.migrateVaultMoves()).toEqual(['jwt/token', 'jwt/private-key']);
    expect(vault.get('base64/jwt:token')).toBe('tok');
    expect(vault.get('base64/jwt:private-key')).toBe('pem');
    expect(vault.has('jwt/token')).toBe(false);
    expect(await mod.migrateVaultMoves()).toEqual([]);
  });

  it('giữ giá trị đã có ở chỗ mới', async () => {
    const { mod, vault } = await loadDesktopSecrets();
    vault.set('jwt/hmac-secret', 'old');
    vault.set('base64/jwt:hmac-secret', 'new');
    await mod.migrateVaultMoves();
    expect(vault.get('base64/jwt:hmac-secret')).toBe('new');
    expect(vault.has('jwt/hmac-secret')).toBe(false);
  });
});

describe('di trú từ store dùng chung — đường web', () => {
  it('không có gì để chuyển thì không làm gì', async () => {
    expect(await migrateSecretsFromSharedStore()).toEqual([]);
  });

  it('bản web KHÔNG di trú — chuyển vào kho chỉ sống một phiên là XOÁ, không phải chuyển', async () => {
    // jsdom has no `__TAURI_INTERNALS__`: this is the web path.
    const payload = JSON.stringify([{ id: '1', secret: 'JBSWY3DPEHPK3PXP' }]);
    storageSet('devtool:2fa:accounts', payload);

    expect(await migrateSecretsFromSharedStore()).toEqual([]);

    // Data stays where it was; the desktop app migrates it later.
    expect(storageGet('devtool:2fa:accounts')).toBe(payload);
    expect(await secretGet('2fa', 'accounts')).toBeNull();

    storageRemove('devtool:2fa:accounts');
  });
});
