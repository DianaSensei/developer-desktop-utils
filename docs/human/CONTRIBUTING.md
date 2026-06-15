# Contributing to DevTool

## Adding a New Tool

### Step 1: Create the component

Create `src/components/tools/YourTool.tsx`. Use real-time output (no "Process" button), persist the input, and wire up the shared paste/undo hooks:

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

  useQuickPaste(setInput);       // ⌘V / Ctrl+V pastes from clipboard
  useInputHistory(input, setInput); // ⌘Z / ⌘⇧Z undo/redo

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <YourIcon className="h-5 w-5" />
          Your Tool
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

### Step 2: Add to `src/lib/toolDefs.ts`

`TOOL_DEFS` is the single source of truth for tool metadata. Settings and the sidebar read from it automatically.

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

### Step 3: Register the route in `src/App.tsx`

```tsx
// Import your component at the top
import { YourTool } from '@/components/tools/YourTool';

// Add to TOOL_ROUTES
const TOOL_ROUTES = {
  // ... existing
  'your-tool': { path: '/your-tool', component: YourTool },
};
```

### Step 4: Enable by default in `src/contexts/FeatureContext.tsx`

```tsx
const DEFAULT_FEATURES: FeatureSettings = {
  // ... existing
  'your-tool': true,
};
```

**Done.** No changes needed in `Settings.tsx` — it reads `TOOL_DEFS` automatically.

---

## UI Components

Always use components from `src/components/ui/` (shadcn/ui). Never use native browser elements like `<select>`, `window.alert`, or `window.confirm` — they break visual consistency across macOS/Windows/Linux.

Commonly used:
- `Button`, `Input`, `Textarea`, `Label`
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
- `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`

See `src/components/ui/` for the full list.

---

## Styling

Tailwind CSS only — no custom CSS. Common patterns:

```tsx
<div className="space-y-4">          // vertical spacing
<div className="flex gap-2">         // horizontal gap
<div className="rounded-lg border p-4">  // card-style container
<p className="text-xs text-muted-foreground"> // secondary text
```

Use `cn()` from `@/lib/utils` for conditional classes:

```tsx
import { cn } from '@/lib/utils';
className={cn('base', isActive && 'text-primary')}
```

---

## Best Practices

- **No "Process" button**: compute output from input with `useMemo` — update on every keystroke
- **Persist input**: use `usePersistentState` so the tool remembers its last value across restarts
- **Copy button**: add a copy-to-clipboard button for outputs using `copyToClipboard` from `@/lib/clipboard`
- **Heavy computation**: offload anything that could block >16ms to a Web Worker in `src/workers/`
- **Error states**: always handle errors and show a message in the UI — never let it silently fail

---

## Before Submitting

1. Test with various inputs including edge cases
2. Verify light and dark mode both look correct
3. Run `npm run build` to catch TypeScript errors
