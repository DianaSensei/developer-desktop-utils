import {
  copyImageToClipboard,
  copyToClipboard,
  readImageFromClipboard,
  readTextFromClipboard,
} from '@/lib/clipboard';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { secretDelete, secretGet, secretKeys, secretSet } from './secrets';
import { createPluginService, type PluginService } from './service';
import { hostAllowed } from './manifest';
import type { Channel } from '@tauri-apps/api/core';
import type { DangerousSettings } from '@tauri-apps/plugin-http';

/**
 * `RequestInit` cộng các tuỳ chọn chỉ có ở tầng HTTP của Tauri.
 *
 * Cần vì chúng là thứ một HTTP workbench không thể thiếu: `maxRedirections` để
 * người dùng tự quyết có đi theo redirect hay không, `danger` để gọi được tới
 * endpoint dùng chứng chỉ tự ký. `fetch` của trình duyệt không có cả hai, và ở
 * bản web chúng đơn giản bị bỏ qua.
 */
export type PluginFetchInit = RequestInit & {
  maxRedirections?: number;
  danger?: DangerousSettings;
};
import { IS_MAC, MOD_KEY, isTauri } from '@/lib/platform';
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

export class PluginHostError extends Error {
  constructor(readonly pluginId: string, readonly host: string) {
    super(
      `Plugin "${pluginId}" gọi tới "${host}" ngoài allowlist hosts của nó. ` +
        `Thêm host vào hosts trong src/plugins/${pluginId}/plugin.ts (hoặc "*" nếu plugin thật sự gọi được mọi nơi).`,
    );
    this.name = 'PluginHostError';
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

/** Thông tin môi trường mà tool nào cũng hỏi. Chỉ đọc, không có quyền nào gác:
 *  nó không tiết lộ gì mà `navigator.userAgent` không nói sẵn. */
export interface PluginEnv {
  /** Đang chạy trong webview của Tauri, không phải trình duyệt thường. */
  readonly isTauri: boolean;
  readonly isMac: boolean;
  /** Phím lệnh theo hệ điều hành, để hiển thị phím tắt: '⌘' hoặc 'Ctrl'. */
  readonly modKey: string;
}

/** Trạng thái kéo-thả ở cấp cửa sổ. `paths` chỉ có ở pha 'drop'. */
export interface FileDropEvent {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths?: string[];
}

export interface PluginFileFilter {
  name: string;
  /** Đuôi file, KHÔNG kèm dấu chấm: ['json', 'yaml']. */
  extensions: string[];
}

export interface PluginFiles {
  /** Hộp thoại mở file của hệ điều hành. `null` khi người dùng huỷ. */
  pickOpen(options?: { title?: string; multiple?: boolean; filters?: PluginFileFilter[] }): Promise<string[] | null>;
  /** Hộp thoại lưu file. `null` khi người dùng huỷ. */
  pickSave(options?: { title?: string; defaultPath?: string; filters?: PluginFileFilter[] }): Promise<string | null>;
  readText(path: string): Promise<string>;
  /** `append` để ghi nối, dùng cho export lớn ghi theo từng khối. */
  writeText(path: string, contents: string, options?: { append?: boolean }): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
}

export interface PluginSdk {
  readonly id: string;
  readonly sdkVersion: string;
  readonly permissions: readonly PluginPermission[];
  readonly env: PluginEnv;
  files: PluginFiles;
  /** Mở URL bằng trình duyệt mặc định của người dùng. */
  openExternal(url: string): Promise<void>;
  storage: PluginStorage;
  secrets: PluginSecrets;
  clipboard: {
    readText(): Promise<string | null>;
    writeText(text: string): Promise<void>;
    /** Ảnh trong clipboard dưới dạng data URL PNG, `null` khi không có ảnh. */
    readImage(): Promise<string | null>;
    writeImage(source: Blob | string): Promise<void>;
  };
  /** `fetch` tương thích chuẩn, đi qua tauri-plugin-http khi chạy trong app. */
  http: { fetch(input: string, init?: PluginFetchInit): Promise<Response> };
  native: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    /**
     * Kênh streaming của Tauri, để truyền vào một lệnh nhận `Channel` (log
     * container, consumer Kafka/RabbitMQ, pub/sub Redis).
     *
     * SDK cần hàm này vì nếu không, mọi tool có luồng dữ liệu buộc phải import
     * thẳng `@tauri-apps/api/core` và nằm ngoài điểm thắt — tức bốn tool nặng
     * nhất của app vĩnh viễn không đi qua được lớp quyền/audit.
     *
     * `label` chỉ dùng cho nhật ký: một kênh không mang tên lệnh nào, nên nó là
     * cách duy nhất để đọc log biết luồng này của thứ gì.
     */
    channel<T>(onMessage: (message: T) => void, label?: string): Promise<Channel<T>>;
    /**
     * Nghe một sự kiện phát từ phía Rust. Trả về hàm huỷ đăng ký — plugin PHẢI
     * gọi nó lúc unmount, đúng như mọi listener khác trong repo này.
     */
    listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
    /**
     * Sự kiện kéo-thả file ở cấp CỬA SỔ (Tauri chặn chúng trước webview, nên
     * `ondrop` của HTML không bao giờ nhận được).
     *
     * Gác sau quyền `files:read` chứ không phải 'native': thứ nó trao cho plugin
     * là đường dẫn file của người dùng: nhận được chúng đã là bước đầu của việc
     * đọc file, dù việc đọc thật có diễn ra qua lệnh nào đi nữa.
     *
     * Trả về hàm huỷ đăng ký — plugin PHẢI gọi nó lúc unmount.
     */
    onFileDrop(handler: (event: FileDropEvent) => void): Promise<() => void>;
  };
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
    env: { isTauri, isMac: IS_MAC, modKey: MOD_KEY },

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
      async readImage() {
        ensure(manifest, 'clipboard:read', 'clipboard', 'readImage');
        return readImageFromClipboard();
      },
      async writeImage(source) {
        ensure(manifest, 'clipboard:write', 'clipboard', 'writeImage');
        return copyImageToClipboard(source);
      },
    },

    // Đọc và ghi file tách thành hai quyền, cùng lý do như clipboard: một tool
    // chỉ cần nhập file (API Client import collection) không nên vì thế mà có
    // luôn quyền ghi đè lên bất cứ file nào người dùng chọn.
    files: {
      async pickOpen(options) {
        ensure(manifest, 'files:read', 'files', 'pickOpen', options?.title);
        const { open } = await import('@tauri-apps/plugin-dialog');
        const picked = await open({
          title: options?.title,
          multiple: options?.multiple ?? false,
          filters: options?.filters,
        });
        if (picked === null) return null;
        return Array.isArray(picked) ? picked : [picked];
      },
      async pickSave(options) {
        ensure(manifest, 'files:write', 'files', 'pickSave', options?.title);
        const { save } = await import('@tauri-apps/plugin-dialog');
        return (await save({
          title: options?.title,
          defaultPath: options?.defaultPath,
          filters: options?.filters,
        })) ?? null;
      },
      async readText(path) {
        ensure(manifest, 'files:read', 'files', 'readText', audit.describePath(path));
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        return readTextFile(path);
      },
      async writeText(path, contents, options) {
        ensure(manifest, 'files:write', 'files', 'writeText', audit.describePath(path));
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        return writeTextFile(path, contents, options?.append ? { append: true } : undefined);
      },
      async readBytes(path) {
        ensure(manifest, 'files:read', 'files', 'readBytes', audit.describePath(path));
        const { readFile } = await import('@tauri-apps/plugin-fs');
        return readFile(path);
      },
      async writeBytes(path, data) {
        ensure(manifest, 'files:write', 'files', 'writeBytes', audit.describePath(path));
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        return writeFile(path, data);
      },
    },

    async openExternal(url) {
      ensure(manifest, 'open-url', 'shell', 'openExternal', audit.describeUrl(url));
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      return openUrl(url);
    },

    http: {
      async fetch(input, init) {
        ensure(manifest, 'http', 'http', init?.method ?? 'GET', audit.describeUrl(input));
        if (!hostAllowed(manifest.hosts ?? [], input)) {
          audit.record({
            pluginId: id,
            channel: 'http',
            action: init?.method ?? 'GET',
            allowed: false,
            detail: `${audit.describeUrl(input)} — ngoài allowlist hosts`,
          });
          throw new PluginHostError(id, audit.describeUrl(input));
        }
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

      async listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
        ensure(manifest, 'native', 'native', `listen:${event}`);
        const { listen } = await import('@tauri-apps/api/event');
        return listen<T>(event, (e) => handler(e.payload));
      },

      async onFileDrop(handler: (event: FileDropEvent) => void): Promise<() => void> {
        ensure(manifest, 'files:read', 'files', 'onFileDrop');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        return getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload as { type: FileDropEvent['type']; paths?: string[] };
          handler({ type: payload.type, paths: payload.paths });
        });
      },

      async channel<T>(onMessage: (message: T) => void, label?: string): Promise<Channel<T>> {
        // Không có tên lệnh để đối chiếu allowlist ở đây — allowlist bám vào
        // lời gọi `invoke` sẽ dùng kênh này. Nên chỗ này chỉ kiểm quyền, và ghi
        // lại việc mở luồng để nhật ký không bỏ sót một kênh dữ liệu dài hạn.
        ensure(manifest, 'native', 'native', `channel:${label ?? 'unnamed'}`);
        const { Channel: TauriChannel } = await import('@tauri-apps/api/core');
        const channel = new TauriChannel<T>();
        channel.onmessage = onMessage;
        return channel;
      },
    },

    service: createPluginService(manifest),

    log(message, detail) {
      audit.record({ pluginId: id, channel: 'lifecycle', action: message, allowed: true, detail });
    },
  };
}
