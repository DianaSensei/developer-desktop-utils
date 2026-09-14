import { copyToClipboard, readTextFromClipboard } from '@/lib/clipboard';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { secretDelete, secretGet, secretKeys, secretSet } from './secrets';
import { createPluginService, type PluginService } from './service';
import { isTauri } from '@/lib/platform';
import * as audit from './audit';
import { SDK_VERSION, type PluginManifest, type PluginPermission } from './types';

/**
 * Platform SDK — bề mặt DUY NHẤT plugin được phép dùng để chạm ra ngoài chính nó.
 *
 * Mọi kênh ở đây đều đi qua một điểm thắt: kiểm quyền đã khai trong manifest →
 * ghi audit → mới thực thi. Đó là lý do SDK tồn tại thay vì để plugin import
 * thẳng `@/lib/clipboard` hay `@tauri-apps/api`: không có điểm thắt thì không
 * có gì để kiểm toán, và "quyền" trong manifest chỉ là chú thích.
 *
 * SDK được cấp THEO PLUGIN (`createPluginSdk(manifest)`), không phải singleton
 * toàn cục — nhờ vậy namespace storage và allowlist lệnh gắn chặt với danh tính
 * plugin, plugin không tự khai mình là plugin khác được.
 */

export class PluginPermissionError extends Error {
  constructor(
    readonly pluginId: string,
    readonly permission: PluginPermission,
    readonly action: string,
  ) {
    super(
      `Plugin "${pluginId}" gọi ${action} nhưng manifest chưa khai quyền "${permission}". ` +
        `Thêm "${permission}" vào permissions trong src/plugins/${pluginId}/plugin.ts.`,
    );
    this.name = 'PluginPermissionError';
  }
}

export class PluginCommandError extends Error {
  constructor(readonly pluginId: string, readonly command: string) {
    super(
      `Plugin "${pluginId}" gọi lệnh native "${command}" ngoài allowlist. ` +
        `Thêm nó vào commands trong src/plugins/${pluginId}/plugin.ts.`,
    );
    this.name = 'PluginCommandError';
  }
}

export interface PluginStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Khoá đầy đủ (đã gắn namespace) — để truyền cho `usePersistentState`. */
  key(key: string): string;
}

/**
 * Kho bí mật của plugin. Bất đồng bộ, khác hẳn `storage` đồng bộ ở trên — và đó
 * là chủ ý: nó nằm ở một file riêng, ngoài cache trong RAM mà mọi module đọc
 * được. Chấp nhận `await` chính là cái giá của việc tách mặt phẳng khoá.
 */
export interface PluginSecrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PluginSdk {
  readonly id: string;
  readonly sdkVersion: string;
  readonly permissions: readonly PluginPermission[];
  storage: PluginStorage;
  secrets: PluginSecrets;
  clipboard: {
    readText(): Promise<string | null>;
    writeText(text: string): Promise<void>;
  };
  /** `fetch` tương thích chuẩn, đi qua tauri-plugin-http khi chạy trong app. */
  http: { fetch(input: string, init?: RequestInit): Promise<Response> };
  native: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  /** Tier B: gọi sidecar của plugin. Xem `service.ts`. */
  service: PluginService;
  log(message: string, detail?: string): void;
}

/**
 * Namespace khoá storage. Cố ý giữ nguyên tiền tố `devtool:<id>:` mà các tool
 * hiện có đã dùng với `usePersistentState`, nên một tool chuyển sang SDK vẫn
 * đọc đúng dữ liệu người dùng đang có — đổi tiền tố ở đây là im lặng vứt đi
 * toàn bộ collection, lịch sử và cấu hình đã lưu của họ.
 */
export function storageKey(pluginId: string, key: string): string {
  return `devtool:${pluginId}:${key}`;
}

function ensure(manifest: PluginManifest, permission: PluginPermission, channel: audit.AuditChannel, action: string, detail?: string): void {
  const granted = manifest.permissions?.includes(permission) ?? false;
  audit.record({
    pluginId: manifest.id,
    channel,
    action,
    allowed: granted,
    detail,
    ...(granted ? {} : { missingPermission: permission }),
  });
  if (!granted) throw new PluginPermissionError(manifest.id, permission, action);
}

/** Lệnh khớp allowlist khi trùng khít, hoặc khi một mục allowlist là tiền tố của nó. */
function commandAllowed(manifest: PluginManifest, command: string): boolean {
  return (manifest.commands ?? []).some((c) => command === c || command.startsWith(c));
}

export function createPluginSdk(manifest: PluginManifest): PluginSdk {
  const id = manifest.id;

  return {
    id,
    sdkVersion: SDK_VERSION,
    permissions: manifest.permissions ?? [],

    storage: {
      key: (key) => storageKey(id, key),
      get(key) {
        ensure(manifest, 'storage', 'storage', 'get', key);
        return storageGet(storageKey(id, key));
      },
      set(key, value) {
        ensure(manifest, 'storage', 'storage', 'set', key);
        storageSet(storageKey(id, key), value);
      },
      remove(key) {
        ensure(manifest, 'storage', 'storage', 'remove', key);
        storageRemove(storageKey(id, key));
      },
    },

    // Audit của kênh này chỉ ghi TÊN khoá, không bao giờ ghi giá trị — một
    // nhật ký làm rò seed TOTP thì tệ hơn hẳn việc không có nhật ký.
    secrets: {
      async get(key) {
        ensure(manifest, 'secrets', 'secrets', 'get', key);
        return secretGet(id, key);
      },
      async set(key, value) {
        ensure(manifest, 'secrets', 'secrets', 'set', key);
        return secretSet(id, key, value);
      },
      async delete(key) {
        ensure(manifest, 'secrets', 'secrets', 'delete', key);
        return secretDelete(id, key);
      },
      async keys() {
        ensure(manifest, 'secrets', 'secrets', 'keys');
        return secretKeys(id);
      },
    },

    clipboard: {
      async readText() {
        ensure(manifest, 'clipboard:read', 'clipboard', 'readText');
        return readTextFromClipboard();
      },
      async writeText(text) {
        ensure(manifest, 'clipboard:write', 'clipboard', 'writeText', `${text.length} ký tự`);
        return copyToClipboard(text);
      },
    },

    http: {
      async fetch(input, init) {
        ensure(manifest, 'http', 'http', init?.method ?? 'GET', audit.describeUrl(input));
        // tauri-plugin-http bỏ qua sandbox của webview (CORS, cookie của
        // trang) — đó là lý do nó tồn tại — nhưng chỉ có trong app thật, nên
        // bản web/test rơi về `fetch` của trình duyệt.
        if (isTauri) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          return tauriFetch(input, init);
        }
        return globalThis.fetch(input, init);
      },
    },

    native: {
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        // Hai điều kiện, một bản ghi: lệnh phải vừa có quyền 'native' vừa nằm
        // trong allowlist. Ghi riêng từng điều kiện sẽ sinh hai dòng audit cho
        // cùng một lời gọi và làm nhật ký khó đọc.
        const granted = manifest.permissions?.includes('native') ?? false;
        const allowed = granted && commandAllowed(manifest, command);
        audit.record({
          pluginId: id,
          channel: 'native',
          action: command,
          allowed,
          detail: granted && !allowed ? 'ngoài allowlist' : undefined,
          ...(granted ? {} : { missingPermission: 'native' as const }),
        });
        if (!granted) throw new PluginPermissionError(id, 'native', command);
        if (!allowed) throw new PluginCommandError(id, command);
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<T>(command, args);
      },
    },

    service: createPluginService(manifest),

    log(message, detail) {
      audit.record({ pluginId: id, channel: 'lifecycle', action: message, allowed: true, detail });
    },
  };
}
