import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts — bundled by Vite, work offline, render identically on
// macOS / Windows / Linux.
//
// Two sans faces are loaded on purpose during G1: the /type-specimen route
// switches --sans between them so the Vietnamese diacritics can be judged in
// the real webview before one is locked in. The loser gets deleted at the end
// of G1 — this is a temporary two-font state, not the intended end state.
import '@fontsource-variable/inter';
// Be Vietnam Pro has no variable build on fontsource, so the three weights the
// app actually uses are loaded individually. The `vietnamese` subset carries
// the stacked diacritics (ế ộ ữ) that the latin subset does not.
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
// IBM Plex Mono — the first real monospace the app has ever had. `font-mono` is
// used in 356 places but `fontFamily.mono` was never declared, so every one of
// them fell back to Courier New on Windows and Linux.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/globals.css';
import { clearPersistentStore, initPersistentStore } from './lib/persistentStore';

// The app's module graph (App.tsx and everything it imports, e.g.
// src/lib/liveConnections.ts) reads persisted state synchronously at
// module-load time in places, so it must not be evaluated until the
// persistent store's in-memory cache is hydrated. A static `import App from
// './App'` at the top of this file would run before the awaits below —
// deferring it to a dynamic import() inside bootstrap() is what guarantees
// the ordering.
async function bootstrap() {
  await initPersistentStore();

  // DEV ONLY: wipe all persisted app state on each `npm run tauri:dev` launch
  // so features can be tested from a clean slate. Stripped from production
  // builds (import.meta.env.DEV is false), and skipped on the web dev server.
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (import.meta.env.DEV && isTauri) {
    await clearPersistentStore();
  }

  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
