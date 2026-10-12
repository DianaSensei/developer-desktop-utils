import { lazy } from 'react';
import { withPluginSdk } from './context';
import { validateManifest } from './manifest';
import { createPluginSdk } from './sdk';
import { isTauri } from '@/lib/platform';
import { installedPluginManifests } from './installer';
import type { PluginLoadError, PluginManifest, PluginRecord } from './types';

/**
 * Plugin registry. Built-in plugins are discovered from
 * `src/plugins/<id>/plugin.ts` at build time; installed plugins are added at
 * startup by `initInstalledPlugins()`. Both go through `registerManifest`,
 * so they share the same validation and uniqueness rules.
 *
 * `eager: true` only imports manifests (metadata plus an uncalled `load`),
 * so tool code still lives in its own lazily loaded chunk while sidebar,
 * command palette and settings can read metadata synchronously.
 */
const modules = import.meta.glob<{ default: PluginManifest }>('../plugins/*/plugin.ts', {
  eager: true,
});

const errors: PluginLoadError[] = [];
const records: PluginRecord[] = [];

/** Declared before the glob loop below because `registerManifest`, called in
 *  that loop, writes to it. */
export const PLUGIN_MAP: Map<string, PluginRecord> = new Map();

// Ids are unique app-wide (installer.ts rejects an id owned by another
// group), so one flat map is enough.
const seenIds = new Map<string, string>();
const seenRoutes = new Map<string, string>();
const seenOrders = new Map<number, string>();

/**
 * Registers a manifest, built-in or installed. `requireFolderMatch` applies
 * to built-in plugins only: the folder name must equal the id.
 */
function registerManifest(
  manifest: unknown,
  source: string,
  options: { requireFolderMatch?: boolean } = {},
): void {
  const problems = validateManifest(manifest);
  if (problems.length > 0) {
    errors.push({ source, id: (manifest as PluginManifest | undefined)?.id, reason: problems.join('; ') });
    return;
  }

  const m = manifest as PluginManifest;
  if (options.requireFolderMatch) {
    // The folder is the identity: `src/plugins/json/plugin.ts` must
    // declare id 'json'.
    const folder = /\/plugins\/([^/]+)\/plugin\.ts$/.exec(source)?.[1];
    if (folder && folder !== m.id) {
      errors.push({ source, id: m.id, reason: `id "${m.id}" không khớp tên thư mục "${folder}"` });
      return;
    }
  }

  const clash =
    (seenIds.has(m.id) && `id "${m.id}" đã dùng ở ${seenIds.get(m.id)}`) ||
    (seenRoutes.has(m.route) && `route "${m.route}" đã dùng ở ${seenRoutes.get(m.route)}`) ||
    (seenOrders.has(m.order) && `order ${m.order} đã dùng ở ${seenOrders.get(m.order)}`);
  if (clash) {
    errors.push({ source, id: m.id, reason: clash });
    return;
  }
  seenIds.set(m.id, source);
  seenRoutes.set(m.route, source);
  seenOrders.set(m.order, source);

  const sdk = createPluginSdk(m);
  const record: PluginRecord = {
    ...m,
    // Built-in manifests omit `group`; installed ones always set it.
    group: m.group ?? 'core',
    keywords: m.keywords ?? [],
    experimental: m.experimental ?? false,
    fullHeight: m.fullHeight ?? true,
    permissions: m.permissions ?? [],
    commands: m.commands ?? [],
    component: lazy(async () => ({ default: withPluginSdk(sdk, await m.load()) })),
  };
  records.push(record);
  records.sort((a, b) => a.order - b.order);
  // Keep the map in sync: installed plugins are registered after the
  // initial build of `records`.
  PLUGIN_MAP.set(record.id, record);
}

for (const source of Object.keys(modules).sort()) {
  registerManifest(modules[source]?.default, source, { requireFolderMatch: true });
}

/** Every valid plugin, sorted by `order`. Installed plugins are pushed into
 *  this same array at startup, before anything reads it. */
export const PLUGINS: readonly PluginRecord[] = records;

/**
 * Rejected manifests and why. Empty for built-in plugins in a healthy build
 * (enforced by `registry.test.ts`); rejected installed plugins are listed
 * here and shown in Settings → Extensions.
 */
export const PLUGIN_ERRORS: PluginLoadError[] = errors;

/** Sidebar order for new installs. */
export const DEFAULT_PLUGIN_ORDER: readonly string[] = records.map((p) => p.id);

/** Default enabled state for new installs, keyed like FeatureContext. */
export const DEFAULT_PLUGIN_FEATURES: Readonly<Record<string, boolean>> = Object.fromEntries(
  records.map((p) => [p.id, p.defaultEnabled]),
);

export function getPlugin(id: string): PluginRecord | undefined {
  return PLUGIN_MAP.get(id);
}

/**
 * Registers installed plugins. Called once in main.tsx before rendering, so
 * every consumer of `PLUGINS` sees the full list on first paint. No-op on
 * the web. Installing or removing a plugin takes effect after a restart,
 * which Settings asks for.
 */
export async function initInstalledPlugins(): Promise<void> {
  if (!isTauri) return;
  const manifests = await installedPluginManifests();
  for (const { manifest, source } of manifests) {
    registerManifest(manifest, source);
  }
}
