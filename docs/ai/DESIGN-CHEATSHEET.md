# Premium Design System - Quick Cheatsheet

Fast reference for the most common design patterns and components.

---

## Import Everything You Need

```tsx
import {
  PremiumCard,
  PremiumContainer,
  PremiumSection,
  PremiumLabel,
  PremiumHint,
  PremiumHeader,
  PremiumContentWrapper,
  PremiumGrid,
  PremiumStatCard,
  PremiumInputGroup,
  PremiumOutputGroup,
  PremiumBadge,
  PremiumTab,
  PremiumActionGroup,
} from '@/components/ui/premium';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
```

---

## Most Common Patterns

### 1. Simple Tool Layout
```tsx
<div className="tool-full-height">
  <PremiumContentWrapper>
    <PremiumInputGroup>
      <PremiumLabel>Input</PremiumLabel>
      <Textarea placeholder="..." className="textarea-premium" />
    </PremiumInputGroup>

    <PremiumOutputGroup>
      <PremiumLabel>Output</PremiumLabel>
      <Textarea readOnly value={output} className="textarea-premium" />
    </PremiumOutputGroup>
  </PremiumContentWrapper>
</div>
```

### 2. Stats Grid
```tsx
<PremiumGrid cols={4}>
  <PremiumStatCard label="Stat 1" value={100} color="text-blue-600" />
  <PremiumStatCard label="Stat 2" value={200} color="text-green-600" />
  <PremiumStatCard label="Stat 3" value={300} color="text-purple-600" />
  <PremiumStatCard label="Stat 4" value={400} color="text-orange-600" />
</PremiumGrid>
```

### 3. Form Section
```tsx
<PremiumSection>
  <PremiumHeader level="md">Configuration</PremiumHeader>
  
  <PremiumInputGroup>
    <PremiumLabel>Field Name</PremiumLabel>
    <Input className="input-premium" placeholder="..." />
    <PremiumHint>Helper text explaining the field</PremiumHint>
  </PremiumInputGroup>
</PremiumSection>
```

### 4. Buttons
```tsx
<PremiumActionGroup>
  <button className="btn-primary-premium">Primary Action</button>
  <button className="btn-secondary-premium">Secondary Action</button>
  <button className="btn-ghost-premium">Tertiary Action</button>
</PremiumActionGroup>
```

### 5. Tabs
```tsx
<div className="flex gap-0.5 border-b border-border">
  <PremiumTab isActive={tab === 'headers'} onClick={() => setTab('headers')}>
    Headers
  </PremiumTab>
  <PremiumTab isActive={tab === 'body'} onClick={() => setTab('body')}>
    Body
  </PremiumTab>
</div>
```

---

## CSS Utility Classes

### Padding & Spacing
```
.tool-padding           /* Responsive padding: px-4 py-5 sm:px-5 sm:py-6 lg:px-6 */
.tool-spacer            /* Space between sections: space-y-6 sm:space-y-7 */
.tool-button-group      /* Button spacing: flex gap-2.5 */
```

### Full-Height Container
```
.tool-full-height       /* h-full overflow-hidden flex flex-col */
.tool-scrollable        /* flex-1 min-h-0 overflow-y-auto */
```

### Cards & Containers
```
.card-premium           /* Rounded card with shadow and border */
.card-interactive       /* Card that elevates on hover */
.container-premium      /* Sophisticated container with backdrop blur */
.split-pane             /* Two-column flex layout: flex gap-4 h-full */
```

### Forms
```
.input-premium          /* Enhanced input with focus states */
.textarea-premium       /* Enhanced textarea */
.btn-premium            /* Base button with transitions */
.btn-primary-premium    /* Primary action button */
.btn-secondary-premium  /* Secondary button */
.btn-ghost-premium      /* Minimal button */
```

### Layouts
```
.header-premium         /* Toolbar header styling */
.sidebar-premium        /* Sidebar styling */
.content-wrapper        /* Max-width container */
```

### Shadows
```
.shadow-sm-premium      /* Default shadow */
.shadow-md-premium      /* Hover/elevated shadow */
.shadow-lg-premium      /* Modal shadow */
.shadow-xl-premium      /* Full-screen shadow */
```

---

## Color Palette Quick Reference

### Light Mode
| Color | CSS Variable | Usage |
|-------|--------------|-------|
| Background | `hsl(var(--background))` | Canvas |
| Foreground | `hsl(var(--foreground))` | Primary text |
| Muted | `hsl(var(--muted))` | Secondary backgrounds |
| Muted Foreground | `hsl(var(--muted-foreground))` | Secondary text |
| Primary | `hsl(var(--primary))` | Links, buttons |
| Border | `hsl(var(--border))` | Separator lines |

### Dark Mode
Same CSS variables, automatically adjusted for dark theme.

### Usage
```tsx
// Text colors
className="text-foreground"                /* Primary text */
className="text-muted-foreground"          /* Secondary text */

// Backgrounds
className="bg-card"                        /* Card backgrounds */
className="bg-muted"                       /* Secondary bg */

// Borders
className="border border-border"           /* Use always */

// Custom colors (Tailwind)
className="text-blue-600 dark:text-blue-400"
className="bg-green-600/10"                /* With opacity */
```

---

## Typography Classes

### Headings
```
.heading-xl             /* Page titles */
.heading-lg             /* Section headers */
.heading-md             /* Subsection headers */
.heading-sm             /* Form labels */
.heading-xs             /* Section labels (uppercase) */
```

### Body Text
```
.text-body              /* Regular content */
.text-caption           /* Helper text, metadata */
```

### In Components
```tsx
<PremiumHeader level="lg">Big Header</PremiumHeader>
<PremiumHeader level="md">Medium Header</PremiumHeader>
<PremiumHeader level="sm">Small Header</PremiumHeader>
<PremiumLabel>Form Label</PremiumLabel>
<PremiumHint>Helper text</PremiumHint>
```

---

## Responsive Patterns

### Tailwind Breakpoints
```
sm:   640px    (tablet)
md:   768px    (small desktop)
lg:   1024px   (desktop)
xl:   1280px   (large desktop)
```

### Common Usage
```tsx
<div className="px-4 py-5 sm:px-5 sm:py-6 lg:px-6">
  Responsive padding (mobile → tablet → desktop)
</div>

<PremiumGrid cols={4}>
  {/* 2 cols on mobile, 4 cols on desktop */}
</PremiumGrid>

<div className="text-xs sm:text-sm lg:text-base">
  Responsive font size
</div>
```

---

## Spacing Scale

```
space-y-2       /* 8px gap */
space-y-2.5     /* 10px gap */
space-y-3       /* 12px gap */
space-y-4       /* 16px gap */
space-y-5       /* 20px gap */
space-y-6       /* 24px gap */
space-y-7       /* 28px gap */
```

---

## Border Radius

Always use `rounded-lg` (1rem/16px) for consistency.

```tsx
// Components
className="rounded-lg"          /* Cards, inputs, buttons */
className="rounded-full"        /* Badges, pills */
className="rounded-t-lg"        /* Tab tops */
className="rounded-sm"          /* Small elements (rare) */
```

---

## Animations

### Fade In
```tsx
className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
```

### Scale In
```tsx
className="motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200"
```

### Slide In
```tsx
className="motion-safe:animate-in motion-safe:slide-in-from-left-1 motion-safe:duration-200"
```

### Custom Animation
```tsx
className="animate-fade-in-up"  /* Fade + slide up */
className="animate-scale-in"    /* Scale + fade */
```

---

## Focus & Interaction States

### Focus Ring
```tsx
className="focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1"
```

### Hover
```tsx
className="hover:bg-muted/70 hover:shadow-md-premium"
```

### Active
```tsx
className="active:scale-95 active:shadow-sm-premium"
```

### Disabled
```tsx
className="disabled:opacity-50 disabled:cursor-not-allowed"
```

---

## Component API Quick Ref

```tsx
/* Card Components */
<PremiumCard>                       /* Basic card */
<PremiumCard elevated>              /* Elevated with lg shadow */
<PremiumContainer>                  /* Card with backdrop blur */

/* Typography */
<PremiumLabel>Text</PremiumLabel>
<PremiumHint>Text</PremiumHint>
<PremiumHeader level="md">Text</PremiumHeader>

/* Grouping */
<PremiumSection>                    /* space-y-3 */
<PremiumInputGroup>                 /* space-y-2.5 */
<PremiumOutputGroup>                /* with border divider */
<PremiumActionGroup>                /* flex gap-2.5 */

/* Display */
<PremiumStatCard 
  label="Name" 
  value={123}
  color="text-blue-600"
/>

<PremiumBadge variant="primary">Text</PremiumBadge>
<PremiumBadge variant="destructive">Text</PremiumBadge>

/* Layout */
<PremiumGrid cols={4}>              /* 2 on mobile, 4 on desktop */
<PremiumTab isActive={bool}>
<PremiumDivider />

/* Wrappers */
<PremiumContentWrapper>             /* Scrollable with padding */
```

---

## Dark Mode Testing

In browser DevTools console:
```js
// Enable dark mode
document.documentElement.classList.add('dark')

// Disable dark mode
document.documentElement.classList.remove('dark')

// Toggle
document.documentElement.classList.toggle('dark')
```

---

## Do's and Don'ts

### ✅ DO

- Use `rounded-lg` consistently
- Use semantic HTML (`<label>`, `<button>`, etc.)
- Use CSS classes, avoid inline styles
- Keep spacing to multiples of 4px
- Test in both light and dark modes
- Use `motion-safe:` for animations
- Import components from `@/components/ui/premium`

### ❌ DON'T

- Use `rounded-md` or `rounded-xl`
- Mix old and new component libraries
- Use `rounded` without specifying size
- Hardcode colors, use CSS variables
- Add `!important` flags
- Remove focus/hover states
- Use bare `<div>` when premium components exist

---

## Common Mistakes

### ❌ Wrong
```tsx
<div className="rounded-md shadow-lg p-4">
  <label className="text-sm font-medium">Field</label>
  <input className="border p-2" />
</div>
```

### ✅ Correct
```tsx
<PremiumCard>
  <PremiumInputGroup>
    <PremiumLabel>Field</PremiumLabel>
    <Input className="input-premium" />
  </PremiumInputGroup>
</PremiumCard>
```

---

## File Locations

| File | Purpose |
|------|---------|
| `src/styles/globals.css` | CSS variables, utilities, shadows |
| `src/components/ui/premium.tsx` | Premium components |
| `docs/ai/PREMIUM-DESIGN-SYSTEM.md` | Complete specification |
| `docs/ai/PREMIUM-MIGRATION-GUIDE.md` | Migration instructions |
| `docs/ai/DESIGN-CHEATSHEET.md` | This file (quick ref) |

---

## TL;DR - The Essentials

```tsx
// 1. Use premium components
import { PremiumCard, PremiumSection, PremiumLabel, ... } from '@/components/ui/premium';

// 2. Wrap tool with full height
<div className="tool-full-height">

// 3. Use PremiumContentWrapper for scrollable content
<PremiumContentWrapper>

// 4. Use PremiumInputGroup for inputs, PremiumOutputGroup for outputs
<PremiumInputGroup>
  <PremiumLabel>...</PremiumLabel>
  <Input className="input-premium" />
</PremiumInputGroup>

// 5. Use CSS classes for styling
className="rounded-lg shadow-sm-premium"

// 6. Always use border-border
className="border border-border"

// 7. Use text-foreground and text-muted-foreground for text
className="text-foreground"  // Primary
className="text-muted-foreground"  // Secondary

// 8. Test in dark mode
// In browser: document.documentElement.classList.add('dark')
```

---

That's it! Bookmark this page for quick reference. 📌
