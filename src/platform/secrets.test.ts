import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSecrets,
  migrateSecretsFromSharedStore,
  secretDelete,
  secretGet,
  secretKeys,
  secretSet,
  vaultKey,
} from '@/platform/secrets';
import { storageGet, storageSet } from '@/lib/persistentStore';

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

describe('di trú từ store dùng chung', () => {
  it('chuyển seed 2FA sang kho rồi XOÁ bản cũ', async () => {
    const payload = JSON.stringify([{ id: '1', secret: 'JBSWY3DPEHPK3PXP' }]);
    storageSet('devtool:2fa:accounts', payload);

    const moved = await migrateSecretsFromSharedStore();

    expect(moved).toEqual(['devtool:2fa:accounts']);
    expect(await secretGet('2fa', 'accounts')).toBe(payload);
    // Điểm mấu chốt: bản cũ phải BIẾN MẤT khỏi mặt phẳng khoá dùng chung —
    // chép mà không xoá thì không giải quyết được gì.
    expect(storageGet('devtool:2fa:accounts')).toBeNull();
  });

  it('chạy lại là no-op, không đè lên dữ liệu mới hơn trong kho', async () => {
    storageSet('devtool:2fa:accounts', 'cu');
    await migrateSecretsFromSharedStore();
    await secretSet('2fa', 'accounts', 'moi');

    expect(await migrateSecretsFromSharedStore()).toEqual([]);
    expect(await secretGet('2fa', 'accounts')).toBe('moi');
  });

  it('không có gì để chuyển thì không làm gì', async () => {
    expect(await migrateSecretsFromSharedStore()).toEqual([]);
  });
});
