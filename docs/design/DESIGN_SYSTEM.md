# DevTool Premium Design System

## Overview

DevTool uses a premium, Apple-inspired design system built on shadcn/ui, Tailwind CSS, and custom CSS variables. The design emphasizes clarity, consistency, visual hierarchy, and immersive micro-interactions.

### Design Pillars
- **Minimalist**: Remove every element not serving the user's task
- **Clear Visual Hierarchy**: Guide users to primary actions through size, color, and weight
- **Smooth & Seamless**: Transitions and animations enhance, never distract
- **User-Centric**: Every interaction provides immediate, meaningful feedback
- **Familiar**: Patterns borrowed from Bruno, Postman, and Apple HIG

---

## Color System

### Light Mode
```css
--background: 0 0% 90%;      /* Dim canvas, reduces eye strain */
--card: 0 0% 97%;            /* Bright, lifted surfaces */
--foreground: 0 0% 0%;       /* Pure black for max contrast */
--muted-foreground: 0 0% 24%;  /* Dark secondary text */
--border: 0 0% 79%;          /* Visible dividers */
--primary: 207 100% 40%;     /* Action blue */
--accent: 207 100% 38%;      /* Accent highlights */
--destructive: 12 82% 34%;   /* Danger red */
```

### Dark Mode
```css
--background: 0 0% 12%;      /* Deep, non-glare background */
--card: 0 0% 15%;            /* Subtle lift above canvas */
--foreground: 0 0% 80%;      /* Off-white for readability */
--muted-foreground: 0 0% 52%;  /* Muted secondary text */
--border: 0 0% 24%;          /* Visible dividers */
--primary: 207 100% 40%;     /* Consistent action blue */
```

### Semantic Color Usage

| Color | Usage | Examples |
|-------|-------|----------|
| Primary Blue | Actions, links, focus | Buttons, active states, links |
| Green/Emerald | Success, valid states | Checkmarks, valid badges, success messages |
| Amber/Orange | Warnings, attention | Warning badges, highlighted matches |
| Red/Rose | Destructive, errors | Delete buttons, error messages |
| Sky/Cyan | Information, types | Type hints, code keywords |
| Muted Gray | Secondary, inactive | Disabled buttons, helper text |

---

## Typography

### Type Scales
- **Headings**: Bold, strong visual impact
  - `heading-xl`: 20px bold (page titles)
  - `heading-lg`: 18px bold (section headers)
  - `heading-md`: 16px bold (subsection headers)
  - `heading-sm`: 14px bold (small headers)
  - `heading-xs`: 12px bold (mini headers)

- **Body**: Clear, readable
  - `text-body`: 14px regular (main content)
  - `text-sm`: 13px regular (body text)
  - `text-xs`: 12px regular (captions)

- **Mono**: Technical, precise
  - `font-mono text-sm`: Code, paths, formatted output
  - `font-mono text-xs`: Small code snippets

### Font Stack
```
system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text",
"Segoe UI", "Ubuntu", "Cantarell", "Noto Sans", sans-serif
```
Prioritizes native system fonts for each OS (SF Pro → Segoe UI → Ubuntu).

---

## Component Patterns

### Button Hierarchy

**Primary Button** — Main action
```tsx
<Button className="bg-primary text-primary-foreground">
  Action
</Button>
```
- Full contrast
- Used for primary actions (Save, Send, Create)
- Blue background, white text

**Secondary Button** — Alternative action
```tsx
<Button variant="outline">
  Alternative
</Button>
```
- Bordered, lower visual weight
- Used for secondary choices
- Gray border, foreground text

**Ghost Button** — Tertiary/subtle action
```tsx
<Button variant="ghost">
  Subtle
</Button>
```
- No border, text-only
- Used for undo, cancel, or repeated actions
- Hover adds subtle background

### Segment Controls (Tab-like selector)
```tsx
<div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
  {options.map(opt => (
    <button
      className={cn(
        'rounded px-3 text-xs font-medium transition-colors',
        active 
          ? 'bg-card text-foreground shadow-sm-premium' 
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {opt.label}
    </button>
  ))}
</div>
```
- Unified control for mutually exclusive options
- Height: `h-8` (32px) for desktop
- Rounded corners: `rounded-lg` (0.5rem)
- Active state: Filled background + subtle shadow

### Input Fields
```tsx
<Input
  className="rounded-lg border-border h-8 px-3 text-xs"
  placeholder="Search..."
/>
```
- Consistent height: `h-8` (32px)
- Rounded corners: `rounded-lg`
- Border uses CSS variable: `border-border`
- Focus state: Primary color ring

### Cards & Containers
```tsx
<div className="rounded-lg border border-border bg-card/30">
  {content}
</div>
```
- Rounded corners: `rounded-lg` (0.5rem)
- Border: 1px using `border-border` CSS variable
- Subtle background: `bg-card/30` or `bg-muted/10`

### Pane Headers
All pane/panel headers use consistent styling:
```tsx
<div className="border-b border-border bg-muted/10 px-4 py-2 text-xs">
  {heading}
</div>
```
- Subtle background: `bg-muted/10`
- Border divider: `border-b border-border`
- Consistent padding: `px-4 py-2`
- Text: `text-xs` (12px), medium weight

---

## Shadow System

Subtle, layered shadows create depth without distraction.

```css
--shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
--shadow-sm-premium: 0 2px 8px rgba(0, 0, 0, 0.12);
```

- **shadow-sm-premium**: Active buttons, lifted controls (2px, 8px blur)
- **shadow-md**: Modals, dropdowns (4px, 6px blur)
- **shadow-lg**: Prominent overlays

---

## Spacing & Layout

### Tool Container
```tsx
<div className="tool-full-height">
  <div className="tool-scrollable tool-padding tool-spacer">
    {/* sections */}
  </div>
</div>
```

- `tool-full-height`: Full viewport height, flex column, overflow hidden
- `tool-scrollable`: Flex-1, min-h-0, overflow-y-auto
- `tool-padding`: Responsive padding (px-3 py-4 on mobile → px-5 py-5 on desktop)
- `tool-spacer`: Consistent section spacing (space-y-5 sm:space-y-6)

### Responsive Padding
```
Mobile (< 640px):  px-3 py-4
Tablet (≥ 640px):  px-4 py-5
Desktop (≥ 1024px): px-5
```

### Grid Gaps
- Between inline elements: `gap-2` (8px)
- Between sections: `gap-3` (12px)
- Between major sections: `space-y-5 sm:space-y-6` (20px → 24px)

---

## Micro-Interactions & Animation

### Transitions
All interactive elements use smooth CSS transitions (150-200ms):

```css
transition-colors /* color changes (hover, active) */
transition-opacity /* fade in/out */
transition-transform /* scale, move */
transition-all /* combined effects */
```

### Button Hover/Active States
```tsx
className={cn(
  'transition-colors',
  'hover:bg-primary/90 hover:text-primary-foreground',
  'active:bg-primary/80'
)}
```

### Loading Indicators
```tsx
<Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
```
- Spinner stops animation on `prefers-reduced-motion`
- Subtle color: `text-muted-foreground/60`
- Medium size: `h-5 w-5`

### Feedback Animations
- **Copy Success**: Icon change + color shift (green check)
- **Error**: Shake animation + red highlight
- **Toggle**: Smooth color + shadow transition

### Reduced Motion Compliance
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
All animations neutralized for accessibility.

---

## Empty States

### Guidance
When a tool is empty or waiting for input:

```tsx
<div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground px-8 gap-3">
  <Icon className="h-12 w-12 text-muted-foreground/30" />
  <p className="text-sm">{primaryMessage}</p>
  {secondaryAction && (
    <Button variant="outline" size="sm">
      {secondaryAction}
    </Button>
  )}
</div>
```

- Large icon (h-12 w-12) with muted color
- Clear call-to-action text
- Optional secondary button for guidance

### Error States
```tsx
<div className="rounded-lg border border-destructive/20 bg-destructive/8 p-4">
  <div className="flex gap-3">
    <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
    <div className="text-sm text-destructive">{errorMessage}</div>
  </div>
</div>
```
- Destructive color scheme: Red border + light red background
- Icon + message layout
- Rounded corners, consistent with other cards

---

## Scrollbar Styling

Custom, consistent scrollbar across all platforms:

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background-color: hsl(var(--muted-foreground) / 0.25);
  border-radius: 9999px;
  border: 2px solid transparent;
  transition: background-color 0.15s ease;
}
::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--muted-foreground) / 0.5);
}
```

- Thin (4px visual width in 8px hit area)
- Rounded pill shape
- Subtle gray, interactive on hover
- Consistent across macOS, Windows, Linux

---

## Toolbar Pattern

All tool headers use the premium toolbar pattern:

```tsx
<div className="shrink-0 border-b border-border bg-muted/10 px-4 py-2">
  <div className="flex flex-wrap items-center gap-3">
    {/* Mode toggle / segment controls */}
    <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
      {/* options */}
    </div>
    
    {/* Selects, inputs */}
    <Select>{/* ... */}</Select>
    
    {/* Primary action (right-aligned) */}
    <Button className="ml-auto">{/* ... */}</Button>
  </div>
</div>
```

- Subtle background: `bg-muted/10`
- Bottom border: `border-b border-border`
- Flex wrap for responsive layout
- Consistent gap: `gap-3` (12px)

---

## Accessibility

### Keyboard Navigation
- All interactive elements (buttons, inputs, tabs) are keyboard-accessible
- Tab order follows visual flow (left-to-right, top-to-bottom)
- Focus rings use primary color

### Screen Readers
- Semantic HTML: `<button>`, `<input>`, `<label>` tags
- ARIA labels for icon-only buttons: `aria-label="Copy"`
- Status messages for async operations: `role="status"`

### Contrast
- Primary text: WCAG AA (4.5:1 on light background)
- Secondary text (muted): WCAG AA on all backgrounds
- Buttons: High contrast between button and background

### Motion
- All animations respect `prefers-reduced-motion`
- No auto-playing, distracting animations
- User-triggered micro-interactions only

---

## Implementation Checklist

When building or updating a tool:

- [ ] Use standardized button hierarchy (primary, secondary, ghost)
- [ ] Apply toolbar pattern to headers
- [ ] Use segment controls for mode/option toggles
- [ ] All borders use `border-border` CSS variable
- [ ] Pane headers use `bg-muted/10 border-b border-border` pattern
- [ ] Input/select height: `h-8` (32px)
- [ ] Apply `tool-full-height`, `tool-scrollable`, `tool-padding` utilities
- [ ] Include empty state with icon and guidance
- [ ] Error states use `bg-destructive/8 border-destructive/20`
- [ ] Copy/action buttons provide visual feedback
- [ ] Responsive padding: px-3 on mobile, px-4-5 on desktop
- [ ] All text uses semantic type scales
- [ ] Transitions smooth (150-200ms) on hover/active
- [ ] Focus rings visible (primary color)
- [ ] Scrollbar uses global custom style (no inline tweaks)
- [ ] Dark mode colors tested and verified

---

## Quick Reference: CSS Utilities

```tsx
/* Full-height tool */
<div className="tool-full-height">
  <div className="tool-scrollable tool-padding tool-spacer">
    {/* content */}
  </div>
</div>

/* Toolbar header */
<div className="shrink-0 border-b border-border bg-muted/10 px-4 py-2">
  {/* controls */}
</div>

/* Pane header */
<div className="border-b border-border bg-muted/10 text-xs">
  {/* heading */}
</div>

/* Segment control */
<div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
  {/* options */}
</div>

/* Card / container */
<div className="rounded-lg border border-border bg-card">
  {/* content */}
</div>

/* Error state */
<div className="rounded-lg border border-destructive/20 bg-destructive/8">
  {/* error message */}
</div>

/* Empty state */
<div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
  <Icon className="h-12 w-12 text-muted-foreground/30" />
  <p className="text-sm">{message}</p>
</div>
```

---

## File Organization

- **globals.css**: Color variables, base styles, scrollbar, utilities
- **components/ui/**: shadcn/ui base components (Button, Input, Select, etc.)
- **components/tools/**: Tool implementations using design system
- **docs/design/**: Design documentation (this file)

---

## Version
- **Updated**: 2026-06-22
- **System**: Premium Design System v1.0
- **Alignment**: Apple HIG + Bruno/Postman patterns
- **Foundation**: Tailwind CSS + shadcn/ui + Custom CSS Variables
