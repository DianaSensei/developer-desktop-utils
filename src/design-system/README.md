# DevTool Design System

A small, portable design system: **azure-blue accent · soft-depth elevation ·
Apple-style frosted glass · Inter type · one motion rhythm**, all driven by CSS
variables so theming and dark mode are free.

## What's in here

| File | Purpose |
|---|---|
| `tokens.css` | Design tokens (`:root` / `.dark`), base resets, cross-platform scrollbar, and every design-system utility class (glass, soft-depth shadows, motion micro-interactions, premium card/typography/chrome). |
| `tailwind-preset.cjs` | Tailwind theme: token-mapped colors, radius, cross-platform shadow scale, Inter font stack, easing + keyframes, dark mode, `tailwindcss-animate`. |
| `index.ts` | One import surface for all React primitives + `cn`. |

> Components themselves live in `src/components/ui/` (shadcn-style, Radix-based)
> and are re-exported by `index.ts`. To lift the whole system into another
> project, copy `src/design-system/` **and** `src/components/ui/` (plus
> `src/lib/utils.ts` for `cn`).

## Reuse in another project

1. **Copy** `src/design-system/` (and `src/components/ui/`, `src/lib/utils.ts`).
2. **CSS** — at the very top of your global stylesheet, before the `@tailwind`
   directives (Vite inlines the import so Tailwind processes the layers):

   ```css
   @import "../design-system/tokens.css";
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

3. **Tailwind** — consume the preset:

   ```js
   // tailwind.config.js
   module.exports = {
     presets: [require('./src/design-system/tailwind-preset.cjs')],
     content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
   };
   ```

4. **Font** — install + import Inter once (e.g. in your entry file):

   ```ts
   import '@fontsource-variable/inter';
   ```

5. **Use it**:

   ```tsx
   import { Button, Card, Segmented, ToolToolbar, PaneHeader, cn } from '@/design-system';
   ```

## Token reference (set via CSS variables in `tokens.css`)

- **Surfaces**: `--background`, `--sidebar`, `--card`, `--popover`, `--elevated`
- **Text**: `--foreground`, `--muted-foreground`
- **Accent**: `--primary`, `--accent`, `--ring`, `--accent-glow` (HSL components)
- **Lines/fields**: `--border`, `--input`, `--secondary`, `--muted`
- **Status**: `--destructive`
- **Shape**: `--radius` (1rem)
- **Elevation**: `--shadow-xs … --shadow-2xl`
- **Motion**: `--ease-out-soft`, `--ease-spring`, `--dur-fast|base|slow`
- **Editor syntax**: `--sql-*`, `--js-*`

## Utility classes

- **Glass**: `.glass`, `.glass-strong`, `.glass-chrome`, `.glass-sheen`
- **Elevation**: `.shadow-sm-premium … .shadow-2xl-premium`, `.shadow-primary`, `.shadow-primary-lg`
- **Motion**: `.hover-elevate`, `.press`, `.accent-glow`, `.accent-glow-soft`, `.animate-pop`, `.animate-fade-in-up`, `.animate-scale-in`
- **Components**: `.card-premium`, `.card-interactive`, `.container-premium`, `.badge-premium`, `.tab-premium`
- **Chrome**: `.sidebar-premium`, `.header-premium`, `.content-wrapper`
- **Typography**: `.heading-xl…xs`, `.text-body`, `.text-caption`

## Principles

- **Accent used sparingly.** Selections/active states are a light **tint**
  (`bg-primary/10` + accent text), never a saturated fill. Reserve solid blue for
  primary buttons, focus rings, and key emphasis.
- **Semantic colors stay semantic** — warnings (amber), errors (red), success
  (green), HTTP method colors, and syntax highlighting are not accent-themed.
- **Legible glass** — heavy blur + vibrancy but high fill opacity so content on
  glass stays crisp.
- **Reduce-motion respected** — all transform animations sit behind
  `motion-safe:` and a global `prefers-reduced-motion` guard.
