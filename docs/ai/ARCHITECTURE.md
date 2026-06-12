# DevTool Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Desktop Shell                        │
│                   (Tauri - Rust)                        │
│  ┌───────────────────────────────────────────────────┐ │
│  │              WebView Container                     │ │
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │         React Application                    │ │ │
│  │  │  ┌───────────────────────────────────────┐  │ │ │
│  │  │  │         App.tsx (Router)              │  │ │ │
│  │  │  │  ┌─────────────────────────────────┐  │  │ │ │
│  │  │  │  │  FeatureContext (State)        │  │  │ │ │
│  │  │  │  └─────────────────────────────────┘  │  │ │ │
│  │  │  │  ┌──────────┐  ┌──────────────────┐  │  │ │ │
│  │  │  │  │ Sidebar  │  │  Tool Components │  │  │ │ │
│  │  │  │  │ Nav      │  │  - CronGen       │  │  │ │ │
│  │  │  │  │          │  │  - ColorPicker   │  │  │ │ │
│  │  │  │  │          │  │  - TextCounter   │  │  │ │ │
│  │  │  │  └──────────┘  │  - Base64        │  │  │ │ │
│  │  │  │                │  - ...           │  │  │ │ │
│  │  │  │                └──────────────────┘  │  │ │ │
│  │  │  └───────────────────────────────────────┘  │ │ │
│  │  └─────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  System APIs: Clipboard, FileSystem, Dialogs          │
└─────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
   ┌──────────┐                      ┌─────────────┐
   │localStorage│                      │  Tauri APIs │
   │ Settings  │                      │  (Rust)     │
   └──────────┘                      └─────────────┘
```

## Layer Breakdown

### 1. Tauri Layer (Native)
**Technology**: Rust + OS APIs  
**Responsibilities**:
- Create native window
- Manage app lifecycle
- Provide system APIs (clipboard, file system)
- Handle IPC (Inter-Process Communication)

**Files**:
- `src-tauri/src/main.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

### 2. WebView Layer (Browser)
**Technology**: Platform WebView (WKWebView/WebView2/WebKitGTK)  
**Responsibilities**:
- Render HTML/CSS/JS
- Execute React application
- Bridge to Tauri APIs

### 3. React Application Layer
**Technology**: React 18 + TypeScript  
**Responsibilities**:
- UI rendering
- State management
- Routing
- Business logic

## Component Architecture

```
App.tsx (Root)
├── FeatureProvider (Context)
│   └── App Component
│       ├── Router
│       │   ├── Sidebar (Navigation)
│       │   │   ├── Dark mode toggle
│       │   │   ├── Tool list (filtered by features)
│       │   │   └── Collapse button
│       │   └── Main (Content)
│       │       └── Routes
│       │           ├── /              → CronGenerator
│       │           ├── /text-counter  → TextCounter
│       │           ├── /color-picker  → ColorPicker
│       │           ├── ...            → Other tools
│       │           └── /settings      → Settings
```

## State Management

### Context API Structure

```
FeatureContext
├── features: Record<string, boolean>
├── toggleFeature(id: string): void
├── isFeatureEnabled(id: string): boolean
└── resetToDefaults(): void
```

**Data Flow**:
```
User action → toggleFeature() → Update state → 
Save to localStorage → Re-render sidebar → Filter tools
```

### Local State (Component-level)

Each tool manages its own state:
```tsx
function ColorPicker() {
  const [color, setColor] = useState('#3B82F6');
  // Tool logic...
}
```

**No global state for tool data** - keeps components isolated.

## Routing Architecture

### React Router v6

```tsx
<Routes>
  <Route path="/" element={<CronGenerator />} />
  <Route path="/text-counter" element={<TextCounter />} />
  <Route path="/color-picker" element={<ColorPicker />} />
  {/* ... */}
</Routes>
```

**Navigation Flow**:
1. User clicks tool in sidebar
2. React Router updates URL
3. Route matches → Component mounts
4. Old component unmounts (state cleared)

**Benefits**:
- Lazy loading (only active tool in memory)
- Clean URL structure
- Browser back/forward works
- Deep linking support

## Data Flow

### Tool Lifecycle

```
Mount → Initialize State → User Input → 
Process → Update State → Render Output → 
Unmount (on navigate away)
```

### Feature Toggle Flow

```
Settings Page
    ↓ (user toggles)
FeatureContext.toggleFeature()
    ↓
Update features state
    ↓
Save to localStorage
    ↓
Sidebar re-renders
    ↓
Filter allTools array
    ↓
Show/hide tool in nav
```

## Styling Architecture

### Tailwind + CSS Variables

```
globals.css (CSS Variables)
    ↓
Tailwind Config (Theme)
    ↓
Component (Tailwind Classes)
    ↓
cn() utility (Conditional Classes)
    ↓
Rendered CSS
```

**Theme System**:
```css
/* Light mode */
:root {
  --primary: 221.2 83.2% 53.3%;
}

/* Dark mode */
.dark {
  --primary: 217.2 91.2% 59.8%;
}
```

**Usage**:
```tsx
<div className="bg-primary text-primary-foreground">
  {/* Uses CSS variables automatically */}
</div>
```

## Build Architecture

### Development Build

```
npm run dev
    ↓
Vite Dev Server (HMR enabled)
    ↓
http://localhost:1420
    ↓
Browser (or Tauri WebView if using tauri:dev)
```

### Production Build

```
npm run tauri:build
    ↓
1. Vite builds React app → dist/
    ↓
2. Tauri bundles:
   - Embeds dist/ files
   - Compiles Rust code
   - Creates platform bundles
    ↓
3. Output:
   - macOS: .app + .dmg
   - Windows: .msi + .exe
   - Linux: .AppImage + .deb
```

## Performance Architecture

### Code Splitting

**Current**: Route-based (React Router handles this)  
**Future**: Could add dynamic imports for heavy libraries

### Memoization Strategy

```tsx
// Expensive calculations
const stats = useMemo(() => {
  return calculateStats(text);
}, [text]);

// Event handlers
const handleClick = useCallback(() => {
  doSomething();
}, [dependency]);
```

### Re-render Optimization

- Tools don't share state → isolated re-renders
- Feature context only updates sidebar
- Dark mode toggle only updates theme class
- Sidebar collapse only updates width

## Security Architecture

### Tauri Security Model

```
Frontend (Untrusted)
    ↓ (IPC)
Allowlist (tauri.conf.json)
    ↓ (Filtered)
Backend (Trusted Rust)
    ↓
System APIs
```

**Current Allowlist**:
```json
{
  "clipboard": { "all": true },
  "dialog": { "all": true },
  "fs": {
    "readFile": true,
    "writeFile": true,
    "scope": ["$APPDATA/*"]
  }
}
```

**Security Rules**:
- ❌ No `eval()` or `Function()` constructor
- ❌ No inline scripts in HTML
- ✅ All data processing in frontend (isolated)
- ✅ Minimal backend API surface

## Extension Architecture

### Adding New Tool (Architecture View)

```
1. Create Component
   └─> src/components/tools/NewTool.tsx
       └─> Isolated state
       └─> Standard UI components

2. Register in App
   └─> Import component
   └─> Add to allTools array
       └─> Auto-registers route
       └─> Auto-adds to navigation

3. Add Feature Toggle
   └─> Add to DEFAULT_FEATURES
   └─> Add to FEATURE_LIST
       └─> Auto-appears in Settings

4. Result
   └─> Tool accessible
   └─> Toggle-able
   └─> Persistent settings
```

## Error Handling Architecture

### Current Strategy

**Component Level**: Try-catch in handlers
```tsx
const process = () => {
  try {
    const result = complexOperation(input);
    setOutput(result);
  } catch (error) {
    setOutput('Error: ' + error.message);
  }
};
```

**Future**: Add Error Boundaries
```tsx
<ErrorBoundary fallback={<ErrorUI />}>
  <Tool />
</ErrorBoundary>
```

## Storage Architecture

### localStorage Schema

```typescript
// Feature toggles
'devtool-features': {
  'cron-generator': boolean,
  'color-picker': boolean,
  // ...
}

// UI preferences
'devtool-dark-mode': 'true' | 'false'
'devtool-sidebar-collapsed': 'true' | 'false'

// Future: Tool-specific data
'devtool-tool-{toolId}': any
```

**Persistence Strategy**:
- Save on every change (immediate)
- Load on mount
- Clear all: `localStorage.clear()`

## Scalability Considerations

### Current Limitations
- All tools in one bundle (no lazy loading yet)
- localStorage only (no cloud sync)
- No plugin system
- Single language (no i18n)

### Future Scalability
- **Dynamic imports**: Load tools on-demand
- **Plugin system**: External tool packages
- **Cloud sync**: Optional backend for settings
- **Worker threads**: Heavy computations

## Testing Architecture

### Planned Structure

```
__tests__/
├── unit/
│   ├── lib/
│   │   └── utils.test.ts
│   └── components/
│       └── tools/
│           └── ColorPicker.test.tsx
├── integration/
│   ├── FeatureContext.test.tsx
│   └── Settings.test.tsx
└── e2e/
    └── critical-flows.spec.ts
```

### Testing Strategy

1. **Unit**: Pure functions, utilities
2. **Component**: Tool components (RTL)
3. **Integration**: Feature toggle system
4. **E2E**: User workflows (Playwright)

## Deployment Architecture

### Local Build
```
Developer Machine
    ↓
npm run tauri:build
    ↓
Platform Binary (.app/.msi/.AppImage)
    ↓
Manual distribution
```

### CI/CD (GitHub Actions)
```
Git push (tag v*)
    ↓
GitHub Actions (3 runners)
    ├─> macOS runner → .dmg
    ├─> Windows runner → .msi
    └─> Ubuntu runner → .AppImage
    ↓
GitHub Release (automated)
    ↓
Users download
```

## Monitoring & Analytics

### Current: None

### Future Considerations
- Crash reporting (Sentry)
- Usage analytics (opt-in)
- Performance monitoring
- Error tracking

## Platform-Specific Considerations

### macOS
- Code signing required for distribution
- Notarization for Gatekeeper
- .app bundle + .dmg installer

### Windows
- Code signing recommended
- MSI or NSIS installer
- WebView2 dependency

### Linux
- AppImage (portable)
- .deb package (Debian/Ubuntu)
- Permissions for system integration

---

## Architecture Decisions

### Why Tauri over Electron?
- ✅ Smaller bundle size (~3MB vs ~150MB)
- ✅ Better performance (native webview)
- ✅ Lower memory usage
- ✅ Rust backend (secure, fast)
- ❌ Smaller ecosystem (trade-off accepted)

### Why React over Vue/Svelte?
- ✅ Larger ecosystem
- ✅ Better TypeScript support
- ✅ shadcn/ui availability
- ✅ More examples/resources

### Why Context API over Redux/Zustand?
- ✅ Simple state needs
- ✅ Built-in (no extra dependency)
- ✅ Sufficient for feature toggles
- ❌ Would use Zustand if state grew complex

### Why Tailwind over CSS Modules?
- ✅ Faster development
- ✅ Consistent design system
- ✅ shadcn/ui compatibility
- ✅ No naming conflicts

### Why localStorage over IndexedDB?
- ✅ Simpler API
- ✅ Sufficient for settings
- ✅ Synchronous (easier to use)
- ❌ Would use IndexedDB for large data

---

*Last updated: 2026-06-11*
