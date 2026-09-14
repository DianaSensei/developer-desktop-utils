/**
 * Bề mặt import DUY NHẤT của Platform — plugin chỉ import từ '@/platform'.
 *
 * Giữ một cửa ngõ như vậy để sau này đổi cách nạp plugin (chuyển sang nạp runtime
 * từ repo riêng, hay chạy trong webview tách biệt) mà không phải sửa từng plugin:
 * chúng chỉ thấy hợp đồng ở đây, không thấy cách registry hiện thực nó.
 */
export { definePlugin, satisfiesSdk, validateManifest } from './manifest';
export { SDK_VERSION } from './types';
export type { PluginManifest, PluginPermission, PluginRecord, PluginLoadError } from './types';
export {
  PLUGINS,
  PLUGIN_MAP,
  PLUGIN_ERRORS,
  DEFAULT_PLUGIN_ORDER,
  DEFAULT_PLUGIN_FEATURES,
  getPlugin,
} from './registry';
export { createPluginSdk, storageKey, PluginPermissionError, PluginCommandError } from './sdk';
export type { PluginSdk, PluginStorage } from './sdk';
export { PluginProvider, usePluginSdk, usePluginSdkOptional, withPluginSdk } from './context';
export * as pluginAudit from './audit';
export type { AuditChannel, AuditEntry } from './audit';
