import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ServiceDescriptor } from './service';

/**
 * Contract between the platform and plugins.
 *
 * Every tool is a plugin: a folder `src/plugins/<id>/` whose `plugin.ts`
 * default-exports a `PluginManifest`. `registry.ts` discovers them; there is
 * no hand-maintained list. `registry.test.ts` checks their integrity.
 */

/** Platform SDK version. Plugins declare a range such as `sdk: '^1.0.0'`. */
export const SDK_VERSION = '1.1.0';

/**
 * Permissions a plugin must declare before using the matching SDK channel.
 *
 * Not a security boundary: plugins run in the app's JS realm and could call
 * Tauri directly. Permissions make access visible to the user, catch use of
 * undeclared channels early, and label entries in the audit log (audit.ts).
 * They would map to Tauri capabilities if plugins ever ran in their own
 * webview or process.
 */
export type PluginPermission =
  | 'storage'
  | 'secrets'
  | 'clipboard:read'
  | 'clipboard:write'
  | 'files:read'
  | 'files:write'
  | 'open-url'
  | 'http'
  | 'native'
  | 'service';

export interface PluginManifest {
  /**
   * kebab-case id the plugin uses to look itself up (`usePluginSdkFor(id)`,
   * `getPluginSdk(id)`). Also the enable/disable key and storage namespace.
   * Unique app-wide in practice: installer.ts refuses an id already owned by
   * another `group`, because module-scope SDK lookups only know the id.
   */
  id: string;
  /**
   * Where the plugin was installed from. Metadata only; storage and audit
   * are keyed by `id`. Used for installed-plugin routes
   * (`/installed/<group>/<id>`), display in Settings, and conflict checks.
   *
   * `"core"` for built-in plugins (filled in by registry.ts), `"url"` for a
   * pasted manifest URL, otherwise the market id.
   */
  group?: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Search synonyms for the sidebar (e.g. "epoch" for Date/Time). */
  keywords?: string[];
  /**
   * Shows an "Experimental" label and asks for confirmation on every open
   * (`ExperimentalGate`). For plugins whose behavior is still changing.
   */
  experimental?: boolean;
  /** Absolute route starting with "/". Unique app-wide. */
  route: string;
  /** Default sidebar position for new installs; lower first, unique. */
  order: number;
  /** Initial enabled state for new installs; users can change it. */
  defaultEnabled: boolean;
  /**
   * The plugin manages its own overflow instead of the shell's scroll
   * wrapper. Defaults to `true`.
   */
  fullHeight?: boolean;
  /** SDK channels the plugin may use. Undeclared channels throw. */
  permissions?: PluginPermission[];
  /**
   * Tauri commands the plugin may `invoke` (requires 'native'). Entries match
   * by prefix: `'redis_'` allows every `redis_*` command.
   */
  commands?: string[];
  /**
   * Hosts the plugin may call (requires 'http'): `'dns.google'` (exact),
   * `'*.example.com'` (domain and subdomains), or `'*'` (anything). `'*'` must
   * be declared explicitly.
   */
  hosts?: string[];
  /**
   * Tier-B sidecar this plugin needs; requires the 'service' permission.
   * See service.ts.
   */
  service?: ServiceDescriptor;
  /** Supported SDK range, `^M.m.p`. */
  sdk: string;
  /** Loads the main component lazily on first navigation (code-split). */
  load: () => Promise<ComponentType>;
}

/** Validated manifest with defaults filled in. */
export interface PluginRecord extends PluginManifest {
  /** Always set; `registerManifest` defaults it to `'core'`. */
  group: string;
  keywords: string[];
  experimental: boolean;
  fullHeight: boolean;
  permissions: PluginPermission[];
  commands: string[];
  /** Component the router renders: `load` wrapped in `lazy` and the plugin's context. */
  component: ComponentType;
}

/** A manifest rejected by the registry, with the reason. */
export interface PluginLoadError {
  /** Manifest file path, to know where to fix it. */
  source: string;
  id?: string;
  reason: string;
}
