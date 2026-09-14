# Contributing to DevTool

## Adding a New Tool

Every tool is a **plugin**: one folder, one manifest. The Platform discovers it
automatically — there is no registration table and no route to wire up.

### Step 1: Create the component

Create `src/components/tools/YourTool.tsx`. Use real-time output (no "Process"
button), persist the input through the Platform SDK, and wire up the shared
paste/undo hooks:

```tsx
import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { useInputHistory } from '@/hooks/useInputHistory';

export function YourTool() {
  const sdk = usePluginSdkFor('your-tool');
  const [input, setInput] = usePluginState(sdk, 'input', '');
  const output = useMemo(() => input.toUpperCase(), [input]);

  useQuickPaste(setInput);          // ⌘V / Ctrl+V pastes from clipboard
  useInputHistory(input, setInput); // ⌘Z / ⌘⇧Z undo/redo

  return (
    <div className="tool-full-height">
      <div className="tool-scrollable tool-padding tool-spacer">
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
      </div>
    </div>
  );
}
```

### Step 2: Declare the plugin — `src/plugins/your-tool/plugin.ts`

**This is the only registration step.** The folder name must equal the `id`.

```ts
import { YourIcon } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'your-tool',
  label: 'Your Tool',
  icon: YourIcon,
  description: 'One-line description shown in sidebar tooltip and Settings.',
  keywords: ['synonym'],              // optional, improves sidebar search
  route: '/your-tool',                // absolute, unique
  order: 265,                         // sidebar position, unique
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/YourTool').then((m) => m.YourTool),
});
```

**Done.** Metadata, sidebar order, route, code-splitting and the default on/off
state all come from this file. `TOOL_DEFS`, `TOOL_ROUTES` and `DEFAULT_FEATURES`
are derived views — do not edit them.

### Declaring permissions

Only declare what the tool actually touches; Settings → Plugins shows the list to
users and every call is recorded in the audit log. Some permissions must come with
an allowlist — `native` with `commands`, `http` with `hosts`, `service` with
`service.methods` — because a permission without one is unlimited access.

Anything credential-shaped (tokens, seeds, passwords) belongs in `sdk.secrets` /
`useSecretState`, never in `sdk.storage`. When moving an existing key into the
plugin namespace, always pass `usePluginState(..., { legacyKey: 'devtool:old:key' })`
or the user's saved data is silently lost.

Full reference: [`docs/decisions/platform-plugin-architecture.md`](../decisions/platform-plugin-architecture.md).

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
<p className="text-xs text-fg-mute"> // secondary text
```

Use `cn()` from `@/lib/utils` for conditional classes:

```tsx
import { cn } from '@/lib/utils';
className={cn('base', isActive && 'text-acc')}
```

---

## Best Practices

- **No "Process" button**: compute output from input with `useMemo` — update on every keystroke
- **Persist input**: use `usePluginState` so the tool remembers its last value across restarts
- **Copy button**: add a copy-to-clipboard button for outputs using `copyToClipboard` from `@/lib/clipboard`
- **Heavy computation**: offload anything that could block >16ms to a Web Worker in `src/workers/`
- **Error states**: always handle errors and show a message in the UI — never let it silently fail

---

## Before Submitting

1. Test with various inputs including edge cases
2. Verify light and dark mode both look correct
3. Run `npm run build` to catch TypeScript errors
