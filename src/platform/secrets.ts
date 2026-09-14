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
 * - **Trong Tauri**: kho MÃ HOÁ phía Rust (`src-tauri/src/secrets_vault.rs`) —
 *   AES-256-GCM, khoá nằm trong keychain của OS chứ không cạnh dữ liệu. Webview
 *   không bao giờ chạm tới khoá.
 * - **Trên web (`npm run dev`)**: `sessionStorage`, KHÔNG phải `localStorage` —
 *   vì `initPersistentStore()` ở bản web hút nguyên `localStorage` vào cache
 *   chung, nên lưu bí mật ở đó sẽ đưa chúng trở lại đúng mặt phẳng khoá ta vừa
 *   dọn. Đổi lại, bản web chỉ giữ bí mật trong một phiên; đó là bản dành cho
 *   dev, sản phẩm thật luôn là Tauri.
 *
 * Trên máy Linux không có Secret Service, khoá rơi về file 0600 cạnh dữ liệu —
 * yếu hơn hẳn, nên chế độ đang dùng được trả ra qua `vaultStatus()` để Settings
 * hiển thị thay vì giấu đi. Xem phần đầu `secrets_vault.rs` cho đánh đổi đầy đủ.
 */

const LEGACY_STORE_FILE = 'secrets.json';
const WEB_PREFIX = 'devtool-secret:';

/** Khoá đến từ đâu — xem `KeyMode` ở secrets_vault.rs. */
export type VaultKeyMode = 'keychain' | 'file';

export interface VaultStatus {
  encrypted: boolean;
  keyMode: VaultKeyMode;
  /** `false` khi có dữ liệu trên đĩa nhưng khoá hiện tại không mở được nó. */
  readable: boolean;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Khoá trong kho: `<pluginId>/<key>`. Không dùng chung tiền tố `devtool:` của
 *  store chung, để một khoá bị chép nhầm giữa hai kho là lỗi nhìn thấy ngay. */
export function vaultKey(pluginId: string, key: string): string {
  return `${pluginId}/${key}`;
}

export async function secretGet(pluginId: string, key: string): Promise<string | null> {
  const k = vaultKey(pluginId, key);
  if (!isTauri) return sessionStorage.getItem(WEB_PREFIX + k);
  return (await call<string | null>('secret_vault_get', { key: k })) ?? null;
}

export async function secretSet(pluginId: string, key: string, value: string): Promise<void> {
  const k = vaultKey(pluginId, key);
  if (!isTauri) {
    sessionStorage.setItem(WEB_PREFIX + k, value);
    return;
  }
  await call<void>('secret_vault_set', { key: k, value });
}

export async function secretDelete(pluginId: string, key: string): Promise<void> {
  const k = vaultKey(pluginId, key);
  if (!isTauri) {
    sessionStorage.removeItem(WEB_PREFIX + k);
    return;
  }
  await call<void>('secret_vault_delete', { key: k });
}

/** Tên khoá (đã bỏ tiền tố plugin) mà plugin này đang giữ trong kho. */
export async function secretKeys(pluginId: string): Promise<string[]> {
  const prefix = `${pluginId}/`;
  const all = isTauri
    ? await call<string[]>('secret_vault_keys')
    : Object.keys(sessionStorage)
        .filter((k) => k.startsWith(WEB_PREFIX))
        .map((k) => k.slice(WEB_PREFIX.length));
  return all
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort();
}

/** Chế độ khoá hiện tại, để Settings nói đúng mức bảo vệ đang áp dụng. */
export async function vaultStatus(): Promise<VaultStatus | null> {
  if (!isTauri) return null;
  const raw = await call<{ encrypted: boolean; key_mode: VaultKeyMode; readable: boolean }>(
    'secret_vault_status',
  );
  return { encrypted: raw.encrypted, keyMode: raw.key_mode, readable: raw.readable };
}

/** Kho phía Rust ghi thẳng xuống đĩa trong từng lệnh, không có gì để flush.
 *  Giữ hàm này vì nó là điểm gọi đã có ở luồng di trú — và để nếu sau này kho
 *  chuyển sang ghi trễ thì chỗ cần sửa đã nằm sẵn đúng một nơi. */
export async function flushSecrets(): Promise<void> {}

/** Xoá sạch kho. Dùng bởi nhánh DEV của main.tsx, song song với
 *  `clearPersistentStore()` — nếu không, `tauri:dev` sẽ dọn store chung nhưng
 *  để lại bí mật cũ, và "chạy từ trạng thái sạch" hoá ra không sạch. */
export async function clearSecrets(): Promise<void> {
  if (!isTauri) {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(WEB_PREFIX)) sessionStorage.removeItem(k);
    }
    return;
  }
  await call<void>('secret_vault_clear');
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
  // JWT dán vào debugger: thường là bearer token thật của người dùng, không
  // phải chuỗi ví dụ. Giữ nó ở store chung nghĩa là mọi module trong webview
  // đọc được token phiên làm việc của họ.
  { from: 'devtool:jwt:token', pluginId: 'jwt', key: 'token' },
  // "Vault" của API Client: toàn bộ nội dung là bí mật theo đúng định nghĩa của
  // nó — nó tồn tại chính vì người dùng không muốn những giá trị này nằm trong
  // environments xuất/nhập được.
  { from: 'devtool:apiclient:vault', pluginId: 'api-client', key: 'vault' },
];

/**
 * Chuyển bí mật từ store chung sang kho, một lần, lúc khởi động.
 *
 * Không dùng cờ "đã migrate": nguồn bị XOÁ sau khi chép thành công, nên chạy
 * lại là no-op, còn nếu tiến trình chết giữa chừng thì lần khởi động sau tự
 * thử lại. Một cờ đặt sai thời điểm sẽ biến sự cố giữa chừng thành mất dữ liệu.
 */
export async function migrateSecretsFromSharedStore(): Promise<string[]> {
  // KHÔNG di trú ở bản web. Kho của bản web là `sessionStorage`, nên "chuyển"
  // ở đây thực chất là bê dữ liệu từ nơi lưu được sang nơi mất khi đóng tab,
  // rồi xoá bản gốc — tức là XOÁ dữ liệu người dùng chứ không phải di trú.
  //
  // Để nguyên thì bản web hiển thị rỗng (đọc kho session trống) nhưng dữ liệu
  // vẫn còn nguyên chỗ cũ và sẽ được di trú đúng cách khi họ mở bản desktop.
  // Hiển thị rỗng là phiền; xoá mất là không sửa được.
  if (!isTauri) return [];

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

/**
 * Chuyển kho TRẦN của bản trước (`secrets.json`, do tauri-plugin-store ghi) sang
 * kho mã hoá.
 *
 * Chỉ tồn tại vì đã có một bản trung gian tách mặt phẳng khoá nhưng chưa mã hoá.
 * Người cài mới không có file này và hàm là no-op. Sau khi chép xong, store cũ
 * được DỌN SẠCH — để lại bản trần bên cạnh bản mã hoá thì việc mã hoá chẳng còn
 * ý nghĩa gì.
 */
export async function migrateSecretsFromPlainStore(): Promise<number> {
  // Cùng lý do như `migrateSecretsFromSharedStore`: bản web không có kho bền
  // để chuyển sang, và store trần này cũng chỉ tồn tại ở bản Tauri.
  if (!isTauri) return 0;
  let moved = 0;
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    const legacy = await load(LEGACY_STORE_FILE, { defaults: {}, autoSave: false });
    const entries = await legacy.entries<string>();
    for (const [key, value] of entries) {
      if (typeof value !== 'string') continue;
      await call<void>('secret_vault_set', { key, value });
      moved += 1;
    }
    if (moved > 0) {
      await legacy.clear();
      await legacy.save();
    }
  } catch {
    // Không có file cũ, hoặc plugin store không mở được: không có gì để chuyển.
  }
  return moved;
}

/** Chỉ dùng trong test — không còn state cục bộ nào để dọn, nhưng giữ điểm gọi
 *  để test không phải biết chi tiết hiện thực. */
export function __resetSecretsForTest(): void {}
