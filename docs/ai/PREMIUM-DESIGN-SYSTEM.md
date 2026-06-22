# Premium Design System - DevTool App

A comprehensive design system inspired by modern API tools (Bruno, Postman), Loopie, and Apple's design aesthetic. This system prioritizes clarity, simplicity, consistency, visual hierarchy, and accessibility.

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Color Palette](#color-palette)
3. [Typography System](#typography-system)
4. [Spacing & Rhythm](#spacing--rhythm)
5. [Border Radius](#border-radius)
6. [Shadow System](#shadow-system)
7. [Component Library](#component-library)
8. [Usage Guidelines](#usage-guidelines)
9. [Dark Mode](#dark-mode)
10. [Accessibility](#accessibility)

---

## Design Principles

### 1. **Clarity Over Decoration**
- Every visual element has a purpose
- Information hierarchy is immediately apparent
- Remove visual noise and clutter
- Prioritize content over chrome

### 2. **Simplicity & Familiarity**
- Use patterns from trusted tools (Bruno, Postman, Figma)
- Consistency across all pages
- Predictable interactions
- Minimal cognitive load

### 3. **Visual Hierarchy**
- Strong contrast between UI layers
- Clear primary/secondary information separation
- Proper use of size, weight, and color
- Scanning-friendly layouts

### 4. **Soft & Premium**
- Generous rounded corners (1rem) like Apple design
- Subtle shadows for depth without harshness
- Smooth transitions (150-200ms)
- Refined color palette with sophisticated grays

### 5. **Accessibility First**
- WCAG AA contrast minimum (4.5:1 for text)
- Keyboard navigation throughout
- Clear focus states
- Screen reader compatible

### 6. **Consistency & Balance**
- Aligned spacing (6px, 8px increments)
- Balanced whitespace
- Uniform component sizing
- Predictable behavior across tools

---

## Color Palette

### Light Mode

#### Primary Colors
```
Primary Blue:     hsl(207 100% 42%)  — Used for links, buttons, accents
Primary Text:     hsl(0 0% 8%)       — Maximum contrast on light backgrounds
Secondary Text:   hsl(0 0% 42%)      — Muted descriptions, helpers
```

#### Background Colors
```
Canvas:           hsl(0 0% 95%)      — Main background
Card/White:       hsl(0 0% 100%)     — Card backgrounds
Sidebar:          hsl(0 0% 92%)      — Sidebar background
Muted:            hsl(0 0% 92%)      — Hover states, secondary backgrounds
Input:            hsl(0 0% 96%)      — Input field backgrounds
```

#### Semantic Colors
```
Border:           hsl(0 0% 86%)      — Subtle separation lines
Destructive:      hsl(0 84% 52%)     — Error/delete actions
Success:          hsl(130 60% 50%)   — Confirmation, success states
Warning:          hsl(40 96% 50%)    — Warnings, cautions
Info:             hsl(207 100% 42%)  — Information, same as primary
```

### Dark Mode

#### Primary Colors
```
Primary Blue:     hsl(207 100% 52%)  — Maintains vibrancy in dark
Primary Text:     hsl(0 0% 92%)      — Good contrast on dark backgrounds
Secondary Text:   hsl(0 0% 58%)      — Dimmed text
```

#### Background Colors
```
Canvas:           hsl(0 0% 10%)      — Deep background
Card:             hsl(0 0% 14%)      — Card backgrounds
Sidebar:          hsl(0 0% 8%)       — Sidebar background
Muted:            hsl(0 0% 20%)      — Hover states
Input:            hsl(0 0% 18%)      — Input field backgrounds
```

#### Semantic Colors
```
Border:           hsl(0 0% 22%)      — Subtle separation in dark
Destructive:      hsl(0 80% 64%)     — More vibrant error state
Success:          hsl(130 60% 60%)   — Vibrant success
Warning:          hsl(40 96% 55%)    — Vibrant warning
Info:             hsl(207 100% 52%)  — Vibrant info
```

### Usage Guidelines

- **Primary Button:** Use `hsl(207 100% 42%)` for main actions
- **Hover State:** Reduce saturation or increase lightness by 2-3%
- **Disabled State:** Use `--muted` with reduced opacity
- **Borders:** Always use `--border` for subtle separation
- **Focus Rings:** Use `ring-2 ring-primary/20` for clear focus indicators

---

## Typography System

### Font Stack
```
system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text",
"Segoe UI", "Ubuntu", "Cantarell", "Noto Sans", "Helvetica Neue", Arial, sans-serif
```
This ensures native typography on each platform:
- macOS: San Francisco
- Windows: Segoe UI Variable
- Linux: Ubuntu/Cantarell

### Type Scale

| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| **Heading XL** | 1.25rem (20px) | 600 | 1.5 | -0.02em | Page titles |
| **Heading LG** | 1.125rem (18px) | 600 | 1.375 | -0.01em | Section headers |
| **Heading MD** | 1rem (16px) | 600 | 1.5 | 0 | Subsection headers |
| **Heading SM** | 0.875rem (14px) | 600 | 1.5 | 0 | Form labels, card headers |
| **Heading XS** | 0.75rem (12px) | 600 | 1.5 | 0.05em | Section labels (uppercase) |
| **Body** | 0.875rem (14px) | 400 | 1.625 | 0.3px | Regular content |
| **Body Small** | 0.8125rem (13px) | 400 | 1.5 | 0.3px | Helper text, captions |
| **Caption** | 0.75rem (12px) | 400 | 1.5 | 0.3px | Metadata, hints |

### CSS Classes

```css
.heading-xl    /* text-xl font-semibold leading-tight tracking-tight */
.heading-lg    /* text-lg font-semibold leading-snug tracking-tight */
.heading-md    /* text-base font-semibold leading-relaxed tracking-tight */
.heading-sm    /* text-sm font-semibold leading-relaxed */
.heading-xs    /* text-xs font-semibold uppercase tracking-wider */
.text-body     /* text-sm leading-relaxed */
.text-caption  /* text-xs leading-relaxed text-muted-foreground */
```

### Usage Guidelines

1. **Heading Hierarchy:** Use only `h1`, `h2`, `h3` for semantic HTML
2. **Font Weight:** Use 400 for body, 500 for emphasis, 600 for headers
3. **Line Height:** Larger text needs smaller line height (1.5), smaller text needs larger (1.625)
4. **Letter Spacing:** Add 0.3px to body for premium feel
5. **All Caps:** Only for small labels and metadata

---

## Spacing & Rhythm

### Base Unit
All spacing follows **4px base unit** with increments of 2px for fine adjustments.

### Spacing Scale

| Name | Value | Usage |
|------|-------|-------|
| **xs** | 0.5rem (8px) | Tight spacing |
| **sm** | 1rem (16px) | Comfortable spacing |
| **md** | 1.5rem (24px) | Section spacing |
| **lg** | 2rem (32px) | Major breaks |
| **xl** | 2.5rem (40px) | Significant gaps |

### Common Patterns

#### Button Padding
- Small: `px-3 py-1.5` (12×6px)
- Default: `px-4 py-2` (16×8px)
- Large: `px-5 py-2.5` (20×10px)

#### Input Padding
- Standard: `px-3 py-2` (12×8px) with height 36px (h-9)

#### Card Padding
- Responsive: `px-4 py-5 sm:px-5 sm:py-6 lg:px-6`
- Provides optimal readability on all screen sizes

#### Section Spacing
- Container: `space-y-6 sm:space-y-7` (24-28px between sections)
- Element: `space-y-2.5 sm:space-y-3` (10-12px between elements)

### Responsive Breakpoints

```
xs: 0px (mobile)
sm: 640px (tablet)
md: 768px (small desktop)
lg: 1024px (desktop)
xl: 1280px (large desktop)
```

---

## Border Radius

### Radius Scale

```
--radius: 1rem (16px)  — Default, used everywhere
```

### Application

| Component | Radius | CSS Class |
|-----------|--------|-----------|
| Cards | 1rem | `rounded-lg` |
| Inputs | 1rem | `rounded-lg` |
| Buttons | 1rem | `rounded-lg` |
| Tabs | varies | `rounded-t-lg` (top) |
| Badges | 9999px | `rounded-full` |
| Small elements | 0.375rem | `rounded-sm` |

### Why Large Radius?

- **Apple-like aesthetic:** Modern, approachable, premium feel
- **Soft appearance:** Reduces visual harshness
- **Modern standard:** API tools use similar radius values
- **Consistency:** Single value across all components

---

## Shadow System

Premium shadow system with multiple layers for depth and sophistication.

### Shadow Definitions

```css
--shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
```

### Usage

| Shadow | Component | Purpose |
|--------|-----------|---------|
| **xs** | Small interactive elements | Minimal depth |
| **sm** | Cards, inputs, buttons | Default elevation |
| **md** | Elevated cards, hover states | Medium elevation |
| **lg** | Modals, dropdowns, active states | High elevation |
| **xl** | Fullscreen overlays, important modals | Maximum elevation |

### CSS Classes

```css
.shadow-sm-premium   /* Use for default cards and components */
.shadow-md-premium   /* Use on hover for interactive elevation */
.shadow-lg-premium   /* Use for modals and important overlays */
.shadow-xl-premium   /* Use for critical modals and dialogs */
```

### Transition

All shadows transition smoothly on hover:
```css
transition: background-color 0.2s ease, box-shadow 0.2s ease;
```

---

## Component Library

### Premium Components

#### PremiumCard
Flexible card container with shadow system.

```tsx
<PremiumCard>
  <div className="p-4">Card content</div>
</PremiumCard>
```

Options:
- `elevated`: Applies `shadow-lg` instead of `shadow-sm`

#### PremiumContainer
Sophisticated container with backdrop blur.

```tsx
<PremiumContainer>
  Tool configuration section
</PremiumContainer>
```

#### PremiumSection
Grouped content with consistent spacing.

```tsx
<PremiumSection>
  {/* Child elements get space-y-3 */}
</PremiumSection>
```

#### PremiumLabel
Enhanced form label with proper hierarchy.

```tsx
<PremiumLabel>Email Address</PremiumLabel>
```

#### PremiumHint
Helper text for form inputs.

```tsx
<PremiumHint>Use a valid email address</PremiumHint>
```

#### PremiumBadge
Pill-shaped badge for status/metadata.

```tsx
<PremiumBadge variant="primary">Active</PremiumBadge>
<PremiumBadge variant="destructive">Error</PremiumBadge>
```

#### PremiumStatCard
Display statistic with label and value.

```tsx
<PremiumStatCard 
  label="Total Requests" 
  value={1234}
  color="text-blue-600"
/>
```

#### PremiumInputGroup
Container for label + input.

```tsx
<PremiumInputGroup>
  <PremiumLabel>Username</PremiumLabel>
  <Input placeholder="Enter username" />
</PremiumInputGroup>
```

#### PremiumOutputGroup
Container for label + output with divider.

```tsx
<PremiumOutputGroup>
  <PremiumLabel>Result</PremiumLabel>
  <Input value={result} readOnly />
</PremiumOutputGroup>
```

#### PremiumContentWrapper
Scrollable content area with padding and spacing.

```tsx
<PremiumContentWrapper>
  {/* Content is scrollable with proper padding */}
</PremiumContentWrapper>
```

#### PremiumGrid
Responsive grid for cards.

```tsx
<PremiumGrid cols={4}>
  <PremiumStatCard ... />
  <PremiumStatCard ... />
  {/* auto-responsive to 2 cols on mobile */}
</PremiumGrid>
```

### Utility Classes

```css
.card-premium              /* Premium card with shadow and border */
.card-interactive          /* Card with hover elevation */
.container-premium         /* Sophisticated container */
.input-premium             /* Enhanced input field */
.textarea-premium          /* Enhanced textarea */
.btn-premium               /* Base premium button */
.btn-primary-premium       /* Primary action button */
.btn-secondary-premium     /* Secondary button */
.btn-ghost-premium         /* Ghost button */
.split-pane                /* Two-column layout */
.tab-premium               /* Tab navigation item */
.badge-premium             /* Pill-shaped badge */
```

---

## Usage Guidelines

### Layout Structure

```tsx
// Typical tool layout
<div className="tool-full-height">
  <PremiumContentWrapper>
    <PremiumSection>
      <PremiumHeader level="md">Configuration</PremiumHeader>
      <PremiumInputGroup>
        <PremiumLabel>API Key</PremiumLabel>
        <Input className="input-premium" />
      </PremiumInputGroup>
    </PremiumSection>

    <PremiumSection>
      <PremiumHeader level="md">Results</PremiumHeader>
      <PremiumGrid cols={4}>
        <PremiumStatCard label="Requests" value={100} />
        {/* More stats */}
      </PremiumGrid>
    </PremiumSection>
  </PremiumContentWrapper>
</div>
```

### Button Usage

```tsx
// Primary action
<button className="btn-primary-premium">Send Request</button>

// Secondary action
<button className="btn-secondary-premium">Cancel</button>

// Ghost (minimal)
<button className="btn-ghost-premium">Learn more</button>
```

### Form Patterns

```tsx
// Consistent form sections
<PremiumContainer>
  <PremiumSection>
    <PremiumHeader level="sm">Headers</PremiumHeader>
    {/* Header fields */}
  </PremiumSection>
  
  <PremiumDivider />
  
  <PremiumSection>
    <PremiumHeader level="sm">Query Parameters</PremiumHeader>
    {/* Query fields */}
  </PremiumSection>
</PremiumContainer>
```

### Status & Metadata

```tsx
// Use badges for status
<div className="flex items-center gap-2">
  <PremiumBadge variant="primary">Active</PremiumBadge>
  <PremiumHint>Updated 2 minutes ago</PremiumHint>
</div>
```

---

## Dark Mode

### Color Behavior

- **Foreground:** Increases from 8% to 92% (much lighter)
- **Background:** Decreases from 95% to 10% (much darker)
- **Borders:** Adjusted for visibility against dark backgrounds
- **Shadows:** Stronger (higher opacity) to show depth

### Testing Dark Mode

```bash
# In browser console:
document.documentElement.classList.add('dark')
document.documentElement.classList.remove('dark')
```

### Guidelines

1. **Maintain Contrast:** Text on background ≥ 4.5:1
2. **Preserve Hierarchy:** Use opacity effectively (100%, 80%, 60%, 40%)
3. **Reduce Brightness:** Avoid pure white text on dark backgrounds
4. **Blue Light:** Primary blue remains vibrant to maintain focus

---

## Accessibility

### WCAG AA Compliance

All colors meet WCAG AA standards:
- **Text/Background:** Minimum 4.5:1 contrast
- **Large Text (18pt+):** Minimum 3:1 contrast

### Interactive Elements

- **Focus State:** `ring-2 ring-primary/30 ring-offset-1`
- **Hover State:** Color shift, shadow elevation, or opacity change
- **Disabled State:** Reduced opacity (50-60%)

### Keyboard Navigation

- **Tab Order:** Logical, predictable
- **Focus Visible:** Always visible on keyboard focus
- **Escape:** Closes overlays and modals
- **Enter:** Confirms actions

### Screen Readers

- **ARIA Labels:** Used for unlabeled buttons and icons
- **Semantic HTML:** Proper heading hierarchy
- **Live Regions:** Status updates announced
- **Skip Links:** Navigate to main content

---

## Migration Checklist

### Phase 1: Foundation ✅
- [x] Enhanced color palette in CSS
- [x] Premium shadow system
- [x] Larger border radius (1rem)
- [x] Premium component library

### Phase 2: Key Components
- [ ] Update Sidebar styling
- [ ] Update Header/Toolbar
- [ ] Update Button components
- [ ] Update Form inputs

### Phase 3: Tools
- [ ] Refactor API Client (priority)
- [ ] Refactor JSON Formatter
- [ ] Refactor Text tools
- [ ] Update remaining tools

### Phase 4: Polish
- [ ] Animations and transitions
- [ ] Micro-interactions
- [ ] Dark mode testing
- [ ] Cross-browser verification

---

## Component Examples

### API Request Tool
```tsx
<div className="tool-full-height">
  <div className="header-premium border-b p-4">
    <PremiumHeader>API Request</PremiumHeader>
  </div>
  
  <PremiumContentWrapper>
    <PremiumSection>
      <div className="flex gap-2">
        <select className="input-premium">
          <option>GET</option>
          <option>POST</option>
        </select>
        <input className="input-premium flex-1" placeholder="URL" />
        <button className="btn-primary-premium">Send</button>
      </div>
    </PremiumSection>
  </PremiumContentWrapper>
</div>
```

### Status Display
```tsx
<PremiumGrid cols={4}>
  <PremiumStatCard 
    label="Status Code"
    value="200"
    color="text-green-600"
  />
  <PremiumStatCard 
    label="Response Time"
    value="234ms"
    color="text-blue-600"
  />
</PremiumGrid>
```

---

## Reference Material

### Inspiration
- **Bruno API Tool:** Clean, modern design with excellent hierarchy
- **Postman:** Professional, organized interface
- **Loopie:** Soft, friendly design with generous rounded corners
- **Apple Design System:** Minimalist, premium aesthetic

### Resources
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Material Design System](https://material.io/design)
- [Tailwind CSS](https://tailwindcss.com/)

---

## Changelog

### v1.0 - Initial Premium Design System
- Increased border radius to 1rem
- Enhanced color palette (premium grays)
- Added premium shadow system
- Created component library (15+ components)
- Comprehensive documentation

---

## Questions?

Refer to:
- **Component Examples:** See tool implementations
- **CSS Variables:** Defined in `src/styles/globals.css`
- **Component API:** Defined in `src/components/ui/premium.tsx`
- **Migration Guide:** See "Migration Checklist" section above
