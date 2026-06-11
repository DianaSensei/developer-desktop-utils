# DevTool - Project Guide for AI Agents

> **Purpose**: This file helps AI coding agents (Claude, etc.) quickly understand the project structure, conventions, and implementation patterns to work efficiently without needing extensive context.

## Project Overview

**DevTool** is a cross-platform desktop application built with Tauri + React + TypeScript providing developer utilities (text processing, encoding, color tools, etc.).

**Key Technologies:**
- **Frontend**: React 18, TypeScript, Vite
- **Desktop**: Tauri (Rust backend)
- **UI**: Tailwind CSS, shadcn/ui components
- **State**: React Context API
- **Routing**: React Router v6

**Version**: 0.1.0  
**License**: MIT  
**Platform Support**: macOS, Windows, Linux

---

## Quick Start Commands

```bash
# Development
npm run dev              # Web only (fast)
npm run tauri:dev        # Desktop app (slower)

# Build
npm run build           # Build web assets
npm run tauri:build     # Build desktop binary

# Dependencies
npm install             # Install all dependencies
```

---

## Project Structure

```
devtool/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui components (Button, Input, etc.)
│   │   ├── tools/           # Tool components (one per utility)
│   │   └── Settings.tsx     # Settings/feature management
│   ├── contexts/
│   │   └── FeatureContext.tsx  # Feature toggle state
│   ├── hooks/               # Shared tool UX hooks (see "Shared Tool Hooks")
│   │   ├── usePersistentState.ts  # useState that persists to localStorage
│   │   ├── useQuickPaste.ts       # ⌘V / Ctrl+V pastes straight into a tool
│   │   └── useInputHistory.ts     # ⌘Z / ⌘⇧Z undo/redo on a tool's input
│   ├── lib/
│   │   └── utils.ts         # Utility functions (cn, etc.)
│   ├── styles/
│   │   └── globals.css      # Tailwind + theme variables
│   ├── App.tsx              # Main app, routing, layout
│   └── main.tsx             # React entry point
├── src-tauri/               # Tauri (Rust) backend
│   ├── src/main.rs          # Rust main
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── public/                  # Static assets
├── *.md                     # Documentation files
└── package.json             # Node dependencies & scripts
```

---

## Architecture Principles

### 1. **Component-Based Architecture**
- Each tool is a self-contained React component
- Tools are isolated and don't share state
- All tools follow the same pattern

### 2. **Feature Toggle System**
- Users can enable/disable any tool
- State managed in `FeatureContext`
- Persisted in localStorage

### 3. **Layout Philosophy**
- Sidebar: Collapsible navigation (`w-56` / 224px expanded, `w-14` / 56px collapsed)
- Content: Full width, maximum space for tools
- Inspired by DevUtils.com - clean, focused, simple

### 4. **Styling Convention**
- Tailwind utility classes (no custom CSS)
- shadcn/ui for consistent components
- Dark mode via CSS variables
- Responsive: mobile-first approach

---

## Adding a New Tool (Step-by-Step)

### 1. Create Tool Component

Create `src/components/tools/YourTool.tsx`. Follow the **modern tool pattern**: process the
input in real time (no "Process" button), persist the input across sessions, and wire up the
shared paste/undo hooks. See [Shared Tool Hooks](#shared-tool-hooks-ux-conventions) for the why.

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
  // Persisted input — survives app restarts. Key: 'devtool:<tool>:<field>'.
  const [input, setInput] = usePersistentState('devtool:yourTool:input', '');

  // Recompute output on every keystroke instead of behind a button.
  const output = useMemo(() => input.toUpperCase(), [input]);

  // ⌘V pastes the clipboard straight into the input; ⌘Z / ⌘⇧Z undo/redo it.
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

### 2. Register in App.tsx

```tsx
// Import icon
import { YourIcon } from 'lucide-react';

// Import component
import { YourTool } from '@/components/tools/YourTool';

// Add to allTools array
const allTools = [
  // ... existing tools
  { 
    path: '/your-tool', 
    label: 'Your Tool', 
    icon: YourIcon, 
    component: YourTool, 
    featureId: 'your-tool' 
  },
];
```

### 3. Add to FeatureContext.tsx

```tsx
const DEFAULT_FEATURES: FeatureSettings = {
  // ... existing features
  'your-tool': true,
};
```

### 4. Add to Settings.tsx

```tsx
// Import icon
import { YourIcon } from 'lucide-react';

// Add to FEATURE_LIST
const FEATURE_LIST = [
  // ... existing features
  { id: 'your-tool', label: 'Your Tool', icon: YourIcon },
];
```

**That's it!** Your tool is now:
- ✅ Accessible via `/your-tool` route
- ✅ Visible in sidebar
- ✅ Toggle-able in Settings
- ✅ Persistent across sessions

---

## Shared Tool Hooks (UX conventions)

Tools share a small set of hooks in `src/hooks/` that encode the app's UX conventions.
**New and edited tools should use them** so every tool behaves consistently: process in real
time, remember their last input, and accept a one-keystroke paste. Prefer these over re-rolling
local `useState` + a "Process" button.

### `usePersistentState(key, initial)` — `src/hooks/usePersistentState.ts`
Drop-in replacement for `useState` that persists the value to `localStorage` under `key`, so a
tool keeps its input/selection after the app closes or you switch tools and back. JSON-serializable
values only. Corrupt/blocked storage falls back to `initial` silently.

```tsx
const [input, setInput] = usePersistentState('devtool:json:input', '');
```
**Key convention:** `devtool:<toolName>:<field>` (e.g. `devtool:textCounter:text`). One key per
field so tools don't clobber each other.

### `useQuickPaste(onPaste, enabled?)` — `src/hooks/useQuickPaste.ts`
While the tool is mounted, pressing ⌘V / Ctrl+V reads the clipboard and calls `onPaste(text)` —
no extra click, no popup. In the Tauri desktop build it reads via the Rust backend (avoids the
WebKit clipboard-permission prompt); in a browser it uses the Clipboard API. Also exports
`quickPasteHint` (`"Press ⌘V to paste"` / `"Press Ctrl+V to paste"`) for placeholder/help text.

```tsx
useQuickPaste(setInput);
```

### `useInputHistory(value, applyValue, enabled?)` — `src/hooks/useInputHistory.ts`
Adds undo/redo to a tool's primary input for the lifetime it's mounted. ⌘Z / Ctrl+Z undoes,
⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redoes. User edits are debounced (~400ms) into history entries;
programmatic changes (paste, format, clear) are captured too.

```tsx
useInputHistory(input, setInput);
```

> The convention is: **real-time output (`useMemo`), persisted input (`usePersistentState`),
> quick paste (`useQuickPaste`), and undo/redo (`useInputHistory`)** — with a minimalist UI.
> Some tools (e.g. UUID/QR generators) legitimately keep an action button where there is no
> "input to transform"; use judgment.

---

## Code Conventions

### Naming
- **Components**: PascalCase (`ColorPicker.tsx`)
- **Files**: kebab-case for routes (`color-picker`)
- **Feature IDs**: kebab-case (`'color-picker'`)
- **Variables**: camelCase (`isCollapsed`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_FEATURES`)

### TypeScript
- Use interfaces for props
- Use type for unions/intersections
- Avoid `any` - use `unknown` if needed
- Export interfaces with components

### React Patterns
```tsx
// State
const [value, setValue] = useState('');

// Effects
useEffect(() => {
  // Side effects
}, [dependency]);

// Memoization (for expensive computations)
const computed = useMemo(() => {
  return expensiveCalculation(value);
}, [value]);

// Event handlers
const handleClick = () => {
  // Logic
};
```

### Styling
```tsx
// Use cn() for conditional classes
className={cn(
  'base-classes',
  condition && 'conditional-classes',
  isActive ? 'active-classes' : 'inactive-classes'
)}

// Common patterns
'space-y-4'        // Vertical spacing
'flex gap-2'       // Horizontal spacing
'rounded-lg'       // Border radius
'border'           // Border
'p-4'              // Padding
'text-sm'          // Text size
'font-medium'      // Font weight
```

---

## Common Issues & Solutions

### Issue 1: Tool not showing in sidebar
**Cause**: Feature ID mismatch or not enabled  
**Solution**: 
1. Check `featureId` in `allTools` matches ID in `FeatureContext`
2. Check feature is `true` in `DEFAULT_FEATURES`
3. Clear localStorage: `localStorage.clear()`

### Issue 2: TypeScript errors after adding tool
**Cause**: Missing imports or type definitions  
**Solution**:
1. Ensure all imports are correct
2. Check component props have proper types
3. Run `npm run build` to see all errors

### Issue 3: Styles not applying
**Cause**: Tailwind classes not recognized  
**Solution**:
1. Check `tailwind.config.js` includes your file
2. Restart dev server
3. Use standard Tailwind classes (no custom CSS)

### Issue 4: Component not updating
**Cause**: Missing dependencies in useEffect/useMemo  
**Solution**: Add all used variables to dependency array

### Issue 5: Build fails with "Icons not found"
**Cause**: Tauri needs icons for bundling  
**Solution**: Set `"bundle": { "active": false }` in `tauri.conf.json` for dev builds

---

## Dependencies Rationale

### Core
- `react` + `react-dom`: UI library
- `typescript`: Type safety
- `vite`: Fast build tool
- `@tauri-apps/api` + `@tauri-apps/cli`: Desktop app framework

### UI
- `tailwindcss`: Utility-first CSS
- `@radix-ui/*`: Accessible UI primitives (used by shadcn)
- `lucide-react`: Icon library
- `class-variance-authority`: Component variants
- `clsx` + `tailwind-merge`: Conditional classes

### Routing
- `react-router-dom`: Client-side routing

### Utilities
- `crypto-js`: Hashing & encryption
- `date-fns`: Date formatting
- `jwt-decode`: JWT decoding
- `qrcode`: QR code generation
- `uuid`: UUID generation
- `diff`: Text diffing
- `react-markdown`: Markdown rendering

---

## State Management

### FeatureContext
**Purpose**: Manage which tools are enabled/disabled  
**Location**: `src/contexts/FeatureContext.tsx`  
**Storage**: localStorage (`devtool-features`)

**API**:
```tsx
const { features, toggleFeature, isFeatureEnabled, resetToDefaults } = useFeatures();

// Check if enabled
isFeatureEnabled('color-picker') // true/false

// Toggle
toggleFeature('color-picker')

// Reset all
resetToDefaults()
```

### Dark Mode
**Storage**: localStorage (`devtool-dark-mode`)  
**Implementation**: CSS class on `<html>` element  
**Location**: `App.tsx` (local state)

### Sidebar Collapse
**Storage**: localStorage (`devtool-sidebar-collapsed`)  
**Implementation**: Width change (`w-56` 224px ↔ `w-14` 56px)  
**Location**: `App.tsx` (local state)

---

## Styling System

### Theme Variables
Located in `src/styles/globals.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  /* ... more variables */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... dark mode values */
}
```

### Component Patterns

**Card Layout** (most tools use this):
```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Content */}
  </CardContent>
</Card>
```

**Input + Button**:
```tsx
<div className="flex gap-2">
  <Input className="flex-1" />
  <Button onClick={handler}>Action</Button>
  <Button size="icon" variant="outline">
    <Copy className="h-4 w-4" />
  </Button>
</div>
```

**Stats Display**:
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
  <StatCard label="Label" value={123} />
</div>
```

---

## Performance Considerations

### Do:
- ✅ Use `useMemo` for expensive calculations
- ✅ Use `useCallback` for event handlers passed to children
- ✅ Keep component state local when possible
- ✅ Lazy load heavy libraries if needed

### Don't:
- ❌ Don't add global state unless necessary
- ❌ Don't re-render entire app on small changes
- ❌ Don't load all tools at once (React Router handles this)
- ❌ Don't use inline function definitions in render (use useCallback)

---

## Testing Strategy

**Current State**: No tests yet (MVP phase)

**Recommended Testing Pyramid**:
1. **Unit Tests**: Utility functions (`lib/utils.ts`)
2. **Component Tests**: Individual tools (React Testing Library)
3. **Integration Tests**: Feature toggle system
4. **E2E Tests**: Critical user flows (Playwright)

**To Add Tests**:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom
```

---

## Build & Deployment

### Development Build
```bash
npm run dev           # Web: http://localhost:1420
npm run tauri:dev     # Desktop: Opens native window
```

### Production Build
```bash
npm run tauri:build
```

**Output locations**:
- macOS: `src-tauri/target/release/bundle/macos/DevTool.app`
- Windows: `src-tauri/target/release/bundle/msi/*.msi`
- Linux: `src-tauri/target/release/bundle/appimage/*.AppImage`

### GitHub Actions
CI/CD configured in `.github/workflows/release.yml`  
Triggers on: `git push origin v*` tags  
Builds for: macOS (x64 + ARM), Windows, Linux

---

## Common Tasks

### Add a new icon
1. Find icon at [lucide.dev](https://lucide.dev)
2. Import: `import { IconName } from 'lucide-react';`
3. Use: `<IconName className="h-4 w-4" />`

### Add a new route
Already handled by adding tool to `allTools` array

### Change sidebar width
Edit `App.tsx`:
```tsx
className={cn(
  'transition-all',
  isCollapsed ? 'w-14' : 'w-56'  // Change these values
)}
```

### Add new color theme
Edit `src/styles/globals.css` and add CSS variables

### Persist new setting
```tsx
// Save
localStorage.setItem('my-setting', value);

// Load
const saved = localStorage.getItem('my-setting');
```

---

## File Modification Rules

### ✅ Safe to modify:
- `src/components/tools/*.tsx` - Add/edit tools
- `src/hooks/*.ts` - Shared tool hooks (edit carefully; many tools depend on them)
- `src/styles/globals.css` - Theme changes
- Tool-specific logic

### ⚠️ Modify with care:
- `src/App.tsx` - Core routing/layout
- `src/contexts/FeatureContext.tsx` - State management
- `src/components/Settings.tsx` - Settings UI

### ❌ Rarely modify:
- `src/components/ui/*.tsx` - shadcn components (regenerate instead)
- `vite.config.ts` - Build configuration
- `tailwind.config.js` - Tailwind setup
- `src-tauri/*` - Tauri backend (unless adding Rust features)

---

## Debugging Tips

### Check sidebar not showing tool
```tsx
// In browser console
localStorage.getItem('devtool-features')
// Should show: {"tool-name": true, ...}
```

### Force reload settings
```tsx
localStorage.clear()
// Then refresh page
```

### Check route registration
```tsx
// Tools should appear in allTools array in App.tsx
console.log(allTools.map(t => t.path))
```

### TypeScript errors
```bash
npm run build  # See all TS errors at once
```

---

## Future Enhancements (Roadmap)

### Planned Features
- [ ] Command palette (Cmd+K) for quick tool access
- [ ] Keyboard shortcuts per tool
- [ ] Import/export settings
- [ ] Custom themes
- [ ] Plugin system for community tools
- [ ] Cloud sync (optional)

### Technical Debt
- [ ] Add unit tests
- [ ] Add E2E tests
- [ ] Improve error boundaries
- [ ] Add logging system
- [ ] Performance monitoring

---

## Quick Reference

### Most Used Components
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
import { cn } from '@/lib/utils';           // Merge classnames
import { useFeatures } from '@/contexts/FeatureContext';      // Feature toggles
import { usePersistentState } from '@/hooks/usePersistentState';  // Persisted input
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';  // ⌘V paste
import { useInputHistory } from '@/hooks/useInputHistory';    // ⌘Z undo/redo
```

### Most Used Icons
```tsx
import { Copy, Check, X, Search, Settings } from 'lucide-react';
```

---

## Getting Help

**Documentation Files**:
- `README.md` - Project overview
- `CLAUDE.md` - This file (AI agent guide)
- `CONTRIBUTING.md` - How to add new tools
- `BUILD.md` - Build instructions
- `LAYOUT.md` - Layout design principles
- `FEATURES.md` - Feature toggle system

**External Resources**:
- [Tauri Docs](https://tauri.app)
- [React Docs](https://react.dev)
- [Tailwind Docs](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com)

---

## Cost Optimization Tips for AI Agents

1. **Read this file first** before asking questions
2. **Check existing tools** for patterns before creating new ones
3. **Use the step-by-step guide** for adding tools (don't ask how)
4. **Reference code conventions** section for style questions
5. **Check common issues** before debugging
6. **Follow the exact structure** - don't reinvent patterns

**Time savings**: Following this guide should reduce context gathering by 70-80%.

---

*Last updated: 2026-06-12*  
*Maintainer: Project team*  
*AI-friendly: Optimized for Claude, GPT-4, and other coding agents*
