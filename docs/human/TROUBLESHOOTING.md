# Troubleshooting Guide

Common issues and their solutions for DevTool development.

---

## Development Issues

### Issue: `npm run dev` fails with port error

**Error**: `Port 1420 is already in use`

**Solution**:
```bash
# Kill process on port 1420
lsof -ti:1420 | xargs kill -9

# Or change port in vite.config.ts
```

---

### Issue: Hot reload not working

**Symptoms**: Changes don't reflect in browser

**Solutions**:
1. Check browser console for errors
2. Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
3. Restart dev server
4. Clear browser cache

---

### Issue: TypeScript errors in IDE but build works

**Cause**: IDE TypeScript version mismatch

**Solution**:
```bash
# Use workspace TypeScript
# In VSCode: Cmd+Shift+P → "TypeScript: Select TypeScript Version" → "Use Workspace Version"

# Or restart TypeScript server
# VSCode: Cmd+Shift+P → "TypeScript: Restart TS Server"
```

---

### Issue: `Module not found` error

**Error**: `Cannot find module '@/components/...'`

**Solutions**:
1. Check import path is correct
2. Verify file exists
3. Check `tsconfig.json` has correct `paths`:
   ```json
   {
     "compilerOptions": {
       "baseUrl": ".",
       "paths": {
         "@/*": ["./src/*"]
       }
     }
   }
   ```
4. Restart TypeScript server

---

### Issue: Tailwind classes not applying

**Symptoms**: Styles don't show in browser

**Solutions**:
1. Check class names are correct (no typos)
2. Verify `tailwind.config.js` includes your files:
   ```js
   content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}']
   ```
3. Restart dev server
4. Check if using custom CSS instead of Tailwind (don't mix)

---

## Build Issues

### Issue: `npm run tauri:build` fails - Rust not found

**Error**: `cargo: command not found`

**Solution**:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload shell
source $HOME/.cargo/env

# Verify
cargo --version
```

---

### Issue: Build fails - Icons not found

**Error**: `failed to read icon .../icons/32x32.png`

**Solution**:

**Option 1**: Disable bundling for dev
```json
// src-tauri/tauri.conf.json
{
  "tauri": {
    "bundle": {
      "active": false  // ← Set to false
    }
  }
}
```

**Option 2**: Create placeholder icons
```bash
# See src-tauri/icons/README.md for instructions
# Or use: tauri icon <path-to-512x512-png>
```

---

### Issue: Build succeeds but app won't start

**Symptoms**: App crashes immediately or shows blank screen

**Solutions**:
1. Check console/terminal for errors
2. Try dev mode first: `npm run tauri:dev`
3. Check `src-tauri/tauri.conf.json` for valid config
4. Verify Rust code compiles: `cd src-tauri && cargo check`
5. Clear build cache: `rm -rf src-tauri/target && npm run tauri:build`

---

### Issue: Build is very slow

**Cause**: First build or clean build compiles all Rust dependencies

**Solution**:
- First build: 5-10 minutes (normal)
- Subsequent builds: 30-60 seconds (much faster)
- Use `npm run dev` for development (faster iteration)

---

## Feature/Component Issues

### Issue: New tool doesn't appear in sidebar

**Symptoms**: Added tool but can't see it

**Checklist**:
1. ✅ Tool added to `allTools` array in `App.tsx`?
2. ✅ `featureId` is unique and matches everywhere?
3. ✅ Feature added to `DEFAULT_FEATURES` in `FeatureContext.tsx`?
4. ✅ Feature added to `FEATURE_LIST` in `Settings.tsx`?
5. ✅ Component imported correctly?

**Debug**:
```tsx
// In browser console
localStorage.getItem('devtool-features')
// Should show your feature: {"your-tool": true}

// If false, enable it
localStorage.setItem('devtool-features', JSON.stringify({
  ...JSON.parse(localStorage.getItem('devtool-features')),
  'your-tool': true
}))
// Then refresh
```

---

### Issue: Tool shows but clicking does nothing

**Cause**: Route not registered or path mismatch

**Solution**:
1. Check `path` in `allTools` matches component route
2. Verify component is in routes
3. Check browser console for errors
4. Try direct URL: `http://localhost:1420/your-tool`

---

### Issue: Feature toggle doesn't work

**Symptoms**: Toggling in Settings doesn't hide/show tool

**Debug**:
```tsx
// Check FeatureContext is wrapping App
// In App.tsx:
function App() {
  return (
    <FeatureProvider>  {/* ← Must be here */}
      <Router>
        <AppContent />
      </Router>
    </FeatureProvider>
  );
}

// Check sidebar uses isFeatureEnabled
const enabledTools = allTools.filter((tool) => 
  isFeatureEnabled(tool.featureId)
);
```

---

### Issue: Settings not persisting

**Symptoms**: Settings reset after refresh

**Solutions**:
1. Check browser allows localStorage
2. Check no localStorage.clear() calls
3. Try different browser (test incognito mode)
4. Check browser storage quota

**Debug**:
```tsx
// In browser console
localStorage.setItem('test', 'value')
localStorage.getItem('test')  // Should return 'value'

// If null, localStorage is blocked
```

---

## Styling Issues

### Issue: Dark mode not working

**Symptoms**: Toggle doesn't change theme

**Solutions**:
1. Check `document.documentElement.classList` in browser console
2. Verify globals.css has `.dark` styles
3. Check toggle updates state and localStorage

**Debug**:
```tsx
// In browser console
document.documentElement.classList.contains('dark')  // true/false
localStorage.getItem('devtool-dark-mode')  // 'true'/'false'

// Manual toggle
document.documentElement.classList.toggle('dark')
```

---

### Issue: Component styling looks broken

**Symptoms**: Buttons, cards, etc. look wrong

**Solutions**:
1. Check all shadcn/ui components are imported
2. Verify globals.css is imported in main.tsx
3. Check no conflicting CSS
4. Verify tailwind.config.js is correct

---

### Issue: Responsive design broken on mobile

**Symptoms**: Layout breaks on small screens

**Solutions**:
1. Add responsive classes: `sm:`, `md:`, `lg:`
2. Test at different breakpoints
3. Check sidebar overlay works: `lg:hidden`, `lg:translate-x-0`

---

## State Management Issues

### Issue: State not updating

**Symptoms**: `setState` called but UI doesn't update

**Solutions**:
1. Check state is immutable update:
   ```tsx
   // ❌ Wrong (mutates)
   state.push(item)
   setState(state)
   
   // ✅ Correct (new array)
   setState([...state, item])
   ```

2. Verify dependency array in useEffect:
   ```tsx
   useEffect(() => {
     // Uses `value`
   }, [value])  // ← Must include value
   ```

---

### Issue: Infinite re-render loop

**Error**: `Maximum update depth exceeded`

**Cause**: State update in render or missing deps

**Solutions**:
```tsx
// ❌ Wrong
function Component() {
  const [count, setCount] = useState(0)
  setCount(count + 1)  // ← Runs every render!
}

// ✅ Correct
function Component() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(count + 1)  // ← Runs once
  }, [])  // ← Empty deps
}
```

---

## Performance Issues

### Issue: Tool is slow/laggy

**Symptoms**: Input lag, slow rendering

**Solutions**:
1. Add useMemo for expensive calculations:
   ```tsx
   const result = useMemo(() => {
     return expensiveFunction(input)
   }, [input])
   ```

2. Add useCallback for event handlers:
   ```tsx
   const handleChange = useCallback((e) => {
     setValue(e.target.value)
   }, [])
   ```

3. Debounce rapid updates:
   ```tsx
   import { useMemo } from 'react'
   
   const debouncedValue = useMemo(() => {
     const timeout = setTimeout(() => {
       return value
     }, 300)
     return () => clearTimeout(timeout)
   }, [value])
   ```

---

## Tauri-Specific Issues

### Issue: Clipboard API not working

**Error**: `navigator.clipboard is undefined`

**Solutions**:
1. Check tauri.conf.json allowlist:
   ```json
   {
     "allowlist": {
       "clipboard": { "all": true }
     }
   }
   ```

2. Use Tauri clipboard API:
   ```tsx
   import { writeText } from '@tauri-apps/api/clipboard'
   
   await writeText('text to copy')
   ```

---

### Issue: IPC/Invoke fails

**Error**: `[tauri] command not found`

**Cause**: Command not registered in Rust

**Solution**:
Add command to `src-tauri/src/main.rs`:
```rust
#[tauri::command]
fn your_command() -> String {
    "result".into()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![your_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## Git Issues

### Issue: Merge conflicts in package-lock.json

**Solution**:
```bash
# Accept theirs or yours
git checkout --theirs package-lock.json
# Or
git checkout --ours package-lock.json

# Then regenerate
npm install

# Stage and continue
git add package-lock.json
git merge --continue
```

---

### Issue: Large node_modules in git

**Symptom**: Git is slow, huge repo size

**Solution**:
```bash
# Check .gitignore includes node_modules
echo "node_modules" >> .gitignore

# Remove from git if already committed
git rm -r --cached node_modules
git commit -m "Remove node_modules from git"
```

---

## Common Error Messages

### `EADDRINUSE: address already in use`
**Fix**: Kill process on that port (see above)

### `Cannot find module`
**Fix**: Check import paths, run `npm install`

### `Unexpected token`
**Fix**: Check for syntax errors, missing brackets

### `Failed to parse source map`
**Fix**: Ignore (dev warning) or add to .gitignore

### `CORS error`
**Fix**: Not applicable (local app, no CORS)

### `hydration mismatch`
**Fix**: Check server/client rendering differences (shouldn't occur in this app)

---

## Debugging Techniques

### React DevTools
```bash
# Install extension in browser
# View component tree, props, state
```

### Console Logging
```tsx
console.log('Value:', value)
console.table(array)
console.dir(object)
```

### Debugger
```tsx
debugger;  // Pauses execution in DevTools
```

### Network Tab
Check failed requests, API calls

### React Error Boundaries
```tsx
// Wrap components to catch errors
<ErrorBoundary>
  <YourComponent />
</ErrorBoundary>
```

---

## Getting Unstuck

If you're stuck after trying solutions:

1. **Search error message**: Google the exact error
2. **Check GitHub issues**: tauri-apps/tauri, React, etc.
3. **Clear everything**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   rm -rf src-tauri/target
   npm run tauri:build
   ```
4. **Start fresh**:
   ```bash
   git stash
   git checkout main
   git pull
   npm install
   npm run dev
   ```

---

## Prevention Tips

### Before Making Changes
1. ✅ Test in dev mode first
2. ✅ Commit working state
3. ✅ Make small, incremental changes
4. ✅ Test after each change

### Code Quality
1. ✅ Run TypeScript check: `npm run build`
2. ✅ Follow existing patterns
3. ✅ Keep components simple
4. ✅ Test in both light and dark mode

### Git Hygiene
1. ✅ Commit often
2. ✅ Write clear commit messages
3. ✅ Don't commit node_modules or build artifacts
4. ✅ Pull before starting new work

---

*Last updated: 2026-06-11*
