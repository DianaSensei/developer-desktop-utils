# DevTool Design System - Quick Reference

## 🎨 At a Glance

The new design system provides consistent spacing, typography, and layout patterns for all developer tools.

---

## 📦 Components

### `ToolSection`
Wrapper for related inputs/outputs with consistent spacing.

```tsx
import { ToolSection } from '@/components/ui/tool-section';

<ToolSection>
  <ToolLabel>Input</ToolLabel>
  <ToolHint>Instructions here</ToolHint>
  <Textarea value={...} onChange={...} />
</ToolSection>
```

**Applied styles:** `space-y-2` (vertical spacing between children)

---

### `ToolLabel`
Consistent label for all input fields.

```tsx
<ToolLabel>Field Label</ToolLabel>
```

**Applied styles:** `text-xs font-medium text-foreground`
**Use for:** All input/output field labels

---

### `ToolHint`
Helper text below labels for instructions.

```tsx
<ToolHint>⌘V to paste quickly</ToolHint>
```

**Applied styles:** `text-[11px] text-muted-foreground`
**Use for:** Quick paste hints, format instructions, examples

---

### `ToolContent`
Scrollable content area for full-height tools (rarely used directly).

```tsx
<ToolContent>
  {/* Your content here */}
</ToolContent>
```

---

## 🎯 Layout Classes

### Full-Height Container

Wraps entire tool content, handles height + flex layout:

```tsx
<div className="tool-full-height">
  {/* Content goes here */}
</div>
```

**Applied styles:**
```css
h-full overflow-hidden flex flex-col
```

---

### Scrollable Content Area

Makes content scrollable with proper responsive padding:

```tsx
<div className="tool-scrollable tool-padding tool-spacer">
  {/* Your sections here */}
</div>
```

**Applied styles:**
```css
flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 lg:px-5 space-y-5 sm:space-y-6
```

---

## 📐 Spacing System

### `tool-spacer`
Consistent spacing between sections.

```tsx
<div className="tool-spacer">
  <ToolSection>...</ToolSection>
  <ToolSection>...</ToolSection>
</div>
```

**Spacing:** `space-y-5` (mobile), `space-y-6` (tablet+)

### `tool-padding`
Responsive padding for content areas.

**Mobile (< 640px):** `px-3 py-4`
**Tablet (640px+):** `px-4 py-5`
**Desktop (1024px+):** `px-5`

---

## 📝 Typography Hierarchy

| Level | Class | Usage |
|-------|-------|-------|
| 1 (Highest) | `text-sm font-semibold` | Section headers |
| 2 | `text-xs font-medium` | Field labels (ToolLabel) |
| 3 | `text-[11px] text-muted-foreground` | Helper text (ToolHint) |
| 4 | `text-sm` | Body text |
| 5 | `font-mono text-sm` | Code/monospace content |

---

## 🎨 Color System

### Text Colors
```
text-foreground              Primary text (darkest)
text-muted-foreground       Secondary text, labels
text-destructive            Errors, warnings
text-primary                Links, accents
```

### Background Colors
```
bg-background               Page background
bg-card                     Cards, sections
bg-muted                    Hover states, disabled
bg-destructive              Error backgrounds
```

---

## ⌨️ Common Patterns

### Input + Label

```tsx
<ToolSection>
  <ToolLabel>Input Text</ToolLabel>
  <ToolHint>⌘V to paste</ToolHint>
  <Textarea
    value={input}
    onChange={(e) => setInput(e.target.value)}
    placeholder="Enter text..."
    className="font-mono text-sm"
  />
</ToolSection>
```

### Output + Copy Button

```tsx
<ToolSection>
  <ToolLabel>Output</ToolLabel>
  <div className="flex gap-2">
    <Textarea value={output} readOnly className="font-mono text-sm" />
    <Button
      onClick={() => copyToClipboard(output)}
      size="icon"
      variant="outline"
    >
      <Copy className="h-4 w-4" />
    </Button>
  </div>
</ToolSection>
```

### Horizontal Button Group

```tsx
<div className="tool-button-group">
  <Button onClick={...}>Action 1</Button>
  <Button onClick={...}>Action 2</Button>
</div>
```

### Section with Header

```tsx
<div className="space-y-3">
  <h3 className="text-sm font-semibold">Section Title</h3>
  <ToolSection>
    {/* Content */}
  </ToolSection>
</div>
```

---

## 🔧 Building a Tool

### Step 1: Structure

```tsx
<div className="tool-full-height">
  <div className="tool-scrollable tool-padding tool-spacer">
    {/* Your sections */}
  </div>
</div>
```

### Step 2: Add Sections

```tsx
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';

<ToolSection>
  <ToolLabel>Input</ToolLabel>
  <ToolHint>Your hint here</ToolHint>
  <Textarea ... />
</ToolSection>
```

### Step 3: Add Output

```tsx
<ToolSection>
  <ToolLabel>Output</ToolLabel>
  <Textarea value={output} readOnly />
</ToolSection>
```

### Step 4: Add Interactivity

```tsx
import { useQuickPaste, quickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { usePersistentState } from '@/hooks/usePersistentState';

export function MyTool() {
  const [input, setInput] = usePersistentState('devtool:my-tool:input', '');
  useQuickPaste(setInput);
  useInputHistory(input, setInput);
  // ...
}
```

---

## 🎯 Do's and Don'ts

### ✅ DO

- Use `ToolSection` for every input/output group
- Use `ToolLabel` for all field labels
- Use `ToolHint` for instructions/examples
- Use `tool-full-height` + `tool-scrollable` for layout
- Import components from `@/components/ui/tool-section`
- Use `quickPasteHint` in hints
- Apply `font-mono text-sm` to code/data textareas

### ❌ DON'T

- Don't create custom label divs (use `ToolLabel`)
- Don't use `text-[12px]` or other arbitrary sizes
- Don't apply random padding values
- Don't nest Card inside Card
- Don't use OS-native elements
- Don't apply `rounded-none` to containers
- Don't mix spacing systems (e.g., `space-y-3` + `mb-4`)

---

## 📱 Responsive Design

All utilities are responsive-first:

```css
/* Mobile first */
px-3 py-4

/* Tablet and up (640px+) */
sm:px-4 sm:py-5

/* Desktop (1024px+) */
lg:px-5
```

Test at these breakpoints:
- **Mobile:** 375px (iPhone SE)
- **Tablet:** 768px (iPad)
- **Desktop:** 1440px (standard monitor)

---

## 🌓 Dark Mode

All components automatically work in dark/light modes.

Verify:
1. Check Settings → theme toggle
2. Verify colors in both modes
3. Ensure sufficient contrast (WCAG AA)

---

## 🎨 Icon Sizing

Use consistent icon sizes:

```tsx
{/* In buttons and headers */}
<Copy className="h-4 w-4" />  {/* Standard */}

{/* In large UI elements */}
<Copy className="h-5 w-5" />  {/* Larger */}

{/* In tight spaces */}
<Copy className="h-3 w-3" />  {/* Smaller */}
```

---

## 📚 References

- **Full Redesign Docs:** `docs/ai/UI-UX-REDESIGN.md`
- **Main Guide:** `docs/ai/CLAUDE.md`
- **Component Source:** `src/components/ui/tool-section.tsx`
- **CSS Utilities:** `src/styles/globals.css`
- **Example Tools:** HashTool, TextCounter

---

## 💡 Tips

1. **Start with template:** Copy the standard template for new tools
2. **Use DevTools:** Browser DevTools (F12) to verify spacing
3. **Test responsive:** Resize browser to test mobile view
4. **Check colors:** Verify in both light + dark modes
5. **Quick reference:** Keep this doc open while building

---

**Last Updated:** 2026-06-22
**Version:** 1.0
