import React from 'react';
import ReactDOM from 'react-dom/client';
import * as ReactDOMFull from 'react-dom';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { usePluginSdk } from './platform/context';
import { usePluginState, migrateLegacyKey } from './platform/usePluginState';
import { usePluginConfig, useLiveConnection, usePluginMcpBridgeActive } from './platform/services';
import { usePluginSdkFor, getPluginSdk } from './platform/usePluginSdkFor';

// Shared React/ReactDOM for installed plugins. A bundle with its own React
// copy would break hooks ("Invalid hook call"), so plugins mark `react`,
// `react-dom` and `react/jsx-runtime` as external and read them from here.
// Set before any plugin can load.
//
// `platform.usePluginSdk`/`usePluginState`/`usePluginConfig` are exposed for
// the same reason: a bundle cannot import the host's context module, so this
// is how it reaches the context `withPluginSdk` provides. None of them grants
// anything: `sdk.*` still enforces the plugin's declared permissions. See
// docs/plugin-sdk/05-external-install.md and
// docs/decisions/architecture/platform-plugin-architecture.md.
declare global {
  interface Window {
    __DEVTOOL_VENDOR__: {
      react: typeof React;
      reactDom: typeof ReactDOM;
      reactDomFull: typeof ReactDOMFull;
      jsxRuntime: { jsx: typeof jsx; jsxs: typeof jsxs; Fragment: typeof Fragment };
      /** Host UI kit, loaded lazily before a plugin bundle runs. SDK ≥ 1.1.0. */
      ui?: typeof import('./platform/vendorUi');
      platform: {
        usePluginSdk: typeof usePluginSdk;
        usePluginSdkFor: typeof usePluginSdkFor;
        getPluginSdk: typeof getPluginSdk;
        usePluginState: typeof usePluginState;
        migrateLegacyKey: typeof migrateLegacyKey;
        usePluginConfig: typeof usePluginConfig;
        useLiveConnection: typeof useLiveConnection;
        usePluginMcpBridgeActive: typeof usePluginMcpBridgeActive;
      };
    };
  }
}
window.__DEVTOOL_VENDOR__ = {
  react: React,
  reactDom: ReactDOM,
  reactDomFull: ReactDOMFull,
  jsxRuntime: { jsx, jsxs, Fragment },
  platform: {
    usePluginSdk,
    usePluginSdkFor,
    getPluginSdk,
    usePluginState,
    migrateLegacyKey,
    usePluginConfig,
    useLiveConnection,
    usePluginMcpBridgeActive,
  },
};
// Self-hosted fonts, bundled so they work offline and look the same on
// every OS. Be Vietnam Pro has no variable build, so each weight is loaded;
// the `vietnamese` subset carries stacked diacritics. Weight 700 is loaded
// so `font-bold` uses real glyphs instead of synthetic bold.
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
// IBM Plex Mono, the default code font (700 for `font-mono font-bold`).
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
// Fira Code, the alternative code font. Loaded up front because switching
// only changes `--mono` (monoFontPreference.ts).
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/fira-code/latin-500.css';
import '@fontsource/fira-code/latin-600.css';
import '@fontsource/fira-code/latin-700.css';
import './styles/globals.css';
import { clearPersistentStore, initPersistentStore } from './lib/persistentStore';
// Imported from the module directly, not the '@/platform' barrel, which
// would pull the registry and every plugin manifest in before bootstrap.
import {
  clearSecrets,
  migrateSecretsFromPlainStore,
  migrateSecretsFromSharedStore,
  migrateVaultMoves,
} from './platform/secrets';
import { applyAccentToDocument, getAccentPreference } from './lib/accentPreference';
import { applyCornerToDocument, getCornerPreference } from './lib/cornerPreference';
import { applyFontToDocument, getFontPreference } from './lib/fontPreference';
import { applyMonoFontToDocument, getMonoFontPreference } from './lib/monoFontPreference';
import { isTauri } from './lib/platform';

// Parts of the app read persisted state synchronously at module load, so
// App is imported dynamically after the store cache is hydrated.
async function bootstrap() {
  await initPersistentStore();

  // Dev only: start each `npm run tauri:dev` with clean persisted state.
  if (import.meta.env.DEV && isTauri) {
    await clearPersistentStore();
    // The secret vault is separate, so clear it too.
    await clearSecrets();
  }

  // Move secrets out of the shared store after initPersistentStore() and
  // before App loads, so tools never mount with empty secrets. The plain
  // legacy vault is migrated first, then leftovers in the shared store.
  await migrateSecretsFromPlainStore();
  await migrateSecretsFromSharedStore();
  // Then entries whose owning plugin changed (JWT Debugger → Encode tab).
  await migrateVaultMoves();

  // Apply the accent before first paint to avoid a flash of the default.
  applyAccentToDocument(getAccentPreference());
  applyCornerToDocument(getCornerPreference());
  applyFontToDocument(getFontPreference());
  applyMonoFontToDocument(getMonoFontPreference());

  // Register installed plugins before App first reads `PLUGINS`. Imported
  // dynamically, like App, so the registry's manifest scan stays off this
  // file's synchronous import path.
  const { initInstalledPlugins } = await import('./platform/registry');
  await initInstalledPlugins();

  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
