/**
 * Bề mặt import DUY NHẤT của Platform — plugin chỉ import từ '@/platform'.
 *
 * Giữ một cửa ngõ như vậy để sau này đổi cách nạp plugin (chuyển sang nạp runtime
 * từ repo riêng, hay chạy trong webview tách biệt) mà không phải sửa từng plugin:
 * chúng chỉ thấy hợp đồng ở đây, không thấy cách registry hiện thực nó.
 */
export { definePlugin, hostAllowed, satisfiesSdk, validateManifest } from './manifest';
export { SDK_VERSION } from './types';
export type { PluginManifest, PluginPermission, PluginRecord, PluginLoadError } from './types';
export {
  PLUGINS,
  PLUGIN_MAP,
  PLUGIN_ERRORS,
  DEFAULT_PLUGIN_ORDER,
  DEFAULT_PLUGIN_FEATURES,
  getPlugin,
  initInstalledPlugins,
} from './registry';
export {
  fetchManifestPreview,
  installPlugin,
  listInstalledPlugins,
  uninstallPlugin,
  checkForUpdate,
  installService,
  listInstalledServices,
  uninstallService,
  checkForServiceUpdate,
  fetchArtifactManifestPreview,
  installArtifact,
  listInstalledArtifacts,
  uninstallArtifact,
  currentTargetTriple,
  checkAllForUpdates,
} from './installer';
export type {
  RemotePluginManifest,
  InstalledPluginRecord,
  ServiceTarget,
  RemoteServiceManifest,
  InstalledServiceRecord,
  RemoteArtifactManifest,
  InstalledArtifactRecord,
  ArtifactUpdateAvailable,
} from './installer';
export { createPluginSdk, storageKey, PluginPermissionError, PluginCommandError, PluginHostError } from './sdk';
export type {
  PluginSdk,
  PluginStorage,
  PluginSecrets,
  PluginEnv,
  PluginFiles,
  PluginFileFilter,
  PluginFetchInit,
  FileDropEvent,
} from './sdk';
export {
  clearSecrets,
  flushSecrets,
  migrateSecretsFromPlainStore,
  migrateSecretsFromSharedStore,
  secretDelete,
  secretGet,
  secretKeys,
  secretSet,
  vaultKey,
  vaultStatus,
} from './secrets';
export type { VaultStatus, VaultKeyMode } from './secrets';
export { useSecretState } from './useSecretState';
export { usePluginState, migrateLegacyKey } from './usePluginState';
export { usePluginSdkFor, getPluginSdk } from './usePluginSdkFor';
export { usePluginConfig, useLiveConnection, usePluginMcpBridgeActive } from './services';
export { SERVICE_PROTOCOL, createPluginService, PluginServiceError } from './service';
export type {
  PluginService,
  ServiceDescriptor,
  ServiceRequest,
  ServiceResponse,
  ServiceTransport,
  ServiceSubscription,
} from './service';
export { PluginProvider, usePluginSdk, usePluginSdkOptional, withPluginSdk } from './context';
// Kiểu `Channel` của Tauri đi qua cửa của Platform luôn: tool cần nó để khai
// tham số của một lệnh nhận stream, và bắt chúng import type thẳng từ
// '@tauri-apps/api/core' chỉ vì một cái tên kiểu là thứ duy nhất còn buộc chúng
// chạm vào Tauri trực tiếp.
export type { Channel } from '@tauri-apps/api/core';
export * as pluginAudit from './audit';
export type { AuditChannel, AuditEntry } from './audit';
