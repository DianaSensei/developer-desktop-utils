import React from 'react';
import ReactDOM from 'react-dom/client';
import * as ReactDOMFull from 'react-dom';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { usePluginSdk } from './platform/context';
import { usePluginState, migrateLegacyKey } from './platform/usePluginState';
import { usePluginConfig, useLiveConnection, usePluginMcpBridgeActive } from './platform/services';
import { usePluginSdkFor, getPluginSdk } from './platform/usePluginSdkFor';

// Bản React/ReactDOM DÙNG CHUNG cho plugin cài từ bên ngoài (xem
// `src/platform/installer.ts`, phần "REACT DÙNG CHUNG"). Một bundle plugin
// mang theo bản React RIÊNG của nó sẽ vỡ hook: hai bản React trong cùng một
// cây component là lỗi "Invalid hook call" kinh điển, vì hook đọc trạng thái
// nội bộ gắn với ĐÚNG một instance của React. Gán TRƯỚC bất cứ import động
// nào của một plugin có thể chạy — nghĩa là ngay ở đây, phần trên cùng của
// file được evaluate sớm nhất trong toàn bộ app.
//
// `platform.usePluginSdk`/`usePluginState`/`usePluginConfig` cùng lý do: một
// plugin cài từ URL được `registry.ts` bọc bằng `withPluginSdk` (Provider) từ
// CHÍNH module `context.ts` này, nhưng bundle của plugin không `import` được
// module đó (module riêng, không nằm trong build của nó) — expose thẳng ba
// hook qua vendor object là cách duy nhất để code trong bundle đọc được đúng
// React Context instance mà `withPluginSdk` đã set giá trị vào. Không hàm nào
// trong ba hàm này tự nới quyền: `usePluginSdk()` vẫn ném nếu gọi ngoài cây
// plugin, và `sdk.*` bên trong vẫn kiểm đúng `permissions` plugin đã khai ở
// manifest kind="plugin" của nó — xem docs/plugin-sdk/05-external-install.md.
//
// Tác giả plugin cấu hình build của mình coi `react`/`react-dom`/
// `react/jsx-runtime` là "external", trỏ ba module đó về đây thay vì tự
// bundle — xem hướng dẫn tác giả plugin trong
// docs/decisions/architecture/platform-plugin-architecture.md.
declare global {
  interface Window {
    __DEVTOOL_VENDOR__: {
      react: typeof React;
      reactDom: typeof ReactDOM;
      reactDomFull: typeof ReactDOMFull;
      jsxRuntime: { jsx: typeof jsx; jsxs: typeof jsxs; Fragment: typeof Fragment };
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
// Self-hosted fonts — bundled by Vite, work offline, render identically on
// macOS / Windows / Linux.
//
// Be Vietnam Pro, chosen over Inter after comparing both in the real webview at
// the sizes the app actually uses. It has no variable build on fontsource, so
// each weight is loaded individually. The `vietnamese` subset carries the
// stacked diacritics (ế ộ ữ) that the latin subset does not.
//
// 700 is loaded alongside 400/500/600 because `font-bold` is real Tailwind
// weight 700, not an alias for 600 — every one of the app's ~20 `font-bold`
// usages (Stat's headline number, tab counts, method badges, …) had no
// matching @font-face at that weight, so the browser fell back to synthetic
// bold: skewing/thickening the 600 outline instead of drawing the type
// designer's actual 700 glyphs. That's the harshest on exactly the letterforms
// Be Vietnam Pro was chosen for — stacked Vietnamese diacritics distort worst
// under synthesis — so it reads as "unbalanced/broken" precisely where the
// font was supposed to be the strong point.
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
// IBM Plex Mono — the first real monospace the app has ever had. `font-mono` is
// used in 356 places but `fontFamily.mono` was never declared, so every one of
// them fell back to Courier New on Windows and Linux. Same synthetic-bold gap
// as above for any `font-mono font-bold` combination (status code chips,
// header names) — 700 closes it here too.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
// Fira Code — the alternative code font (opt-in, Settings → Code font). Loaded
// unconditionally alongside IBM Plex Mono like every other self-hosted face
// here: switching the preference just flips `--mono` (see monoFontPreference.ts
// / tokens.css's `[data-mono-font]`), so the face has to already be on the
// page before that switch can take effect.
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/fira-code/latin-500.css';
import '@fontsource/fira-code/latin-600.css';
import '@fontsource/fira-code/latin-700.css';
import './styles/globals.css';
import { clearPersistentStore, initPersistentStore } from './lib/persistentStore';
// Nhập thẳng từ module kho, KHÔNG qua barrel '@/platform': barrel kéo theo
// registry và toàn bộ manifest plugin vào đồ thị module chạy trước bootstrap,
// đúng thứ ghi chú ở trên đang cố tránh.
import {
  clearSecrets,
  migrateSecretsFromPlainStore,
  migrateSecretsFromSharedStore,
} from './platform/secrets';
import { applyAccentToDocument, getAccentPreference } from './lib/accentPreference';
import { applyCornerToDocument, getCornerPreference } from './lib/cornerPreference';
import { applyFontToDocument, getFontPreference } from './lib/fontPreference';
import { applyMonoFontToDocument, getMonoFontPreference } from './lib/monoFontPreference';
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
    // Kho bí mật là file riêng nên `clearPersistentStore()` không chạm tới:
    // thiếu dòng này, "chạy dev từ trạng thái sạch" vẫn còn nguyên seed 2FA cũ.
    await clearSecrets();
  }

  // Dời bí mật ra khỏi mặt phẳng khoá dùng chung. Phải chạy SAU
  // `initPersistentStore()` (nguồn đọc từ cache của nó) và TRƯỚC khi nạp App —
  // nếu không, tool đọc bí mật có thể mount trước lúc dữ liệu kịp sang kho và
  // hiển thị trạng thái rỗng cho tới lần mở app sau.
  // Hai bước, đúng thứ tự này: bản trung gian đã tách mặt phẳng khoá nhưng để
  // kho ở dạng trần, nên dọn nó trước; rồi mới kéo phần còn sót trong store
  // dùng chung của những máy nhảy thẳng từ bản cũ hơn.
  await migrateSecretsFromPlainStore();
  await migrateSecretsFromSharedStore();

  // Áp dụng tone chủ đạo TRƯỚC lần vẽ đầu tiên — nếu không, người dùng đã chọn
  // teal sẽ thấy đúng một khung hình azure mặc định trước khi kịp đổi.
  // Không cần hook: tone không có tín hiệu bên ngoài nào để theo dõi liên tục
  // như dark-mode hệ thống, chỉ cần áp một lần lúc khởi động; đổi tại chỗ về
  // sau do Settings tự set thẳng lên <html> khi người dùng bấm chọn.
  applyAccentToDocument(getAccentPreference());
  applyCornerToDocument(getCornerPreference());
  applyFontToDocument(getFontPreference());
  applyMonoFontToDocument(getMonoFontPreference());

  // Nạp plugin đã cài từ bên ngoài TRƯỚC khi App đọc `PLUGINS` lần đầu — một
  // plugin cài từ mạng chỉ đọc được lúc chạy (từ đĩa máy người dùng), không
  // sớm hơn, khác hẳn 26 plugin compile-time đã có sẵn lúc build. Import động
  // (không phải `import { initInstalledPlugins } from './platform/registry'`
  // ở đầu file) vì cùng lý do App được nạp động bên dưới: registry.ts quét
  // toàn bộ `src/plugins/*/plugin.ts` ngay khi module của nó được evaluate,
  // và cái đó không nên nằm trên đường import đồng bộ, chặn-render-đầu-tiên
  // của chính file bootstrap này.
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
