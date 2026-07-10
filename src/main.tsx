import React from 'react';
import ReactDOM from 'react-dom/client';
// Inter — self-hosted variable font (bundled by Vite, works offline, identical
// on macOS / Windows / Linux). One UI typeface for the whole app.
import '@fontsource-variable/inter';
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
