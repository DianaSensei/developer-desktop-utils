# DevTool - Project Guide for AI Agents

> Complete reference for AI coding agents. Read this before writing any code.

## Project Overview

**DevTool** is a cross-platform desktop application built with Tauri 2 + React + TypeScript providing developer utilities (text processing, encoding, hashing, color tools, Kafka explorer, RabbitMQ client, API client, mock server, etc.).

**Key Technologies:**
- **Frontend**: React 18, TypeScript, Vite 8 (Rolldown bundler)
- **Desktop**: Tauri 2 (Rust backend)
- **UI**: Tailwind CSS, shadcn/ui components (`src/components/ui/`)
- **Design System**: `src/design-system/` — single import surface (`@/design-system`), CSS tokens (`tokens.css`), Tailwind preset (`tailwind-preset.cjs`)
- **State**: React Context API (`AppConfigContext`, `FeatureContext`, `UpdateContext`, `MeetingsProvider`)
- **Routing**: React Router v6

**Version**: 1.0.0  
**Platform Support**: macOS 11+ · Windows 10/11 · Ubuntu 22.04+

---

## Quick Start Commands

```bash
npm run dev              # Web only (fast)
npm run tauri:dev        # Desktop app
npm run build            # Build web assets (tsc + vite build)
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
│   │   ├── ui/              # shadcn/ui components (Button, Input, CopyButton, etc.)
│   │   ├── tools/           # Tool components (one per utility; sub-dirs for complex tools)
│   │   ├── AppLogo.tsx      # App icon/logo component
│   │   ├── ErrorBoundary.tsx    # Catches render errors per-route; resets on pathname change
│   │   ├── LoadingOverlay.tsx   # Full-screen spinner for async operations
│   │   ├── StatusMessage.tsx    # Inline success/error/info banner
│   │   ├── ToolGuideModal.tsx   # "How to use" modal opened by the header ? button
│   │   ├── ToolHeaderActions.tsx # Portal: renders tool-specific buttons into the app header
│   │   └── UpdateDialog.tsx     # Auto-update install prompt
│   ├── config/
│   │   └── appConfig.ts     # AppConfig type + DEFAULT_APP_CONFIG + CONFIG_FIELDS (Settings editor)
│   ├── contexts/
│   │   ├── AppConfigContext.tsx  # Tunable app-wide numbers (editor, generator, kafka, updates)
│   │   ├── FeatureContext.tsx    # Tool enable/disable + sidebar order + favorites
│   │   ├── UpdateContext.tsx     # Auto-update state, badge, toggle
│   │   └── (MeetingsProvider in src/lib/meetings.tsx)
│   ├── design-system/
│   │   ├── index.ts         # Single re-export surface — import from '@/design-system'
│   │   ├── tokens.css       # CSS custom properties (colors, radii, shadows, etc.)
│   │   ├── tailwind-preset.cjs  # Tailwind theme preset
│   │   └── README.md
│   ├── hooks/
│   │   ├── usePersistentState.ts  # useState + localStorage
│   │   ├── useQuickPaste.ts       # ⌘V / Ctrl+V clipboard paste
│   │   ├── useInputHistory.ts     # ⌘Z / ⌘⇧Z undo/redo
│   │   ├── useImagePaste.ts       # ⌘V / paste event → PNG data URL
│   │   ├── useCopyFeedback.ts     # Animated Copy→Check state (used inside CopyButton)
│   │   ├── useDesktopChrome.ts    # Blocks browser nav shortcuts (Backspace, ⌘R, ⌘F, ⌘W…)
│   │   ├── useDismissable.ts      # Click-outside / Escape dismissal for overlays
│   │   └── useTauriFileDrop.ts    # OS-level file drag-drop (Tauri webview event)
│   ├── lib/
│   │   ├── toolDefs.ts      # TOOL_DEFS array + DEFAULT_TOOL_ORDER — single source of truth
│   │   ├── toolGuides.tsx   # Per-tool "how to use" guide content for ToolGuideModal
│   │   ├── liveConnections.ts   # Global live-connection registry (rabbit/kafka live dot)
│   │   ├── utils.ts         # cn() classname merger
│   │   ├── clipboard.ts     # copyToClipboard(), copyImageToClipboard(), readImageFromClipboard()
│   │   ├── faker.ts         # Faker.js helpers for the Generator tool
│   │   ├── meetings.tsx     # MeetingsProvider + useMeetings() — time-tracker meeting notes
│   │   ├── network.ts       # DNS / IP utilities for the Network tool
│   │   ├── otpauth.ts       # TOTP/HOTP logic for the 2FA tool
│   │   └── properties.ts    # .properties format parser/serializer for Data Converter
│   ├── workers/             # Web Workers for heavy computation
│   │   ├── checksum.worker.ts
│   │   ├── deduplicate.worker.ts
│   │   └── regex.worker.ts
│   ├── styles/
│   │   └── globals.css      # Tailwind directives + CSS theme variables + custom scrollbar
│   ├── App.tsx              # Router, layout, TOOL_ROUTES, sidebar, provider hierarchy
│   └── main.tsx             # React entry point
├── src-tauri/               # Tauri 2 (Rust) backend
│   ├── src/main.rs          # Rust main — registers all plugins + Edit menu (undo/redo/copy/paste)
│   ├── Cargo.toml           # Rust dependencies
│   ├── capabilities/
│   │   └── default.json     # Permission grants (Tauri 2 capability system)
│   └── tauri.conf.json      # Tauri 2 configuration (version: 1.0.0)
├── docs/
│   ├── ai/                  # AI agent guides (this file)
│   ├── human/               # Human contributor guides
│   └── design/DESIGN-SYSTEM.md
├── testing/rabbitmq/        # RabbitMQ integration test harness (Python + Docker)
├── public/                  # Static assets
└── package.json
```

---

## Provider Hierarchy (App.tsx)

```
AppConfigProvider          ← tunable numbers (src/config/appConfig.ts)
  FeatureProvider          ← tool enable/disable, sidebar order, favorites
    UpdateProvider         ← auto-update polling and state
      MeetingsProvider     ← time-tracker meeting notes
        Router
          AppContent       ← sidebar + header + routes
          UpdateDialog     ← install-update prompt
```

---

## Design Principles (mandatory — read before writing any UI or feature code)

> Full design system reference — **design decision rules** (hierarchy, color, feedback, accessibility, self-review checklist), tokens, utilities, and components — is in [../design/DESIGN-SYSTEM.md](../design/DESIGN-SYSTEM.md). Read its "Design rules" and "Self-review" sections before building, editing, or reviewing any UI. The source of truth for actual values is [`src/design-system/`](../../src/design-system/) (`tokens.css`, `tailwind-preset.cjs`, `index.ts`).

### UI Components — always use the shared library, never OS-native

- **Always** use components from `src/components/ui/` (shadcn/ui) for every interactive element: buttons, inputs, selects, dialogs, toggles, checkboxes, dropdowns.
- **Never** use browser- or OS-native elements (`<select>`, `window.alert`, `window.confirm`, native context menus, etc.). They break visual consistency across macOS / Windows / Linux.
- If a needed component doesn't exist in `src/components/ui/`, create a new shadcn/ui-style component using Radix UI primitives and Tailwind.
- You can import all shared components directly from `@/design-system` as a convenience (see `src/design-system/index.ts`).

### Tool Layout — use the standard container pattern

Two layout patterns exist. Pick the right one for the tool:

**Pattern A — `ToolToolbar` + `ToolPanes`** (preferred for input/output tools):
```tsx
import { ToolToolbar, ToolPanes, ToolPane, PaneHeader } from '@/components/ui/tool-layout';
import { CopyButton } from '@/components/ui/copy-button';

<div className="flex flex-col h-full">
  <ToolToolbar>
    {/* mode toggles, format selectors, action buttons */}
  </ToolToolbar>
  <ToolPanes rows={2}>          {/* rows={2} or rows={3} */}
    <ToolPane>
      <PaneHeader label="Input" hint={quickPasteHint} />
      <Textarea className="flex-1 min-h-0 resize-none font-mono rounded-none border-0" … />
    </ToolPane>
    <ToolPane>
      <PaneHeader label="Output" action={<CopyButton value={output} />} />
      <Textarea readOnly className="flex-1 min-h-0 resize-none font-mono rounded-none border-0" … />
    </ToolPane>
  </ToolPanes>
</div>
```

**Pattern B — `ToolSection` / `ToolLabel` / `ToolHint`** (for form-style tools):
```tsx
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';

<div className="tool-full-height">
  <div className="tool-scrollable tool-padding tool-spacer">
    <ToolSection>
      <ToolLabel>Label</ToolLabel>
      <ToolHint>Helper text</ToolHint>
      <Input />
    </ToolSection>
    <ToolSection>
      <ToolLabel>Output</ToolLabel>
      <Textarea readOnly />
    </ToolSection>
  </div>
</div>
```

**Key utilities:**
- `tool-full-height` — container that fills viewport height
- `tool-scrollable` — content area that scrolls with custom scrollbar
- `tool-padding` — responsive padding (3px on mobile, 4-5px on desktop)
- `tool-spacer` — consistent section spacing (`space-y-5 sm:space-y-6`)
- `ToolSection` — wrapper for input/output groups
- `ToolLabel` — consistent label styling (bold, foreground color)
- `ToolHint` — helper text under labels (muted, smaller)

### UI / UX — minimalist, smooth, and user-first

- **Minimalist**: Remove every element that isn't directly serving the user's task. No decorative chrome, no nested cards inside cards.
- **Tool space first**: The content area is the hero. Inputs and outputs fill available width. Sidebars and controls shrink to the minimum.
- **Rounded-corner design**: Use `rounded-md` or `rounded-lg` consistently. Never `rounded-none` for containers or interactive elements.
- **Smooth and seamless**: All state transitions use CSS transitions or Tailwind's `transition-*` utilities. No jarring instant swaps.
- **Follow user behavior**: Primary actions where eyes land first — top-left for input, inline or right for output, icon-only for secondary actions.
- **Keyboard-first**: Respect `useQuickPaste` (⌘V) and `useInputHistory` (⌘Z/⌘⇧Z) on every text tool.
- **Consistent typography**: Labels `text-xs font-medium`, hints `text-[11px] text-muted-foreground`, body `text-sm`, mono `font-mono text-sm`.

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

Tool metadata, routing, and feature toggles are kept separate. All four need updating.

### Step 1: Create the tool component

Create `src/components/tools/YourTool.tsx`. Use the **modern tool pattern**: real-time output (no "Process" button), persisted input, quick-paste, and undo/redo.

```tsx
import { useMemo } from 'react';
import { YourIcon } from 'lucide-react';
import { ToolToolbar, ToolPanes, ToolPane, PaneHeader } from '@/components/ui/tool-layout';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/ui/copy-button';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

export function YourTool() {
  const [input, setInput] = usePersistentState('devtool:yourTool:input', '');
  const output = useMemo(() => input.toUpperCase(), [input]);

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  return (
    <div className="flex flex-col h-full">
      <ToolToolbar>
        {/* mode selectors, options */}
      </ToolToolbar>
      <ToolPanes>
        <ToolPane>
          <PaneHeader label="Input" hint={quickPasteHint} />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 min-h-0 resize-none font-mono rounded-none border-0"
          />
        </ToolPane>
        <ToolPane>
          <PaneHeader label="Output" action={<CopyButton value={output} iconClassName="h-3.5 w-3.5" />} />
          <Textarea value={output} readOnly className="flex-1 min-h-0 resize-none font-mono rounded-none border-0" />
        </ToolPane>
      </ToolPanes>
    </div>
  );
}
```

### Step 2: Add to TOOL_DEFS — `src/lib/toolDefs.ts`

`TOOL_DEFS` is the single source of truth for tool metadata (id, label, icon, description, keywords). Settings and the sidebar read from it automatically.

```ts
import { YourIcon } from 'lucide-react';

export const TOOL_DEFS: ToolDef[] = [
  // ... existing tools
  {
    id: 'your-tool',
    label: 'Your Tool',
    icon: YourIcon,
    description: 'One-line description shown in sidebar tooltip and Settings.',
    keywords: ['synonym1', 'synonym2'],   // optional; improves sidebar search
  },
];
```

Also add the tool id to `DEFAULT_TOOL_ORDER` (same file) in the desired position for fresh installs.

### Step 3: Register route in App.tsx

```tsx
// 1. Lazy-import at top of App.tsx (code-split)
const YourTool = lazy(() => named(import('@/components/tools/YourTool'), 'YourTool'));

// 2. Add entry to TOOL_ROUTES
const TOOL_ROUTES: Record<string, { path: string; component: React.ComponentType; fullHeight?: boolean }> = {
  // ... existing routes
  'your-tool': { path: '/your-tool', component: YourTool, fullHeight: true },
};
```

All tools should use `fullHeight: true` — it removes the scrolling wrapper so the tool controls its own overflow.

### Step 4: Enable by default — `src/contexts/FeatureContext.tsx`

```tsx
const DEFAULT_FEATURES: FeatureSettings = {
  // ... existing
  'your-tool': true,
};
```

### Step 5 (optional): Add a tool guide — `src/lib/toolGuides.tsx`

Tools listed in `toolGuides.tsx` get a hand-written help section shown by the `?` button in the app header. Any tool not listed falls back to a generic guide built from its description. Add a named export matching the tool id (camelCase the id).

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

### `useImagePaste(onImage, enabled?)` — `src/hooks/useImagePaste.ts`

Image counterpart to `useQuickPaste`: ⌘V / Ctrl+V (and the native `paste` event) captures an image from the clipboard and calls `onImage(dataUrl)` with a PNG data URL. Tauri-aware (clipboard plugin in the desktop app, async Clipboard API on the web). Use for tools that take image input (e.g. `ImageBase64Tool`).

```tsx
useImagePaste(loadFromDataUrl, mode === 'encode');
```

### `useInputHistory(value, applyValue, enabled?)` — `src/hooks/useInputHistory.ts`

Adds undo (⌘Z) / redo (⌘⇧Z / Ctrl+Y) to a tool's primary input. Debounces user edits ~400ms into history entries (configurable via `AppConfig.editor.historyDebounceMs`).

```tsx
useInputHistory(input, setInput);
```

### `useTauriFileDrop(onDropPaths, enabled?)` — `src/hooks/useTauriFileDrop.ts`

OS-level file drag-and-drop (Finder / Explorer → app). Tauri intercepts native file drops before the webview, so HTML5 `ondrop` never receives them. This hook listens for the Tauri window event, hit-tests against the element referenced by `dropRef`, and calls `onDropPaths(paths[])`. Returns `{ dropRef, dragging, isTauri }`.

```tsx
const { dropRef, dragging } = useTauriFileDrop((paths) => loadFile(paths[0]));
<div ref={dropRef} className={dragging ? 'ring-2 ring-primary' : ''}>…</div>
```

### `useDismissable(onDismiss)` — `src/hooks/useDismissable.ts`

Registers click-outside + Escape key handlers to dismiss an overlay/popover. Returns a `ref` to attach to the container.

> Convention: **real-time output** (`useMemo`), **persisted input** (`usePersistentState`), **quick paste** (`useQuickPaste`), **undo/redo** (`useInputHistory`). Tools with no transformable input (UUID/QR generator) may keep an action button.

---

## ToolHeaderActions — injecting buttons into the app header

Tools that need their own header controls (e.g. import/export, connection status) use the `ToolHeaderActions` portal to render into the shared app header without lifting state:

```tsx
import { ToolHeaderActions } from '@/components/ToolHeaderActions';

export function YourTool() {
  return (
    <>
      <ToolHeaderActions>
        <Button size="sm" onClick={handleExport}>Export</Button>
      </ToolHeaderActions>
      {/* … tool body … */}
    </>
  );
}
```

The slot is `#tool-header-actions` in `App.tsx`. Portals are cleaned up automatically on unmount.

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

### CodeMirror 6 in flex layouts
CodeMirror 6's internal structure is:
```
.cm-editor   (display: flex; flex-direction: column)
  .cm-scroller (display: flex; flex-direction: row — gutter left, content right)
    .cm-gutters
    .cm-content
```
`height: 100%` on `.cm-editor` only works when the parent has an **explicit pixel height**. In flex chains where the parent uses `flex: 1` (no explicit height), `height: 100%` resolves to `0` on Windows WebView2/Chromium — this causes the gutter and content to stack vertically instead of side-by-side.

**Always use the flex approach instead:**
```ts
// In EditorView.theme()
'&': { flex: '1 1 0', minHeight: '0', ... },  // NOT height: '100%'
'.cm-scroller': { overflow: 'auto', minHeight: '0' },  // min-height:0 required
```

**Container divs** that hold CodeMirror must also be flex:
```tsx
// The div that CodeMirror mounts into
<div ref={containerRef} className="flex flex-col flex-1 min-h-0 overflow-hidden" />

// Any intermediate wrapper between a flex parent and the CodeMirror container
<div className="flex flex-col flex-1 min-h-0">
  <CodeEditor ... />
</div>
```

CodeMirror components in this repo that implement this pattern: `CodeEditor.tsx`, `ResponseViewer.tsx`, `SqlFormatter.tsx`.

### JavaScript / Browser APIs
- **Do not use `navigator.platform`** — deprecated and unreliable on Windows/Chromium. Use `navigator.userAgent` instead:
  ```ts
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  ```
- **Do not use `window.alert`, `window.confirm`, `window.prompt`** — these spawn native OS dialogs that look wrong on every platform. Use shadcn/ui `Dialog` or `AlertDialog`.
- **Do not use native `<select>`** — rendering differs dramatically between macOS, Windows, and Linux. Always use shadcn/ui `Select` (Radix UI `SelectPrimitive`).
- **Tauri detection**: `'__TAURI_INTERNALS__' in window` (not `window.__TAURI__` or any other symbol).
- **Blocked keyboard shortcuts** (handled globally by `useDesktopChrome`): ⌘R/Ctrl+R (reload), ⌘F/Ctrl+F (find), ⌘W/Ctrl+W (close window), ⌘P/Ctrl+P (print), Backspace nav, ⌘[/] history. Do not re-implement these; `useDesktopChrome` is called once at the app root.

### React Hooks
- **Never call hooks inside IIFEs, callbacks, or conditionals** inside a component's render. This violates the Rules of Hooks and causes unpredictable behavior. If you need hooks in a logically-grouped sub-section of JSX, extract that section into its own named component.
  ```tsx
  // ❌ Wrong — hooks inside IIFE in JSX
  {(() => {
    const ref = useRef(null);
    useEffect(() => { ... });
    return <div ref={ref} />;
  })()}

  // ✅ Correct — extract to a proper component
  function MySection() {
    const ref = useRef(null);
    useEffect(() => { ... });
    return <div ref={ref} />;
  }
  ```
- **`useLayoutEffect` must always have a dependency array.** Without one it runs after *every* render. Only omit the array if you have a measured, documented reason.
- **Stable refs for long-lived event listeners.** When a `useEffect` adds a `window` event listener and its handler reads React state, keep the handler registered once (empty `[]` deps) by storing the latest state in a `useRef` and reading from the ref inside the handler:
  ```ts
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const handler = () => { /* read valueRef.current, not value */ };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
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

### Image clipboard (Tauri-aware)
```tsx
import { copyImageToClipboard, readImageFromClipboard } from '@/lib/clipboard';
await copyImageToClipboard(blobOrDataUrl);            // copy an image out
const dataUrl = await readImageFromClipboard();       // null when no image
```
For "copy image" buttons, reuse `CopyButton` with its `copyAction` prop so the animated Copy→Check affordance is identical to text copies:
```tsx
<CopyButton copyAction={async () => { try { await copyImageToClipboard(src); return true; } catch { return false; } }} label="Copy image" />
```
Requires the `clipboard-manager:allow-read-image` / `allow-write-image` capabilities (already granted in `capabilities/default.json`).

### Copy button — always use the shared `CopyButton`
For any user-facing "copy" control, use `CopyButton` instead of wiring a raw `Button` to `copyToClipboard`. It gives every copy the same affordance: an animated Copy→Check cross-fade held for the user-configurable `editor.copyFeedbackMs` duration (default 1500 ms), with its own timer cleanup. Do **not** re-implement a local `copied` state / `setTimeout` swap.

```tsx
import { CopyButton } from '@/components/ui/copy-button';

// Icon-only
<CopyButton value={output} iconClassName="h-3.5 w-3.5" />

// With a label and a lazily-computed value (resolved at click time)
<CopyButton value={() => buildExport()} label="Copy" variant="outline" size="sm" />

// Custom idle glyph
<CopyButton value={all} icon={Layers} label="Copy all" />
```

### AppConfig — reading tunable numbers
```tsx
import { useAppConfig } from '@/contexts/AppConfigContext';

const { config } = useAppConfig();
const ms = config.editor.historyDebounceMs;   // default 400
const feedbackMs = config.editor.copyFeedbackMs;  // default 1500
```
All tunable values are defined in `src/config/appConfig.ts`. Users edit them in Settings → Configuration. Never hard-code a value that belongs in `AppConfig`.

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

### AppConfigContext — `src/contexts/AppConfigContext.tsx`
Centralized tunable numbers stored in `localStorage` (`devtool-app-config`). Sections: `updates`, `editor`, `generator`, `kafka`. Every value has min/max/step metadata in `CONFIG_FIELDS` and appears automatically in Settings → Configuration.

```tsx
const { config, setField, resetConfig } = useAppConfig();
```

### FeatureContext — `src/contexts/FeatureContext.tsx`
Manages tool enable/disable, sidebar drag order, and **favorites** (starred tools that float to the top of the sidebar). All persisted in `localStorage`.

```tsx
const { features, toggleFeature, isFeatureEnabled, resetToDefaults,
        toolOrder, reorderTools,
        favorites, toggleFavorite, isFavorite } = useFeatures();
```

Storage keys:
- `devtool-features` — `{ [featureId]: boolean }` enabled/disabled map
- `devtool-tool-order` — `string[]` sidebar drag order
- `devtool-favorites` — `string[]` favorited tool ids (most-recently-starred first)

Default enabled/disabled state is in `DEFAULT_FEATURES`. Tools not listed default to `enabled`.

**Favorites in the sidebar:** starred tools float to the top of the nav list sorted by most-recently-starred. When favorites exist and the sidebar is expanded, "Favorites" / "All tools" section headers appear. Each nav item shows a star toggle on hover (filled amber = favorited). The star is also accessible in Settings → tool list. No changes needed to add favorites to new tools — the behavior is automatic.

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

## Sidebar Live Connection Indicator

`src/lib/liveConnections.ts` maintains a module-scope `Set<string>` of currently-connected tool `featureId`s (e.g. `'rabbit-client'`, `'kafka-explorer'`). It is seeded on startup from each tool's persisted connected-id key in `localStorage`, so the dot is correct before the tool component mounts.

```tsx
import { liveConnections, useLiveConnections } from '@/lib/liveConnections';

// In a tool component — report live state:
useEffect(() => { liveConnections.set('rabbit-client', isConnected); }, [isConnected]);

// In the sidebar — read reactive list:
const liveIds = useLiveConnections();
const isLive = liveIds.includes(tool.featureId);
```

When `isLive` is true, `App.tsx` renders a small emerald dot absolutely positioned on the tool's icon (`-top-1 -right-1`), visible both in collapsed and expanded sidebar mode.

Currently registered feature IDs: `'rabbit-client'` (seeded from `devtool:rabbit:connectedConnId`), `'kafka-explorer'` (seeded from `devtool:kafka:connectedBrokerId`).

---

## Tauri 2 Notes

- **Permissions**: `src-tauri/capabilities/default.json` — Tauri 2 capability system, not the old v1 `allowlist`
- **Plugin imports**: `@tauri-apps/plugin-*` packages (not `@tauri-apps/api/*` subpaths for plugins)
- **Tauri detection**: `'__TAURI_INTERNALS__' in window` (not `__TAURI_IPC__`)
- **Config keys**: `build.devUrl` (not `devPath`), `build.frontendDist` (not `distDir`), `plugins.updater` (not `tauri.updater`)
- **Adding a capability**: add permission string to `capabilities/default.json` AND document it in the `APP_PERMISSIONS` array in `Settings.tsx`
- **macOS Edit menu**: `src-tauri/src/main.rs` registers a native Edit menu (`Undo`, `Redo`, `Cut`, `Copy`, `Paste`, `Select All`) via `tauri::menu::PredefinedMenuItem`. This is required on macOS to route Cmd+Z/X/C/V/A into the WebView; Windows/Linux work without it.

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
git tag v1.x.x
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
│  │  │  AppConfigProvider           │  │  │
│  │  │  └─ FeatureProvider          │  │  │
│  │  │     └─ UpdateProvider        │  │  │
│  │  │        └─ MeetingsProvider   │  │  │
│  │  │           └─ Router          │  │  │
│  │  │              ├─ Sidebar      │  │  │
│  │  │              └─ Tool Components│  │  │
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

## Tool Inventory

| Tool ID | Label | Default On | Notes |
|---|---|---|---|
| `task-tracker` | Time Tracker | ✅ | Timesheet, calendar, pomodoro, meeting notes |
| `api-client` | API Client | ✅ | Collections, environments, pre/post scripts, Postman import/export |
| `mock-server` | Mock Server | ✅ | Local HTTP mock: Rhai scripts, live request log |
| `cron-generator` | Cron Generator | ✅ | Visual editor, Quartz/Spring support |
| `text-transform` | Text Transformer | ✅ | Case, join/split, arrays, Vietnamese phone numbers |
| `text-counter` | Text Counter | ✅ | Chars, words, lines, reading time |
| `base64` | Encode·Hash·Encrypt | ✅ | Base64, URL, Hex, Morse, MD5, SHA, HMAC, bcrypt, Argon2, AES-256 |
| `unix-time` | Date / Time | ✅ | Timestamp conversion, timezone, ISO 8601 |
| `json` | JSON Formatter | ✅ | Format, validate, minify, tree view |
| `data-converter` | Data Converter | ✅ | JSON ↔ YAML ↔ TOML ↔ XML ↔ .properties |
| `generator` | Generator | ✅ | UUID, random, fake datasets (JSON/CSV/SQL) |
| `qrcode` | QR Code | ✅ | Generate + decode |
| `2fa` | 2FA Authenticator | ✅ | TOTP/HOTP, SHA-1/256/512, 6/8 digits |
| `color-picker` | Color Picker | ❌ | HEX/RGB/HSL/CMYK, image eyedropper |
| `jwt` | JWT Debugger | ❌ | Decode headers + payloads |
| `regex` | Regex Tester | ❌ | Live match highlighting, Web Worker |
| `diff` | Diff | ❌ | Word-level text diff, structural JSON diff |
| `markdown` | Markdown | ❌ | Live preview, GFM |
| `deduplicate` | Deduplicate | ❌ | Remove duplicate lines, Web Worker |
| `kafka-explorer` | Kafka Explorer | ❌ | Topics, partitions, consumer groups, live produce/consume |
| `rabbit-client` | RabbitMQ | ❌ | Management REST + AMQP via Rust (lapin), live consume/RPC |
| `sql-formatter` | SQL Formatter | ❌ | SQL + MongoDB aggregation formatting |
| `network` | Network Tools | ❌ | DNS, propagation, DNSSEC, IP, listening ports |
| `lucky-wheel` | Lucky Wheel | ❌ | Random winner spinner |

---

## Complex Tool Reference

### Kafka Explorer (`src/components/tools/kafka/`)

**Connect/Disconnect flow:** a broker must be explicitly connected (`handleConnect` in `KafkaExplorer.tsx`) before any views are accessible. `connectedBrokerId` is persisted in `localStorage` (`devtool:kafka:connectedBrokerId`). Connecting a new broker stops the previous broker's consumers (`kafkaConsumerStore.stopForBroker`). The right panel shows a `DisconnectedPanel` until connected.

**Auth / TLS:** each `BrokerConfig` (`src-tauri/src/kafka.rs`) carries a `security_protocol` — `PLAINTEXT` (default), `SSL`, `SASL_PLAINTEXT`, or `SASL_SSL` — plus `sasl_mechanism` (`PLAIN`/`SCRAM-SHA-256`/`SCRAM-SHA-512`), `sasl_username`/`sasl_password`, and an optional `ssl_ca_pem` for self-signed CAs (OS trust store otherwise, via `rustls-platform-verifier`). This is applied on both Kafka connection paths: `make_client()` (rskafka, used by produce/consume/create/delete-topic) via `ClientBuilder::tls_config`/`sasl_config`, and the hand-rolled wire-protocol path (`open_kafka_stream` → `connect_and_auth`) which wraps the `TcpStream` in `tokio-rustls` and runs a manual SaslHandshake(17)/SaslAuthenticate(36) exchange (`sasl_authenticate*` in `kafka.rs`) before the first real request — required because SASL-enabled listeners reject everything else until auth completes. `BrokerForm.tsx` exposes a security-protocol `Select`, conditional SASL mechanism/username/password fields, and a collapsible "Advanced / TLS" CA-PEM textarea (same pattern as RabbitMQ's `ConnectionForm.tsx`).

**Live consumers:** `kafkaConsumerStore.ts` (module-scope `Map`) manages streaming consumers via `kafka_consume_start` / `kafka_consume_stop` Rust commands. Tauri `Channel` pushes messages to the frontend. Store is outside the component tree so consumers survive view switches; `stopAll()` is called on tool unmount.

**Input history:** `kafkaInputHistoryStore.ts` — per-broker history (localStorage, fields `'topic'|'key'`, cap 25, most-recent-first). `kafkaInputHistory.add/remove/get`, `useKafkaRecentMatches(brokerId, field, query)`. `RecentSuggestions.tsx` renders a "Recent" dropdown group with clock icon + hover × to remove.

**Produce draft:** `produceDraft.ts` — in-memory module-scope object (`topic`, `key`, `value`, `headers`, `batch`, `partitionMode`, `partition`, `valueFormat`). Survives tool and tab switches; reset only on app restart (not written to disk). `ProduceTab.tsx` seeds from it and writes back on every render via `useEffect(() => { Object.assign(produceDraft, {...}); })` (no deps).

**Format for produce value / consume body:** `ProduceTab.tsx` uses `CodeEditor` (CodeMirror, editable, JSON/plain Segmented toggle + Format button). `ConsumeView.tsx` uses `ResponseViewer` (read-only, JSON/plain) for message body; hex stays `<pre>`.

**Live indicator:** `useEffect(() => { liveConnections.set('kafka-explorer', isConnected); }, [isConnected])` in `KafkaExplorer.tsx`.

Key files:
- `KafkaExplorer.tsx` — root component, connect/disconnect, resize, routing
- `LeftPanel.tsx` — broker selector + status dot + Connect/Disconnect button
- `useKafkaState.ts` — navigation state + persisted `connectedBrokerId`
- `kafkaConsumerStore.ts` — module-scope consumer registry + `stopForBroker(id)`
- `kafkaInputHistoryStore.ts` — per-broker topic/key history
- `produceDraft.ts` — in-memory produce form state
- `types.ts` — `kafkaApi` (thin wrappers over Tauri `invoke`)

---

### RabbitMQ Client (`src/components/tools/rabbit/`)

**Connect/Disconnect flow:** a connection must be explicitly connected (`handleConnect` in `RabbitClient.tsx`) — runs AMQP test + management test (if not AMQP-only), then sets `connectedConnId` in `localStorage` (`devtool:rabbit:connectedConnId`). Connecting elsewhere stops the previous connection's consumers (`consumerStore.stopForConn`). The right panel shows `DisconnectedPanel` until connected.

**Connection profiles:** stored in `rabbit-connections.json` in the app data directory (Rust `fs::write`). Fields: `id`, `name`, `host`, `port` (management), `amqpPort`, `vhost`, `username`, `password`, `useTls`, `caPem`, `clientIdentityPkcs12` (base64), `clientIdentityPassword`, `heartbeat`, `connectionName`, `amqpOnly`, `extraHosts` (for HA failover). All fields with `#[serde(default)]` for backward compatibility. `null_as_default` custom deserializer handles legacy `null` values for `Vec<String>` fields.

**Multiple hosts (HA failover):** `extraHosts: string[]` — additional `"host"` or `"host:port"` entries. `connect_amqp` iterates all endpoints (primary + extras) with a 15 s per-endpoint timeout, returning on first success. `ConnectionForm.tsx` exposes an **Addresses** field (comma-separated `host:port`).

**AMQP-only mode:** when `amqpOnly: true`, the management API is not called. Queue/exchange topology is tracked by name per connection in `knownNamesStore.ts` (`localStorage`). `useKnownNames(connId, kind)` provides the typed-name list. Management-dependent views (Overview, Connections) resolve to Queues in this mode.

**Queue list pagination:** `QueueListView.tsx` fetches pages of 200 via management API (`page`, `page_size`, `pagination=true`, `disable_stats=true`, `enable_queue_totals=true`). Server-side name filter with 300 ms debounce. `useRabbitData.ts` is **load-once** — serves cache and does not background-revalidate; `refresh()` is explicit.

**Input history:** `inputHistoryStore.ts` — per-connection history (localStorage, fields `'exchange'|'routingKey'|'queue'`, cap 25). `inputHistory.add/remove/get`, `useRecentMatches(connId, field, query)`. `RecentSuggestions.tsx` renders a "Recent" group combobox dropdown.

**RPC view:** `RpcView.tsx` — module-scope `rpcDraft` (in-memory) seeds and mirrors all fields. Payload uses `CodeEditor` (JSON/plain Segmented + Format button). Reply uses `ResponseViewer` (JSON/plain, auto-detect from contentType). Exchange/routing-key/queue comboboxes use `useRecentMatches` + `RecentSuggestions`.

**Live consumers:** `consumerStore.ts` (module-scope `Map`) manages `rabbit_consume_start` / `rabbit_consume_stop` Rust AMQP consumers. `stopForConn(connId)` stops all consumers for a connection; `stopAll()` on unmount.

**Rust backend (`src-tauri/src/rabbit.rs`):**
- `rabbit_amqp_test` — connect test (iterates all endpoints)
- `rabbit_publish` — full AMQP publish with properties + mandatory + publisher confirms → `PublishOutcome`
- `rabbit_consume_start` / `rabbit_consume_stop` — live consumer via `ConsumerRegistry` (Mutex<HashMap<String, Arc<Notify>>>); prefetch-bounded; peek (non-destructive) or consume (ack)
- `rabbit_rpc_call` — one-shot request/response via `amq.rabbitmq.reply-to`
- `rabbit_amqp_queues_info` / `rabbit_amqp_exchanges_info` — passive declare for AMQP-only mode
- `rabbit_amqp_declare_queue` / `rabbit_amqp_declare_exchange` / `rabbit_amqp_bind_queue` — topology management over AMQP

**Live indicator:** `useEffect(() => { liveConnections.set('rabbit-client', isConnected); }, [isConnected])` in `RabbitClient.tsx`.

Key files:
- `RabbitClient.tsx` — root component, connect/disconnect, resize, routing
- `LeftPanel.tsx` — connection selector + status dot + Connect/Disconnect button
- `useRabbitState.ts` — navigation state + persisted `connectedConnId`
- `ConnectionForm.tsx` — AMQP-first form: Addresses (comma-separated multi-host), optional management API toggle, Advanced (vhost), Paste URI collapsible
- `api.ts` — `rabbitMgmt` HTTP client + `QUEUE_LIST_QUERY` / `EXCHANGE_LIST_QUERY` constants
- `types.ts` — `RabbitConnection`, `rabbitApi` Tauri invoke wrappers
- `consumerStore.ts` — module-scope consumer registry + `stopForConn(id)`
- `inputHistoryStore.ts` — per-connection exchange/routingKey/queue history
- `knownNamesStore.ts` — AMQP-only typed queue/exchange names per connection
- `useRabbitData.ts` — load-once SWR-style data cache

---

## Shared Components for Complex Tools

### `ViewHeader` — `src/components/ui/view-header.tsx`
Reusable detail/list header: icon chip + title + muted subtitle + action buttons + optional back chevron. Used by `QueueView`, `ExchangeView`, `GroupView`, `TopicListView`, etc.

```tsx
import { ViewHeader } from '@/components/ui/view-header';

<ViewHeader
  icon={<Layers className="h-4 w-4" />}
  title={queueName}
  subtitle={`${readyCount} ready`}
  actions={<Button size="sm">Publish</Button>}
  onBack={handleBack}
/>
```

### `CodeEditor` — `src/components/tools/apiclient/CodeEditor.tsx`
Editable CodeMirror 6 editor. Props: `value`, `onChange`, `language` (`'json'|'text'|…`), `placeholder`. Used for request payloads (RPC, Produce). Implements the flex layout pattern described in Cross-Platform Rules.

### `ResponseViewer` — `src/components/tools/apiclient/ResponseViewer.tsx`
Read-only CodeMirror 6 viewer with JSON/text syntax highlight. Props: `value`, `language`. Used for RPC reply and Kafka/RabbitMQ consume message body.

---

## Dependencies Quick Reference

### Design System import (preferred)
```tsx
import { Button, Card, Textarea, Select, CopyButton, ToolSection, ToolToolbar, ToolPanes, ToolPane, PaneHeader, cn } from '@/design-system';
```

### Most Used UI Components (direct path)
```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { CopyButton } from '@/components/ui/copy-button';
import { ToolToolbar, ToolPanes, ToolPane, PaneHeader } from '@/components/ui/tool-layout';
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';
import { ViewHeader } from '@/components/ui/view-header';
```

### Most Used Utilities
```tsx
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { useFeatures } from '@/contexts/FeatureContext';
import { useUpdate } from '@/contexts/UpdateContext';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useTauriFileDrop } from '@/hooks/useTauriFileDrop';
import { ToolHeaderActions } from '@/components/ToolHeaderActions';
import { liveConnections, useLiveConnections } from '@/lib/liveConnections';
```

### Key npm Packages
- `@tauri-apps/plugin-clipboard-manager` — clipboard read/write
- `@tauri-apps/plugin-dialog` — file open/save dialogs
- `@tauri-apps/plugin-fs` — file system access
- `@tauri-apps/plugin-process` — `relaunch()`
- `@tauri-apps/plugin-updater` — `check()` → `update.downloadAndInstall()`
- `@tauri-apps/plugin-http` — Rust-side `fetch` for Network Tools (bypasses WebView CORS/Origin)
- `@tauri-apps/plugin-opener` — open URLs in the default browser
- `crypto-js` — hashing & AES encryption
- `hash-wasm` — WASM-accelerated checksums
- `smol-toml` — TOML parse/serialize (Data Converter)
- `fast-xml-parser` — XML parse/serialize (Data Converter)
- `js-yaml` — YAML parse/serialize
- `rskafka` (Rust, v0.6) — Kafka client (via `rustls 0.23`)
- `tokio-rustls` + `rustls-pemfile` + `rustls-platform-verifier` (Rust) — TLS for the hand-rolled Kafka wire-protocol path (SSL/SASL_SSL); `hmac` + `pbkdf2` + `sha2` back the SCRAM-SHA-256/512 SASL mechanisms
- `lapin` (Rust, v4.x) — AMQP 0-9-1 client; TLS via `rustls-platform-verifier` (OS trust store) + optional CA PEM / PKCS#12 mTLS
- `local-ip-address` + `hostname` (Rust) — back `local_network_info` for Network tool Local Network view
- `netstat2` + `sysinfo` (Rust) — back `list_listening_ports` for Network tool Ports view
- `diff` — text diffing
- `qrcode` — QR generation
- `jsqr` — QR image decoding
- `react-markdown` — markdown rendering
- `@faker-js/faker` — fake data generation
- `date-fns` — date formatting
- `lodash` — utility functions
- `jwt-decode` — JWT parsing
- `uuid` — UUID v4/v7 generation

> **Network Tools** (`src/components/tools/NetworkTools.tsx`, `src/lib/network.ts`): DNS-over-HTTPS lookups, propagation, DNSSEC, public-IP/geo, local network info, and a **Ports** view (listening sockets + owning process, with Processes/Sockets layouts, column sort, scope local/LAN/all, and persisted favourite ports). Uses an **in-memory session store** (not `usePersistentState`) so results survive tab switches but clear on app restart — the one exception is favourite ports, persisted in `localStorage`.

---

## Docs

| File | Contents |
|------|----------|
| [CONTRIBUTING.md](../human/CONTRIBUTING.md) | How to add a new tool (step-by-step) |
| [SETUP.md](../human/SETUP.md) | Prerequisites, running, building, troubleshooting |
| [TOOLS.md](../human/TOOLS.md) | Per-tool transparency: system access, permissions, storage, risk |
| [kafka-explorer.md](../human/kafka-explorer.md) | Kafka Explorer — full operation-level Kafka API reference |
| [design/DESIGN-SYSTEM.md](../design/DESIGN-SYSTEM.md) | Design system — tokens, utilities, components, accessibility |

---

## File Modification Guide

| Path | Safety |
|---|---|
| `src/components/tools/*.tsx` | ✅ Safe — add/edit tools freely |
| `src/lib/toolGuides.tsx` | ✅ Safe — add/edit per-tool help text |
| `src/hooks/*.ts` | ⚠️ Careful — many tools depend on these |
| `src/lib/toolDefs.ts` | ⚠️ Careful — all tools depend on this |
| `src/lib/liveConnections.ts` | ⚠️ Careful — sidebar live dot reads this |
| `src/config/appConfig.ts` | ⚠️ Careful — Settings editor is driven by this |
| `src/App.tsx` | ⚠️ Careful — core routing and layout |
| `src/contexts/*.tsx` | ⚠️ Careful — shared state |
| `src/components/Settings.tsx` | ⚠️ Careful — Settings UI |
| `src/design-system/` | ⚠️ Careful — shared tokens; changes affect whole app |
| `src/components/ui/*.tsx` | ❌ Rarely — regenerate via shadcn CLI instead |
| `vite.config.ts` | ❌ Rarely — build pipeline |
| `src-tauri/*` | ❌ Rarely — only for new Rust features or capabilities |

---

## Common Issues

**Tool not in sidebar**: check `id` in `TOOL_DEFS` matches key in `TOOL_ROUTES` and `DEFAULT_FEATURES`, and that the id appears in `DEFAULT_TOOL_ORDER`. Clear stale localStorage: `localStorage.clear()`.

**TypeScript errors**: run `npm run build` to surface all errors at once.

**Tailwind classes not applying**: restart dev server; ensure file is covered by `tailwind.config.js` content glob.

**Tauri capability denied**: add the permission string to `src-tauri/capabilities/default.json` — the build error message prints the valid strings.

**Worker build fails**: workers must be imported as `new Worker(new URL('./file.ts', import.meta.url), { type: 'module' })`. Do not use esbuild minify option — Vite 8 uses OXC (`minify: true` boolean).

**AppConfig value not updating in Settings**: verify that `CONFIG_FIELDS` in `src/config/appConfig.ts` has a matching entry with the right `section`/`key`/`min`/`max` — the Settings editor is code-generated from that array.

**Undo/redo/copy/paste not working (macOS)**: the native Edit menu is registered in `src-tauri/src/main.rs` via `tauri::menu::PredefinedMenuItem`. If these shortcuts stop working after a `main.rs` change, verify the `.setup()` block is still present and `app.set_menu(menu)?` is called.

**Kafka/RabbitMQ live dot missing**: check that the tool's `useEffect(() => { liveConnections.set(featureId, isConnected); }, [isConnected])` is present and that `liveConnections.ts` has a matching `seed()` call for that tool's localStorage key.

---

*Last updated: 2026-07-01*
