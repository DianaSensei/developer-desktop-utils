/**
 * Platform SDK: the only surface plugins use to reach outside themselves.
 *
 * Every call goes through one checkpoint: check the declared permission,
 * record an audit entry, then execute. An SDK is created per plugin
 * (`createPluginSdk(manifest)`), so storage namespaces and command
 * allowlists are bound to the plugin's identity.
 */

import {
  copyImageToClipboard,
  copyToClipboard,
  readImageFromClipboard,
  readTextFromClipboard,
} from '@/lib/clipboard';
import { IS_MAC, MOD_KEY, isTauri } from '@/lib/platform';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import * as audit from './audit';
import { SDK_VERSION, type PluginManifest, type PluginPermission } from './types';
import { secretDelete, secretGet, secretKeys, secretSet } from './secrets';
import { createPluginService, type PluginService } from './service';
import { hostAllowed } from './manifest';
import type { Channel } from '@tauri-apps/api/core';
import type { DangerousSettings } from '@tauri-apps/plugin-http';

/**
 * `RequestInit` plus options only Tauri's HTTP layer supports:
 * `maxRedirections` and `danger` (self-signed certificates). Ignored by the
 * browser `fetch` used in web builds.
 */
export type PluginFetchInit = RequestInit & {
  maxRedirections?: number;
  danger?: DangerousSettings;
};

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
  /** Fully namespaced key, for `usePersistentState`. */
  key(key: string): string;
}

/**
 * Plugin secrets, stored in the encrypted vault rather than the shared
 * in-memory settings cache; hence asynchronous.
 */
export interface PluginSecrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Environment info. Not gated: it reveals nothing beyond the user agent. */
export interface PluginEnv {
  /** Running in the Tauri webview rather than a plain browser. */
  readonly isTauri: boolean;
  readonly isMac: boolean;
  /** Modifier key label for shortcuts: '⌘' or 'Ctrl'. */
  readonly modKey: string;
}

/** Window-level drag state. `paths` is only set on 'drop'. */
export interface FileDropEvent {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths?: string[];
}

export interface PluginFileFilter {
  name: string;
  /** Extensions without the dot: ['json', 'yaml']. */
  extensions: string[];
}

export interface PluginFiles {
  /** OS open dialog; `null` when cancelled. */
  pickOpen(options?: { title?: string; multiple?: boolean; filters?: PluginFileFilter[] }): Promise<string[] | null>;
  /** OS save dialog; `null` when cancelled. */
  pickSave(options?: { title?: string; defaultPath?: string; filters?: PluginFileFilter[] }): Promise<string | null>;
  readText(path: string): Promise<string>;
  /** `append` supports large exports written in chunks. */
  writeText(path: string, contents: string, options?: { append?: boolean }): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
}

export interface PluginSdk {
  readonly id: string;
  /** Install source (see `PluginManifest.group`). */
  readonly group: string;
  readonly sdkVersion: string;
  readonly permissions: readonly PluginPermission[];
  readonly env: PluginEnv;
  files: PluginFiles;
  /** Opens a URL in the default browser. */
  openExternal(url: string): Promise<void>;
  storage: PluginStorage;
  secrets: PluginSecrets;
  clipboard: {
    readText(): Promise<string | null>;
    writeText(text: string): Promise<void>;
    /** Clipboard image as a PNG data URL, or `null`. */
    readImage(): Promise<string | null>;
    writeImage(source: Blob | string): Promise<void>;
  };
  /** Standard `fetch`, routed through tauri-plugin-http in the app. */
  http: { fetch(input: string, init?: PluginFetchInit): Promise<Response> };
  native: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    /**
     * Creates a Tauri `Channel` for commands that stream data. Gated by
     * 'native' so streaming tools stay behind the SDK checkpoint. `label`
     * names the stream in the audit log.
     */
    channel<T>(onMessage: (message: T) => void, label?: string): Promise<Channel<T>>;
    /**
     * Listens to an event emitted by Rust. Call the returned function on
     * unmount.
     */
    listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
    /**
     * Window-level file drag events (Tauri intercepts them before the
     * webview, so HTML `ondrop` never fires). Gated by 'files:read' because
     * it hands the plugin file paths. Call the returned function on unmount.
     */
    onFileDrop(handler: (event: FileDropEvent) => void): Promise<() => void>;
  };
  /** Tier B: calls the plugin's sidecar. See service.ts. */
  service: PluginService;
  log(message: string, detail?: string): void;
}

/**
 * Storage key namespace. The `devtool:<id>:` prefix matches existing saved
 * data; changing it would orphan users' collections, history and settings.
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

/** A command is allowed when it equals an allowlist entry or starts with one. */
function commandAllowed(manifest: PluginManifest, command: string): boolean {
  return (manifest.commands ?? []).some((c) => command === c || command.startsWith(c));
}

export function createPluginSdk(manifest: PluginManifest): PluginSdk {
  const id = manifest.id;

  return {
    id,
    group: manifest.group ?? 'core',
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

    // Audit entries record key names only, never values.
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

    // Read and write are separate permissions: importing a file should not
    // grant overwriting any file the user picks.
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
        // tauri-plugin-http bypasses webview restrictions (CORS, page cookies)
        // but only exists in the app; web builds and tests use `fetch`.
        if (isTauri) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          return tauriFetch(input, init);
        }
        return globalThis.fetch(input, init);
      },
    },

    native: {
      async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        // One audit entry covering both the permission and the allowlist.
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
        // No command name to check yet; the allowlist applies to the
        // `invoke` that uses this channel. Record the stream opening.
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
