import capabilities from '../../src-tauri/capabilities/default.json';

/**
 * Single source of truth for the Settings "App Permissions" panel: this
 * module derives its output directly from src-tauri/capabilities/default.json
 * so the UI can never drift from what's actually declared/granted.
 */

type RawPermission =
  | string
  | { identifier: string; allow?: { url: string }[]; [key: string]: unknown };

export interface AppPermission {
  /** Exact permission identifier as declared in the capabilities file, e.g. "fs:allow-read-file". */
  identifier: string;
  /** Human description from PERMISSION_DESCRIPTIONS, or undefined if not catalogued yet. */
  description?: string;
  /** For object-form entries (e.g. http:default), the raw allow-list URL patterns, verbatim. */
  allowUrls?: string[];
}

export interface AppPermissionGroup {
  namespace: string;
  /** Friendly label for the namespace, or the namespace itself if not catalogued. */
  name: string;
  permissions: AppPermission[];
}

/** Lookup table: namespace -> friendly display name. Namespaces missing here fall back to showing the raw namespace as their name. */
const NAMESPACE_NAMES: Record<string, string> = {
  'clipboard-manager': 'Clipboard',
  fs: 'File System',
  dialog: 'File Dialogs',
  opener: 'Opener',
  http: 'Network',
  core: 'Core',
  process: 'Process',
  updater: 'Updater',
  store: 'Store',
  'window-state': 'Window State',
};

/** Lookup table: permission identifier -> human-readable description. Permissions missing here render with the identifier only. */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'opener:allow-open-url': "Open a URL in your default browser",
  'opener:allow-default-urls': 'Open default system URLs (e.g. mailto links)',
  'opener:allow-reveal-item-in-dir': 'Reveal a file or folder in Finder/Explorer',
  'clipboard-manager:allow-read-text': "Read text you've copied, for quick paste",
  'clipboard-manager:allow-write-text': 'Write tool output to your clipboard',
  'clipboard-manager:allow-read-image': 'Read images from your clipboard for paste',
  'clipboard-manager:allow-write-image': 'Write generated images to your clipboard',
  'dialog:allow-open': 'Open the native file picker to browse for files',
  'dialog:allow-save': 'Open the native save dialog to export files',
  'fs:allow-read-file': 'Read files you explicitly select or that live in app data',
  'fs:allow-write-file': 'Write files you explicitly select or that live in app data',
  'fs:scope-appdata-recursive': "Limit file access to this app's AppData folder and subfolders",
  'process:allow-restart': 'Restart the app to finish installing an update',
  'updater:allow-check': 'Check GitHub for new app versions',
  'updater:allow-download-and-install': 'Download and install app updates',
  'store:default': 'Save app settings and preferences to local storage',
  'window-state:default': 'Remember window size and position between launches',
  'http:default': 'Send HTTP requests to the domains listed below',
  'core:default': 'Baseline Tauri IPC access (window, app, path, events) the app needs to run',
};

function normalize(raw: RawPermission): AppPermission {
  if (typeof raw === 'string') {
    return { identifier: raw, description: PERMISSION_DESCRIPTIONS[raw] };
  }
  return {
    identifier: raw.identifier,
    description: PERMISSION_DESCRIPTIONS[raw.identifier],
    allowUrls: raw.allow?.map((a) => a.url),
  };
}

/** Groups every permission declared in capabilities/default.json by its namespace (the part before the first ":"). */
export function getAppPermissionGroups(): AppPermissionGroup[] {
  const raw = (capabilities.permissions ?? []) as RawPermission[];
  const byNamespace = new Map<string, AppPermission[]>();

  for (const entry of raw) {
    const permission = normalize(entry);
    const namespace = permission.identifier.split(':')[0];
    const list = byNamespace.get(namespace) ?? [];
    list.push(permission);
    byNamespace.set(namespace, list);
  }

  return Array.from(byNamespace.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, permissions]) => ({
      namespace,
      name: NAMESPACE_NAMES[namespace] ?? namespace,
      permissions,
    }));
}
