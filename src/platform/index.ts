/**
 * The platform's single import surface: plugins import only from
 * '@/platform', so the loading mechanism can change without touching them.
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
  recordKey,
  assertNoConflictingInstall,
  findCoupledRecord,
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
// Re-exported so tools can type stream parameters without importing Tauri.
export type { Channel } from '@tauri-apps/api/core';
export * as pluginAudit from './audit';
export type { AuditChannel, AuditEntry } from './audit';
