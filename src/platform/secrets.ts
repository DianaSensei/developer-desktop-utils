import { isTauri } from '@/lib/platform';
import { storageGet, storageRemove } from '@/lib/persistentStore';

/**
 * Kho bí mật — TÁCH HẲN khỏi store dùng chung của app.
 *
 * Vì sao phải tách: `persistentStore` nạp TOÀN BỘ `app-settings.json` vào một
 * cache đồng bộ trong RAM lúc khởi động, và `storageGet(bấtKỳKhoáNào)` đọc được
 * mọi thứ trong đó. Khi seed TOTP, token API và mật khẩu broker cùng nằm trên
 * mặt phẳng khoá ấy thì bất kỳ đoạn code nào trong webview — kể cả một
 * dependency npm bị chiếm trong bundle của một plugin — cũng đọc được tất cả
 * bằng đúng một lời gọi. Đây là điều kiện tiên quyết trước khi nghĩ tới việc
 * nạp plugin lúc chạy.
 *
 * Hai đường lưu, cố ý khác nhau:
 *
 * - **Trong Tauri**: một file store RIÊNG (`secrets.json`), không bao giờ được
 *   đọc vào cache chung, chỉ truy cập qua các hàm bất đồng bộ ở đây.
 * - **Trên web (`npm run dev`)**: `sessionStorage`, KHÔNG phải `localStorage` —
 *   vì `initPersistentStore()` ở bản web hút nguyên `localStorage` vào cache
 *   chung, nên lưu bí mật ở đó sẽ đưa chúng trở lại đúng mặt phẳng khoá ta vừa
 *   dọn. Đổi lại, bản web chỉ giữ bí mật trong một phiên; đó là bản dành cho
 *   dev, sản phẩm thật luôn là Tauri.
 *
 * Chưa mã hoá khi nằm trên đĩa: khoá mã hoá phải sống ở đâu đó, và chỗ duy nhất
 * đáng tin là keychain của OS — cần một module Rust riêng. Đó là lát cắt kế
 * tiếp; việc tách mặt phẳng khoá ở đây độc lập với nó và phải đi trước.
 */

const SECRET_STORE_FILE = 'secrets.json';
const WEB_PREFIX = 'devtool-secret:';

type StoreLike = {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreLike> | null = null;

async function vault(): Promise<StoreLike | null> {
  if (!isTauri) return null;
  if (!storePromise) {
    storePromise = import('@tauri-apps/plugin-store').then(
      ({ load }) => load(SECRET_STORE_FILE, { defaults: {}, autoSave: 100 }) as unknown as Promise<StoreLike>,
    );
  }
  return storePromise;
}

/** Khoá trong kho: `<pluginId>/<key>`. Không dùng chung tiền tố `devtool:` của
 *  store chung, để một khoá bị chép nhầm giữa hai kho là lỗi nhìn thấy ngay. */
export function vaultKey(pluginId: string, key: string): string {
  return `${pluginId}/${key}`;
}

export async function secretGet(pluginId: string, key: string): Promise<string | null> {
  const k = vaultKey(pluginId, key);
  const store = await vault();
  if (!store) return sessionStorage.getItem(WEB_PREFIX + k);
  return (await store.get(k)) ?? null;
}

export async function secretSet(pluginId: string, key: string, value: string): Promise<void> {
  const k = vaultKey(pluginId, key);
  const store = await vault();
  if (!store) {
    sessionStorage.setItem(WEB_PREFIX + k, value);
    return;
  }
  await store.set(k, value);
}

export async function secretDelete(pluginId: string, key: string): Promise<void> {
  const k = vaultKey(pluginId, key);
  const store = await vault();
  if (!store) {
    sessionStorage.removeItem(WEB_PREFIX + k);
    return;
  }
  await store.delete(k);
}

/** Tên khoá (đã bỏ tiền tố plugin) mà plugin này đang giữ trong kho. */
export async function secretKeys(pluginId: string): Promise<string[]> {
  const prefix = `${pluginId}/`;
  const store = await vault();
  if (!store) {
    const out: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(WEB_PREFIX + prefix)) out.push(k.slice((WEB_PREFIX + prefix).length));
    }
    return out.sort();
  }
  return (await store.keys())
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort();
}

export async function flushSecrets(): Promise<void> {
  await (await vault())?.save();
}

/** Xoá sạch kho. Dùng bởi nhánh DEV của main.tsx, song song với
 *  `clearPersistentStore()` — nếu không, `tauri:dev` sẽ dọn store chung nhưng
 *  để lại bí mật cũ, và "chạy từ trạng thái sạch" hoá ra không sạch. */
export async function clearSecrets(): Promise<void> {
  const store = await vault();
  if (!store) {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(WEB_PREFIX)) sessionStorage.removeItem(k);
    }
    return;
  }
  await store.clear();
  await store.save();
}

/**
 * Khoá từng nằm trong store chung mà thực chất là bí mật, và chỗ chúng thuộc về.
 *
 * Danh sách tường minh, không đoán theo tên khoá: một heuristic kiểu "khoá nào
 * có chữ 'secret' thì chuyển" sẽ vừa bỏ sót (`devtool:apiclient:environments`)
 * vừa bắt nhầm (`devtool:base64:secretInput` — là ô nhập của người dùng, không
 * phải credential).
 */
const MIGRATIONS: ReadonlyArray<{ from: string; pluginId: string; key: string }> = [
  // Seed TOTP/HOTP — bí mật rõ ràng nhất trong app: đủ để sinh mã đăng nhập
  // của người dùng ở mọi dịch vụ họ đã thêm.
  { from: 'devtool:2fa:accounts', pluginId: '2fa', key: 'accounts' },
];

/**
 * Chuyển bí mật từ store chung sang kho, một lần, lúc khởi động.
 *
 * Không dùng cờ "đã migrate": nguồn bị XOÁ sau khi chép thành công, nên chạy
 * lại là no-op, còn nếu tiến trình chết giữa chừng thì lần khởi động sau tự
 * thử lại. Một cờ đặt sai thời điểm sẽ biến sự cố giữa chừng thành mất dữ liệu.
 */
export async function migrateSecretsFromSharedStore(): Promise<string[]> {
  const moved: string[] = [];
  for (const { from, pluginId, key } of MIGRATIONS) {
    const raw = storageGet(from);
    if (raw === null) continue;
    await secretSet(pluginId, key, raw);
    storageRemove(from);
    moved.push(from);
  }
  if (moved.length > 0) await flushSecrets();
  return moved;
}

/** Chỉ dùng trong test — quên store đã mở để ca sau bắt đầu từ đầu. */
export function __resetSecretsForTest(): void {
  storePromise = null;
}
