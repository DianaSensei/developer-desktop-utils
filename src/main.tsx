import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts — bundled by Vite, work offline, render identically on
// macOS / Windows / Linux.
//
// Be Vietnam Pro, chosen over Inter after comparing both in the real webview at
// the sizes the app actually uses. It has no variable build on fontsource, so
// the three weights are loaded individually. The `vietnamese` subset carries the
// stacked diacritics (ế ộ ữ) that the latin subset does not.
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
import { applyAccentToDocument, getAccentPreference } from './lib/accentPreference';
import { isTauri } from './lib/platform';

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
  if (import.meta.env.DEV && isTauri) {
    await clearPersistentStore();
  }

  // Áp dụng tone chủ đạo TRƯỚC lần vẽ đầu tiên — nếu không, người dùng đã chọn
  // teal sẽ thấy đúng một khung hình azure mặc định trước khi kịp đổi.
  // Không cần hook: tone không có tín hiệu bên ngoài nào để theo dõi liên tục
  // như dark-mode hệ thống, chỉ cần áp một lần lúc khởi động; đổi tại chỗ về
  // sau do Settings tự set thẳng lên <html> khi người dùng bấm chọn.
  applyAccentToDocument(getAccentPreference());

  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
