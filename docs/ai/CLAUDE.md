# DevTool - Project Guide for AI Agents

> Complete reference for AI coding agents. Read this before writing any code.

## Project Overview

**DevTool** is a cross-platform desktop application built with Tauri 2 + React + TypeScript providing developer utilities (text processing, encoding, hashing, color tools, Kafka explorer, etc.).

**Key Technologies:**
- **Frontend**: React 18, TypeScript, Vite 8 (Rolldown bundler)
- **Desktop**: Tauri 2 (Rust backend)
- **UI**: Tailwind CSS, shadcn/ui components (`src/components/ui/`)
- **State**: React Context API (`FeatureContext`, `UpdateContext`)
- **Routing**: React Router v6

**Version**: 0.2.3  
**Platform Support**: macOS 11+ · Windows 10/11 · Ubuntu 22.04+

---

## Quick Start Commands

```bash
npm run dev              # Web only (fast)
npm run tauri:dev        # Desktop app
npm run build            # Build web assets
npm run tauri:build      # Build desktop binary
```

> **For AI agents — never run the app or dev server yourself.**
> Do not execute `npm run dev`, `npm run tauri:dev`, or any command that opens a port or launches a window. Instead, tell the user to run it in their own terminal. The user must control when the app starts and stops. Only `npm run build` (asset build, exits cleanly) is safe to run without asking.

---

## Project Structure

```
devtool/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui components (Button, Input, etc.)
│   │   ├── tools/           # Tool components (one per utility)
│   │   └── Settings.tsx     # Settings page (reads TOOL_DEFS; no FEATURE_LIST)
│   ├── contexts/
│   │   ├── FeatureContext.tsx  # Tool enable/disable + sidebar order
│   │   └── UpdateContext.tsx   # Auto-update state, badge, toggle
│   ├── hooks/
│   │   ├── usePersistentState.ts  # useState + localStorage
│   │   ├── useQuickPaste.ts       # ⌘V / Ctrl+V clipboard paste
│   │   └── useInputHistory.ts     # ⌘Z / ⌘⇧Z undo/redo
│   ├── lib/
│   │   ├── toolDefs.ts      # TOOL_DEFS array — single source of truth for tool metadata
│   │   ├── utils.ts         # cn() classname merger
│   │   └── clipboard.ts     # copyToClipboard() — Tauri-aware write helper
│   ├── workers/             # Web Workers for heavy computation (e.g. checksum)
│   ├── styles/
│   │   └── globals.css      # Tailwind + CSS theme variables
│   ├── App.tsx              # Router, layout, TOOL_ROUTES, sidebar, UpdateProvider
│   └── main.tsx             # React entry point
├── src-tauri/               # Tauri 2 (Rust) backend
│   ├── src/main.rs          # Rust main — registers all plugins
│   ├── Cargo.toml           # Rust dependencies
│   ├── capabilities/
│   │   └── default.json     # Permission grants (Tauri 2 capability system)
│   └── tauri.conf.json      # Tauri 2 configuration
├── docs/
│   ├── ai/                  # AI agent guides (this file)
│   └── human/               # Human contributor guides
├── public/                  # Static assets
└── package.json
```

---

## Design Principles (mandatory — read before writing any UI or feature code)

### UI Components — always use the shared library, never OS-native

- **Always** use components from `src/components/ui/` (shadcn/ui) for every interactive element: buttons, inputs, selects, dialogs, toggles, checkboxes, dropdowns.
- **Never** use browser- or OS-native elements (`<select>`, `window.alert`, `window.confirm`, native context menus, etc.). They break visual consistency across macOS / Windows / Linux.
- If a needed component doesn't exist in `src/components/ui/`, create a new shadcn/ui-style component using Radix UI primitives and Tailwind.

### UI / UX — minimalist, smooth, and user-first

- **Minimalist**: Remove every element that isn't directly serving the user's task. No decorative chrome, no nested cards inside cards.
- **Tool space first**: The content area is the hero. Inputs and outputs fill available width. Sidebars and controls shrink to the minimum.
- **Rounded-corner design**: Use `rounded-lg` or `rounded-md` consistently. Never `rounded-none` for containers or interactive elements.
- **Smooth and seamless**: All state transitions use CSS transitions or Tailwind's `transition-*` utilities. No jarring instant swaps.
- **Follow user behavior**: Primary actions where eyes land first — top-left for input, inline or right for output, icon-only for secondary actions.
- **Keyboard-first**: Respect `useQuickPaste` (⌘V) and `useInputHistory` (⌘Z/⌘⇧Z) on every text tool.

### Stability and Resource Usage — the app must never be the problem

- **No blocking the main thread**: offload heavy computation (hashing, large file reads, diffing) to a Web Worker (`src/workers/`) or a Tauri Rust command. If a task can block >16 ms, it doesn't belong in a React handler.
- **Always responsive**: Show a progress indicator while background work runs; never freeze the UI.
- **No memory leaks**: every `setInterval`, `setTimeout`, event listener, and worker must be torn down in its cleanup function.
- **Lazy-load heavy libraries**: use dynamic `import()` inside `useEffect` or `useCallback` for libraries only needed conditionally.
- **Minimize Tauri IPC**: batch or debounce calls. Never call a Tauri command in a render loop.

### Transparency — the user must always know what the app is doing

- **No silent network calls**: any network feature must be user-initiated or preceded by an explicit opt-in (toggle in Settings).
- **Document permissions**: when adding a Tauri capability, add it to the App Permissions list in `Settings.tsx` so users see what the app can access.
- **Visible progress**: file reads, downloads, and long async operations must show status (spinner, progress text, done/error state).
- **Minimum-scope access**: use the narrowest Tauri capability that the feature needs (e.g. `fs:read-file` not `fs:allow-all`).

---

## Adding a New Tool (Step-by-Step)

Tool metadata, routing, and feature toggles are kept separate. All three need updating.

### Step 1: Create the tool component

Create `src/components/tools/YourTool.tsx`. Use the **modern tool pattern**: real-time output (no "Process" button), persisted input, quick-paste, and undo/redo.

```tsx
import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { YourIcon } from 'lucide-react';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

export function YourTool() {
  const [input, setInput] = usePersistentState('devtool:yourTool:input', '');
  const output = useMemo(() => input.toUpperCase(), [input]);

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <YourIcon className="h-5 w-5" />
          Tool Name
        </CardTitle>
        <CardDescription>Brief description</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Enter something — ${quickPasteHint}`}
          />
        </div>
        {output && (
          <div className="space-y-2">
            <Label>Output</Label>
            <Textarea value={output} readOnly />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### Step 2: Add to TOOL_DEFS — `src/lib/toolDefs.ts`

`TOOL_DEFS` is the single source of truth for tool metadata (id, label, icon, description). Settings and the sidebar read from it automatically.

```ts
import { YourIcon } from 'lucide-react';

export const TOOL_DEFS: ToolDef[] = [
  // ... existing tools
  {
    id: 'your-tool',
    label: 'Your Tool',
    icon: YourIcon,
    description: 'One-line description shown in sidebar tooltip and Settings.',
  },
];
```

### Step 3: Register route in App.tsx

```tsx
// 1. Import component at top of App.tsx
import { YourTool } from '@/components/tools/YourTool';

// 2. Add entry to TOOL_ROUTES (maps id → path + component)
const TOOL_ROUTES = {
  // ... existing routes
  'your-tool': { path: '/your-tool', component: YourTool },
};
```

Use `fullHeight: true` in the route entry if your tool needs to stretch to full viewport height (e.g. KafkaExplorer).

### Step 4: Enable by default — `src/contexts/FeatureContext.tsx`

```tsx
const DEFAULT_FEATURES: FeatureSettings = {
  // ... existing
  'your-tool': true,
};
```

**That's it.** No changes needed in `Settings.tsx` — it reads `TOOL_DEFS` automatically.

---

## Shared Tool Hooks (UX conventions)

All text tools must use these hooks for consistent behavior.

### `usePersistentState(key, initial)` — `src/hooks/usePersistentState.ts`

Drop-in for `useState` that persists to `localStorage`. Key convention: `devtool:<toolName>:<field>`.

```tsx
const [input, setInput] = usePersistentState('devtool:json:input', '');
```

### `useQuickPaste(onPaste, enabled?)` — `src/hooks/useQuickPaste.ts`

⌘V / Ctrl+V reads clipboard and calls `onPaste(text)` — no extra click. Uses Tauri clipboard plugin in the desktop app (avoids WebKit permission prompt). Also exports `quickPasteHint` for placeholder text.

```tsx
useQuickPaste(setInput);
```

### `useInputHistory(value, applyValue, enabled?)` — `src/hooks/useInputHistory.ts`

Adds undo (⌘Z) / redo (⌘⇧Z / Ctrl+Y) to a tool's primary input. Debounces user edits ~400ms into history entries.

```tsx
useInputHistory(input, setInput);
```

> Convention: **real-time output** (`useMemo`), **persisted input** (`usePersistentState`), **quick paste** (`useQuickPaste`), **undo/redo** (`useInputHistory`). Tools with no transformable input (UUID/QR generator) may keep an action button.

---

## Cross-Platform Rules (macOS · Windows · Linux)

The app runs on three different WebView engines: WKWebView (macOS), WebView2/Chromium (Windows), WebKitGTK (Linux). Write defensively for all three.

### CSS
- **Never use `-webkit-*` properties alone** — always pair with the standard value or test that the fallback is acceptable. Example: `-webkit-optimize-contrast` is silently ignored on Windows/Chromium, so also add `crisp-edges` (the standard `image-rendering` value).
- **Never apply `image-rendering` to SVG elements** — SVGs are vector; DPR scaling is handled by the browser. Apply only to raster `<img>` and `<canvas>`.
- **Use `color-scheme` CSS property** in `:root` / `.dark` to tell the OS to theme native controls (scrollbars, form widgets) for the active mode — prevents flash of wrong-theme chrome on Windows/Linux.

### Scrollbars — never use native OS rendering
`globals.css` defines a single custom scrollbar that looks identical on all three platforms. **Never add inline scrollbar CSS or use `[scrollbar-width:none]` / `[&::-webkit-scrollbar]:hidden` Tailwind arbitrary values** — use the provided utilities instead:

| Situation | Class to use |
|---|---|
| Content area that scrolls vertically | `overflow-y-auto` (picks up global scrollbar automatically) |
| Nav/tab strip that scrolls horizontally | `overflow-x-auto no-scrollbar` |
| Scroll-wheel picker / drum roll (no visible bar desired) | `overflow-y-auto no-scrollbar` |
| Horizontal data table (scrollbar should be visible) | `overflow-x-auto` (global style applies) |

The `no-scrollbar` utility class is defined in `@layer utilities` in `globals.css`. It sets `scrollbar-width: none` (Firefox) and `::-webkit-scrollbar { display: none }` (WebKit). Do not re-implement this inline.

### JavaScript / Browser APIs
- **Do not use `navigator.platform`** — deprecated and unreliable on Windows/Chromium. Use `navigator.userAgent` instead:
  ```ts
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  ```
- **Do not use `window.alert`, `window.confirm`, `window.prompt`** — these spawn native OS dialogs that look wrong on every platform. Use shadcn/ui `Dialog` or `AlertDialog`.
- **Do not use native `<select>`** — rendering differs dramatically between macOS, Windows, and Linux. Always use shadcn/ui `Select` (Radix UI `SelectPrimitive`).
- **Tauri detection**: `'__TAURI_INTERNALS__' in window` (not `window.__TAURI__` or any other symbol).

### React Hooks
- **Never call hooks inside IIFEs, callbacks, or conditionals** inside a component's render. This violates the Rules of Hooks and causes unpredictable behavior (bugs that appear/disappear depending on render order). If you need hooks in a logically-grouped sub-section of JSX, extract that section into its own named component.
  ```tsx
  // ❌ Wrong — hooks inside IIFE in JSX
  {(() => {
    const ref = useRef(null);   // ESLint rule violation
    useEffect(() => { ... });
    return <div ref={ref} />;
  })()}

  // ✅ Correct — extract to a proper component
  function MySection() {
    const ref = useRef(null);
    useEffect(() => { ... });
    return <div ref={ref} />;
  }
  // then use <MySection /> in the parent's JSX
  ```
- **`useLayoutEffect` must always have a dependency array.** Without one it runs after *every* render — the most expensive possible schedule. Only omit the array if you have a measured, documented reason. Reading `offsetWidth` / `getBoundingClientRect()` in an unconstrained `useLayoutEffect` causes layout thrashing.
- **Stable refs for long-lived event listeners.** When a `useEffect` adds a `window` event listener and its handler reads React state, keep the handler registered once (empty `[]` deps) by storing the latest state in a `useRef` and reading from the ref inside the handler:
  ```ts
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const handler = () => { /* read valueRef.current, not value */ };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // stable — no re-registration on every state change
  ```
- **Always clean up timers on unmount.** Any `setTimeout` or `setInterval` stored in a `useRef` must be cleared in a `useEffect` cleanup:
  ```ts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  ```

---

## Code Conventions

### Naming
- Components: `PascalCase` (`ColorPicker.tsx`)
- Feature/tool IDs: `kebab-case` (`'color-picker'`)
- Variables: `camelCase`; Constants: `UPPER_SNAKE_CASE`

### Styling
```tsx
className={cn(
  'base-classes',
  condition && 'conditional-classes',
  isActive ? 'active-classes' : 'inactive-classes'
)}
```
Common: `space-y-4`, `flex gap-2`, `rounded-lg`, `border`, `p-4`, `text-xs`, `font-medium`.

### TypeScript
- Use interfaces for component props; `type` for unions
- Avoid `any`; use `unknown` when the type is truly unknown
- Export types alongside their components

---

## Key Patterns

### Tauri detection
```tsx
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```

### Clipboard write (Tauri-aware)
```tsx
import { copyToClipboard } from '@/lib/clipboard';
await copyToClipboard(text);
```

### Persist a setting
```tsx
localStorage.setItem('devtool-my-setting', value);
const saved = localStorage.getItem('devtool-my-setting');
```

### Lazy-load a heavy library
```tsx
useEffect(() => {
  import('heavy-library').then(({ util }) => util.doSomething(input));
}, [input]);
```

### Web Worker (for blocking computation)
```tsx
const worker = new Worker(new URL('../../workers/your.worker.ts', import.meta.url), { type: 'module' });
```
See `src/workers/checksum.worker.ts` for a reference implementation.

---

## State Management

### FeatureContext — `src/contexts/FeatureContext.tsx`
Manages tool enable/disable and sidebar drag order. Persisted in `localStorage` (`devtool-features`, `devtool-tool-order`).

```tsx
const { features, toggleFeature, isFeatureEnabled, resetToDefaults, toolOrder, reorderTools } = useFeatures();
```

### UpdateContext — `src/contexts/UpdateContext.tsx`
Auto-update polling, badge state, and install flow. Persisted in `localStorage` (`devtool-auto-update`, `devtool-last-update-check`).

```tsx
const { status, updateInfo, updateAvailable, autoCheckEnabled, toggleAutoCheck, checkForUpdates, installUpdate } = useUpdate();
```

### Dark Mode
`localStorage` key `devtool-dark-mode`. Class toggled on `<html>`. Managed in `App.tsx`.

### Sidebar Collapse
`localStorage` key `devtool-sidebar-collapsed`. Width: `w-56` (224 px) ↔ `w-14` (56 px).

---

## Tauri 2 Notes

- **Permissions**: `src-tauri/capabilities/default.json` — Tauri 2 capability system, not the old v1 `allowlist`
- **Plugin imports**: `@tauri-apps/plugin-*` packages (not `@tauri-apps/api/*` subpaths for plugins)
- **Tauri detection**: `'__TAURI_INTERNALS__' in window` (not `__TAURI_IPC__`)
- **Config keys**: `build.devUrl` (not `devPath`), `build.frontendDist` (not `distDir`), `plugins.updater` (not `tauri.updater`)
- **Adding a capability**: add permission string to `capabilities/default.json` AND document it in the `APP_PERMISSIONS` array in `Settings.tsx`

Common capability strings:
```json
"clipboard-manager:allow-read-text",
"clipboard-manager:allow-write-text",
"fs:allow-read-file",
"fs:allow-write-file",
"fs:scope-appdata-recursive",
"dialog:allow-open",
"dialog:allow-save",
"process:allow-restart",
"updater:allow-check",
"updater:allow-download-and-install"
```

The HTTP plugin is **URL-scoped** — instead of a bare string, add an object with an `allow` list (see Network Tools in `capabilities/default.json`):
```json
{ "identifier": "http:default", "allow": [{ "url": "https://cloudflare-dns.com/*" }] }
```

---

## Build & Deployment

### Production build
```bash
npm run tauri:build
```
Output: `src-tauri/target/release/bundle/`
- macOS: `bundle/macos/DevTool.app`, `bundle/dmg/*.dmg`
- Windows: `bundle/msi/*.msi`, `bundle/nsis/*.exe`
- Linux: `bundle/appimage/*.AppImage`, `bundle/deb/*.deb`

### CI/CD — GitHub Actions
Configured in `.github/workflows/release.yml`. Triggers on `git push origin v*` tags.  
Builds on: `macos-latest` (Apple Silicon), `windows-latest`, `ubuntu-22.04`.

**Signing secrets** (GitHub repo → Settings → Secrets):
- `TAURI_SIGNING_PRIVATE_KEY` — from `npm run tauri signer generate`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### Trigger a release
```bash
# Update "version" in src-tauri/tauri.conf.json, then:
git tag v0.2.0
git push origin main --tags
```

---

## Architecture

```
┌──────────────────────────────────────────┐
│           Desktop Shell (Tauri/Rust)     │
│  ┌────────────────────────────────────┐  │
│  │         WebView Container          │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │      React Application       │  │  │
│  │  │  FeatureProvider             │  │  │
│  │  │  └─ UpdateProvider           │  │  │
│  │  │     └─ Router                │  │  │
│  │  │        ├─ Sidebar (nav)      │  │  │
│  │  │        └─ Tool Components    │  │  │
│  │  └──────────────────────────────┘  │  │
│  └────────────────────────────────────┘  │
│  System APIs: Clipboard · FS · Dialogs   │
└──────────────────────────────────────────┘
         │                    │
    localStorage         Tauri IPC (Rust)
```

**Why Tauri over Electron**: ~3 MB bundle vs ~150 MB; native webview; lower memory; Rust backend.  
**Why Context API over Redux/Zustand**: state is simple (feature flags + update status); no extra dependency.  
**Why Tailwind over CSS Modules**: faster iteration; shadcn/ui compatibility; no naming conflicts.

---

## Dependencies Quick Reference

### Most Used UI Components
```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
```

### Most Used Utilities
```tsx
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { useFeatures } from '@/contexts/FeatureContext';
import { useUpdate } from '@/contexts/UpdateContext';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
```

### Key npm Packages
- `@tauri-apps/plugin-clipboard-manager` — clipboard read/write
- `@tauri-apps/plugin-dialog` — file open/save dialogs
- `@tauri-apps/plugin-fs` — file system access
- `@tauri-apps/plugin-process` — `relaunch()`
- `@tauri-apps/plugin-updater` — `check()` → `update.downloadAndInstall()`
- `@tauri-apps/plugin-http` — Rust-side `fetch` for Network Tools (bypasses WebView CORS/Origin)
- `crypto-js` — hashing & AES encryption
- `rskafka` (Rust, v0.6) — Kafka client (pulled via `rustls 0.23`)
- `local-ip-address` + `hostname` (Rust) — back the `local_network_info` command (`src-tauri/src/netinfo.rs`) for the Network tool's Local Network view
- `diff` — text diffing
- `qrcode` — QR generation
- `react-markdown` — markdown rendering

> **Network Tools** (`src/components/tools/NetworkTools.tsx`, `src/lib/network.ts`): DNS-over-HTTPS lookups, propagation, DNSSEC, public-IP/geo, and local network info. It uses an **in-memory session store** (not `usePersistentState`) so results survive tab switches and leaving the tool but clear on app restart.

---

## Human Docs

| File | Contents |
|------|----------|
| [CONTRIBUTING.md](../human/CONTRIBUTING.md) | How to add a new tool (step-by-step) |
| [SETUP.md](../human/SETUP.md) | Prerequisites, running, building, troubleshooting |
| [TOOLS.md](../human/TOOLS.md) | Per-tool transparency: system access, permissions, storage, risk |
| [kafka-explorer.md](../human/kafka-explorer.md) | Kafka Explorer — full operation-level Kafka API reference |

---

## File Modification Guide

| Path | Safety |
|---|---|
| `src/components/tools/*.tsx` | ✅ Safe — add/edit tools freely |
| `src/hooks/*.ts` | ⚠️ Careful — many tools depend on these |
| `src/lib/toolDefs.ts` | ⚠️ Careful — all tools depend on this |
| `src/App.tsx` | ⚠️ Careful — core routing and layout |
| `src/contexts/*.tsx` | ⚠️ Careful — shared state |
| `src/components/Settings.tsx` | ⚠️ Careful — Settings UI |
| `src/components/ui/*.tsx` | ❌ Rarely — regenerate via shadcn CLI instead |
| `vite.config.ts` | ❌ Rarely — build pipeline |
| `src-tauri/*` | ❌ Rarely — only for new Rust features or capabilities |

---

## Common Issues

**Tool not in sidebar**: check `id` in `TOOL_DEFS` matches key in `TOOL_ROUTES` and `DEFAULT_FEATURES`. Clear stale localStorage: `localStorage.clear()`.

**TypeScript errors**: run `npm run build` to surface all errors at once.

**Tailwind classes not applying**: restart dev server; ensure file is covered by `tailwind.config.js` content glob.

**Tauri capability denied**: add the permission string to `src-tauri/capabilities/default.json` — the build error message prints the valid strings.

**Worker build fails**: workers must be imported as `new Worker(new URL('./file.ts', import.meta.url), { type: 'module' })`. Do not use esbuild minify option — Vite 8 uses OXC (`minify: true` boolean).

---

*Last updated: 2026-06-21*
