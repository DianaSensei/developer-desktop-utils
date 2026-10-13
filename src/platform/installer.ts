// TypeScript side of external artifact installation. The Rust side
// (src-tauri/src/artifact_installer.rs) downloads, verifies and stores
// artifacts; this module calls its commands, converts snake_case records to
// camelCase, and is the API used by the Extensions settings.
//
// Two API layers:
//   - kind-agnostic: `fetchArtifactManifestPreview`, `installArtifact`,
//     `listInstalledArtifacts`, `uninstallArtifact` (Settings lists both kinds);
//   - per kind: `fetchManifestPreview`, `installPlugin`, `listInstalledPlugins`,
//     `uninstallPlugin`, `checkForUpdate` for plugins and the matching
//     `*Service` functions for sidecars (used by registry.ts and tests).
//
// Plugin bundles are a single ESM file. They are loaded from a `blob:` URL,
// which has no base for relative imports, so authors must bundle everything
// into one file. React must be external: bundles read it from
// `window.__DEVTOOL_VENDOR__` (set in main.tsx), since a second React copy
// breaks hooks. See docs/decisions/architecture/platform-plugin-architecture.md.
//
// Services are native binaries spawned by the host (service_host.rs); there
// is nothing to load in the webview for them.

import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, Binary, Boxes, CalendarClock, Clock, Container, Database, Dices, FileJson,
  FileText, Globe, KeyRound, MemoryStick, Network, Package, Puzzle, QrCode, Regex, Send,
  Server, ServerCog, ShieldCheck, Timer,
} from 'lucide-react';
import { isTauri } from '@/lib/platform';
import { compareVersions } from '@/lib/semver';
import type { PluginManifest, PluginPermission } from './types';
import type { ServiceDescriptor } from './service';

// Remote manifests (mirror `RemoteArtifactManifest` in Rust)

/** Plugin manifest. JSON cannot carry components or closures, so `icon` is a
 *  name looked up in `ICONS_BY_NAME` and `entry` replaces `load`. */
export interface RemotePluginManifest {
  id: string;
  version: string;
  sdk: string;
  entry: string;
  integrity: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
  route: string;
  permissions: PluginPermission[];
  commands: string[];
  hosts: string[];
  /**
   * Sidecar this plugin calls when `permissions` includes `'service'`. Only
   * carries the method allowlist; `bin` must still be allowed by the host
   * (see docs/plugin-sdk/05-external-install.md).
   */
  service?: ServiceDescriptor;
}

/** Download URL and checksum of a service build for one target triple. */
export interface ServiceTarget {
  url: string;
  sha256: string;
}

/** One version of a native sidecar. `bin` is the bare name; the host adds
 *  `.exe` on Windows. `targets` maps target triple to build. */
export interface RemoteServiceManifest {
  bin: string;
  version: string;
  protocol: number;
  targets: Record<string, ServiceTarget>;
}

/** Remote manifest, flat and tagged by `kind` as serialized by Rust. */
export type RemoteArtifactManifest =
  | ({ kind: 'plugin' } & RemotePluginManifest)
  | ({ kind: 'service' } & RemoteServiceManifest);

// Installed records (mirror `InstalledArtifactRecord` in Rust, camelCased)

export interface InstalledPluginRecord {
  manifest: RemotePluginManifest;
  sourceUrl: string;
  bundlePath: string;
  installedAt: number;
  /** Marketplace the plugin came from; `undefined` for a pasted URL. Part of
   *  the plugin's identity (see `InstalledPluginRecord::market_id` in Rust). */
  marketId?: string;
}

export interface InstalledServiceRecord {
  manifest: RemoteServiceManifest;
  sourceUrl: string;
  binPath: string;
  installedAt: number;
  /** Display only; services are matched by `bin`. */
  marketId?: string;
}

/** Installed record, flat and tagged by `kind`. */
export type InstalledArtifactRecord =
  | ({ kind: 'plugin' } & InstalledPluginRecord)
  | ({ kind: 'service' } & InstalledServiceRecord);

/** Raw snake_case record from `invoke`. Rust writes `market_id: null` when
 *  there is no market (older indexes omit it); `toCamelArtifactRecord`
 *  normalizes both to `undefined`. */
type RawInstalledArtifactRecord =
  | { kind: 'plugin'; manifest: RemotePluginManifest; source_url: string; bundle_path: string; installed_at: number; market_id?: string | null }
  | { kind: 'service'; manifest: RemoteServiceManifest; source_url: string; bin_path: string; installed_at: number; market_id?: string | null };

/** Icon names available to installed plugins. Unknown names fall back to
 *  `Puzzle` rather than failing the install. */
const ICONS_BY_NAME: Record<string, LucideIcon> = {
  puzzle: Puzzle, package: Package, boxes: Boxes, globe: Globe,
  'calendar-clock': CalendarClock, clock: Clock, timer: Timer,
  'file-json': FileJson, 'file-text': FileText, binary: Binary, regex: Regex,
  'key-round': KeyRound, 'qr-code': QrCode, 'arrow-left-right': ArrowLeftRight,
  server: Server, 'server-cog': ServerCog, database: Database, 'memory-stick': MemoryStick,
  network: Network, container: Container, send: Send, 'shield-check': ShieldCheck, dices: Dices,
};

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function toCamelArtifactRecord(record: RawInstalledArtifactRecord): InstalledArtifactRecord {
  if (record.kind === 'plugin') {
    return {
      kind: 'plugin',
      manifest: record.manifest,
      sourceUrl: record.source_url,
      bundlePath: record.bundle_path,
      installedAt: record.installed_at,
      marketId: record.market_id ?? undefined,
    };
  }
  return {
    kind: 'service',
    manifest: record.manifest,
    sourceUrl: record.source_url,
    binPath: record.bin_path,
    installedAt: record.installed_at,
    marketId: record.market_id ?? undefined,
  };
}

/** Registry group for an installed plugin: its market id, or "url" for a
 *  pasted URL. Shared by the registry and the conflict check. */
function installGroup(marketId: string | null | undefined): string {
  return marketId ?? 'url';
}

/**
 * Rejects installing plugin `id` when a different group already owns that
 * id (e.g. installed from a pasted URL, now installing from a market).
 * Module-scope SDK lookups (`usePluginSdkFor`, `getPluginSdk`) only know the
 * id, so two groups with the same id would share storage, audit entries and
 * permissions.
 *
 * Call before `installArtifact`/`installPlugin`; callers already have the
 * id from the preview they showed. Applies to plugins only.
 *
 * `registeredGroup` is the group currently registered under `id`
 * (`getPlugin(id)?.group`), passed in because registry.ts imports this
 * module. Only a built-in ('core') registration is trusted here; other
 * registrations may be stale within the session, so installed records on
 * disk are checked instead.
 */
export async function assertNoConflictingInstall(
  id: string,
  marketId: string | undefined,
  registeredGroup?: string,
): Promise<void> {
  const newGroup = installGroup(marketId);

  if (registeredGroup === 'core' && registeredGroup !== newGroup) {
    throw new Error(`Plugin "${id}" trùng id với một tool có sẵn trong app — đổi id khác trong manifest.`);
  }

  let installed: InstalledPluginRecord[];
  try {
    installed = await listInstalledPlugins();
  } catch {
    // An unreadable index is reported by the install call itself.
    return;
  }
  const conflict = installed.find((r) => r.manifest.id === id && installGroup(r.marketId) !== newGroup);
  if (conflict) {
    const oldGroup = installGroup(conflict.marketId);
    throw new Error(
      `Plugin "${id}" đã được cài từ nguồn khác ("${oldGroup}"). ` +
        `Gỡ bản đó trong Settings → Extensions trước khi cài từ nguồn "${newGroup}".`,
    );
  }
}

// Kind-agnostic API (Settings → Extensions)

/** Fetches and validates a manifest without downloading the artifact. */
export async function fetchArtifactManifestPreview(url: string): Promise<RemoteArtifactManifest> {
  return invokeCommand<RemoteArtifactManifest>('artifact_installer_fetch_manifest', { url });
}

/** Downloads, verifies and stores the artifact at `url` (Rust branches on
 *  `kind`). `marketId` is set when the URL comes from a marketplace card.
 *  `expectedManifest` is the manifest the user approved in a preview: Rust
 *  fetches it again and refuses the install if it differs.
 *  Call `assertNoConflictingInstall` first. */
export async function installArtifact(
  url: string,
  marketId?: string,
  expectedManifest?: RemoteArtifactManifest,
): Promise<InstalledArtifactRecord> {
  const raw = await invokeCommand<RawInstalledArtifactRecord>('artifact_installer_install', {
    sourceUrl: url,
    marketId,
    expectedManifest,
  });
  return toCamelArtifactRecord(raw);
}

export async function listInstalledArtifacts(): Promise<InstalledArtifactRecord[]> {
  if (!isTauri) return [];
  const raw = await invokeCommand<RawInstalledArtifactRecord[]>('artifact_installer_list');
  return raw.map(toCamelArtifactRecord);
}

/** Uninstalls by plugin id or service bin. For a plugin, `marketId` must
 *  match the record's, or nothing is found. */
export async function uninstallArtifact(key: string, marketId?: string): Promise<void> {
  await invokeCommand<void>('artifact_installer_uninstall', { key, marketId });
}

/** Target triple computed by the host, shown when previewing a service. */
export async function currentTargetTriple(): Promise<string> {
  return invokeCommand<string>('artifact_installer_current_target_triple');
}

// Plugins

/** Previews a plugin manifest; throws if the URL declares another kind. */
export async function fetchManifestPreview(url: string): Promise<RemotePluginManifest> {
  const manifest = await fetchArtifactManifestPreview(url);
  if (manifest.kind !== 'plugin') {
    throw new Error(`URL này khai "kind": "${manifest.kind}", không phải "plugin".`);
  }
  const { kind: _kind, ...rest } = manifest;
  return rest;
}

/** Downloads, verifies and stores a plugin. Throws the host's message on
 *  network, format or checksum errors. */
export async function installPlugin(url: string, marketId?: string): Promise<InstalledPluginRecord> {
  const record = await installArtifact(url, marketId);
  if (record.kind !== 'plugin') {
    throw new Error(`URL này cài một "${record.kind}", không phải plugin.`);
  }
  const { kind: _kind, ...rest } = record;
  return rest;
}

export async function listInstalledPlugins(): Promise<InstalledPluginRecord[]> {
  const records = await listInstalledArtifacts();
  return records
    .filter((r): r is Extract<InstalledArtifactRecord, { kind: 'plugin' }> => r.kind === 'plugin')
    .map(({ kind: _kind, ...rest }) => rest);
}

export async function uninstallPlugin(id: string, marketId?: string): Promise<void> {
  await uninstallArtifact(id, marketId);
}

/** Compares the installed version with the one at `sourceUrl`, numerically
 *  per dot-separated part (no pre-release handling). */
export async function checkForUpdate(
  record: InstalledPluginRecord,
): Promise<{ available: boolean; remote?: RemotePluginManifest }> {
  const remote = await fetchManifestPreview(record.sourceUrl);
  return { available: compareVersions(remote.version, record.manifest.version) > 0, remote };
}

// Services

export async function installService(url: string, marketId?: string): Promise<InstalledServiceRecord> {
  const record = await installArtifact(url, marketId);
  if (record.kind !== 'service') {
    throw new Error(`URL này cài một "${record.kind}", không phải service.`);
  }
  const { kind: _kind, ...rest } = record;
  return rest;
}

export async function listInstalledServices(): Promise<InstalledServiceRecord[]> {
  const records = await listInstalledArtifacts();
  return records
    .filter((r): r is Extract<InstalledArtifactRecord, { kind: 'service' }> => r.kind === 'service')
    .map(({ kind: _kind, ...rest }) => rest);
}

export async function uninstallService(bin: string): Promise<void> {
  await uninstallArtifact(bin);
}

export async function checkForServiceUpdate(
  record: InstalledServiceRecord,
): Promise<{ available: boolean; remote?: RemoteServiceManifest }> {
  const manifest = await fetchArtifactManifestPreview(record.sourceUrl);
  if (manifest.kind !== 'service') {
    throw new Error(`Nguồn đã cài không còn khai "kind": "service" (hiện là "${manifest.kind}").`);
  }
  const { kind: _kind, ...remote } = manifest;
  return { available: compareVersions(remote.version, record.manifest.version) > 0, remote };
}

// Update check for every installed artifact (ExtensionUpdateContext)

export interface ArtifactUpdateAvailable {
  /** `recordKey(record)`; matches the rows in SettingsExtensionInstaller. */
  key: string;
  record: InstalledArtifactRecord;
  remoteVersion: string;
}

/** Identifies a record in the installed list: the bare id or bin, or
 *  `<marketId>::<id>` for a plugin from a market (two markets may share an
 *  id). Services always use `bin`. Shared with SettingsExtensionInstaller so
 *  update badges match rows. */
export function recordKey(record: InstalledArtifactRecord): string {
  if (record.kind === 'service') return record.manifest.bin;
  return record.marketId ? `${record.marketId}::${record.manifest.id}` : record.manifest.id;
}

/**
 * A plugin that declares `service.bin` and the service record with that bin
 * belong together. Returns the other half when the pairing is exclusive: for
 * a plugin, its sidecar if no other installed plugin uses it; for a service,
 * its only dependent plugin. Shared sidecars and unused services are left
 * for the user to manage separately.
 */
export function findCoupledRecord(
  record: InstalledArtifactRecord,
  installed: InstalledArtifactRecord[],
): InstalledArtifactRecord | undefined {
  if (record.kind === 'plugin') {
    const bin = record.manifest.service?.bin;
    if (!bin) return undefined;
    const service = installed.find((r): r is Extract<InstalledArtifactRecord, { kind: 'service' }> =>
      r.kind === 'service' && r.manifest.bin === bin,
    );
    if (!service) return undefined;
    const otherDependents = installed.filter(
      (r) => r.kind === 'plugin' && r.manifest.id !== record.manifest.id && r.manifest.service?.bin === bin,
    );
    return otherDependents.length === 0 ? service : undefined;
  }

  const dependents = installed.filter(
    (r): r is Extract<InstalledArtifactRecord, { kind: 'plugin' }> =>
      r.kind === 'plugin' && r.manifest.service?.bin === record.manifest.bin,
  );
  return dependents.length === 1 ? dependents[0] : undefined;
}

/** Checks each installed artifact one at a time (this runs in the background
 *  at startup, so there is no need for parallel requests). A failing source
 *  only drops that entry; an unreadable index returns no updates. */
export async function checkAllForUpdates(): Promise<ArtifactUpdateAvailable[]> {
  let records: InstalledArtifactRecord[];
  try {
    records = await listInstalledArtifacts();
  } catch {
    return [];
  }
  const updates: ArtifactUpdateAvailable[] = [];
  for (const record of records) {
    try {
      if (record.kind === 'plugin') {
        const { available, remote } = await checkForUpdate(record);
        if (available && remote) updates.push({ key: recordKey(record), record, remoteVersion: remote.version });
      } else {
        const { available, remote } = await checkForServiceUpdate(record);
        if (available && remote) updates.push({ key: recordKey(record), record, remoteVersion: remote.version });
      }
    } catch {
      // Skip this entry and keep checking the rest.
    }
  }
  return updates;
}

/**
 * Loads an installed bundle (the host re-verifies its checksum) and imports
 * it from a `blob:` URL. This is why the CSP allows `blob:` in `script-src`
 * (tauri.conf.json). The URL is revoked once the module has evaluated.
 */
async function loadInstalled(id: string, marketId: string | undefined): Promise<React.ComponentType> {
  const [source] = await Promise.all([
    invokeCommand<string>('artifact_installer_read_bundle', { id, marketId }),
    ensureVendorUi(),
  ]);
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default: React.ComponentType };
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Sets `window.__DEVTOOL_VENDOR__.ui` (see vendorUi.ts) before a bundle runs,
 * since bundles read it synchronously at top level. Loads once.
 */
export async function ensureVendorUi(): Promise<void> {
  if (typeof window === 'undefined' || !window.__DEVTOOL_VENDOR__ || window.__DEVTOOL_VENDOR__.ui) return;
  window.__DEVTOOL_VENDOR__.ui = await import('./vendorUi');
}

/** Installed plugins sort after every built-in plugin, in install order. */
const INSTALLED_ORDER_BASE = 100_000;

/** Converts installed plugin records to registry manifests. */
export async function installedPluginManifests(): Promise<
  Array<{ manifest: PluginManifest; source: string }>
> {
  if (!isTauri) return [];
  let records: InstalledPluginRecord[];
  try {
    records = await listInstalledPlugins();
  } catch {
    // An unreadable index must not block startup; treat it as empty.
    return [];
  }

  return records.map((record, i) => {
    const group = installGroup(record.marketId);
    return {
      source: `installed:${group}:${record.manifest.id}@${record.manifest.version}`,
      manifest: {
        // Plugin bundles call `usePluginSdkFor(id)` with the bare id, so
        // that is the registry id. The install UI runs
        // `assertNoConflictingInstall` on the previewed id, but nothing
        // enforces uniqueness at install time. Storage and secret namespaces
        // are keyed by it too.
        id: record.manifest.id,
        group,
        label: record.manifest.label,
        icon: ICONS_BY_NAME[record.manifest.icon] ?? Puzzle,
        description: record.manifest.description,
        keywords: record.manifest.keywords,
        // Installed plugins always use this route form; the manifest's
        // own `route` is ignored.
        route: `/installed/${group}/${record.manifest.id}`,
        order: INSTALLED_ORDER_BASE + i,
        defaultEnabled: true,
        permissions: record.manifest.permissions,
        commands: record.manifest.commands,
        hosts: record.manifest.hosts,
        service: record.manifest.service,
        sdk: record.manifest.sdk,
        load: () => loadInstalled(record.manifest.id, record.marketId),
      },
    };
  });
}
