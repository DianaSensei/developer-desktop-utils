# DevTool Design System

The single reference for how DevTool looks and feels: **azure-blue accent · soft-depth elevation · Apple-style frosted glass · Inter type · one motion rhythm**, all driven by CSS variables so theming and dark mode are free.

> **Source of truth is the code, not this document.** The actual tokens, utilities, and Tailwind theme live in [`src/design-system/`](../../src/design-system/) — `tokens.css` (CSS variables + utility classes), `tailwind-preset.cjs` (Tailwind theme), and `index.ts` (component import surface). If a value here ever disagrees with `tokens.css`, `tokens.css` wins. This doc explains the *intent* and *how to use it*; [`src/design-system/README.md`](../../src/design-system/README.md) is the short "how to copy it into another project" guide.

---

## Principles

- **Accent used sparingly.** Selections and active states are a light **tint** (`bg-primary/10` + accent text), never a saturated fill. Reserve solid blue for primary buttons, focus rings, and the single key action on a screen. Flooding a view with blue cheapens it.
- **Semantic colors stay semantic.** Warnings (amber), errors (red), success (green), HTTP-method colors, and editor syntax highlighting are **not** accent-themed — they carry meaning and must stay recognizable.
- **Soft, layered depth.** Elevation comes from multi-layer, low-alpha shadows (never hard 1px borders alone). Surfaces feel like paper stacked in light.
- **Legible glass.** Chrome (sidebar, headers, popovers) uses heavy blur + saturation but **high fill opacity** so content on top stays crisp — Apple-style vibrancy without the mud.
- **One motion rhythm.** Every transition uses the shared easing/duration tokens. Transform animations sit behind `motion-safe:` and a global `prefers-reduced-motion` guard.
- **Cross-platform parity.** The app runs in three webviews (macOS WKWebView, Windows WebView2, Linux WebKitGTK). Shadows, scrollbars, and blur are tuned to look identical across all three.

---

## Foundations

### Color tokens

All colors are CSS variables (HSL component triples) defined in `tokens.css` under `:root` (light) and `.dark`. Reference them through Tailwind classes (`bg-card`, `text-muted-foreground`, `border-border`, …) — never hard-code hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `0 0% 95%` | `0 0% 10%` | App canvas |
| `--sidebar` | `0 0% 92%` | `0 0% 8%` | Sidebar / chrome base |
| `--card` | `0 0% 100%` | `0 0% 14%` | Cards, panels |
| `--popover` | `0 0% 100%` | `0 0% 15%` | Menus, popovers |
| `--elevated` | `0 0% 100%` | `0 0% 17%` | Raised surfaces |
| `--foreground` | `0 0% 8%` | `0 0% 92%` | Primary text |
| `--muted-foreground` | `0 0% 42%` | `0 0% 58%` | Secondary text |
| `--primary` / `--ring` | `216 94% 52%` | `214 100% 66%` | Key actions, focus rings |
| `--accent` | `216 92% 56%` | `214 98% 70%` | Accent surfaces/text |
| `--accent-glow` | `216 96% 56%` | `214 100% 66%` | Low-alpha focus/accent glow |
| `--secondary` | `0 0% 88%` | `0 0% 22%` | Secondary buttons |
| `--input` | `0 0% 96%` | `0 0% 18%` | Field backgrounds |
| `--muted` | `0 0% 92%` | `0 0% 20%` | Muted fills |
| `--border` | `0 0% 86%` | `0 0% 22%` | Hairlines |
| `--destructive` | `0 84% 52%` | `0 80% 64%` | Errors, delete |

**Editor syntax** colors are separate tokens (`--sql-*`, `--js-*`) so highlighting reads correctly in both themes and is never tinted by the accent.

### Typography

Font stack is **Inter Variable** with a full system fallback (see `tailwind-preset.cjs`); install via `@fontsource-variable/inter`. Use the typography utility classes rather than ad-hoc sizes:

| Class | Style |
|---|---|
| `.heading-xl` | `text-xl font-semibold` tight tracking |
| `.heading-lg` | `text-lg font-semibold` |
| `.heading-md` | `text-base font-semibold` |
| `.heading-sm` | `text-sm font-semibold` |
| `.heading-xs` | `text-xs font-semibold uppercase tracking-wider` muted — section eyebrows |
| `.text-body` | `text-sm leading-relaxed` — default body |
| `.text-caption` | `text-xs` muted — hints, metadata |

### Shape & spacing

- **Radius:** one value, `--radius: 1rem`, exposed as Tailwind `rounded-lg` (with `md`/`sm` derived as `−2px`/`−4px`). Default to `rounded-lg` for cards, inputs, and buttons.
- **Spacing:** use Tailwind's scale. Vertical rhythm inside a tool is typically `space-y-4`/`space-y-6`; section padding `p-4`/`p-6`. Keep it consistent within a view rather than mixing many step sizes.

### Elevation (shadows)

Two complementary scales, both layered and low-alpha:

- **Tailwind `shadow-sm … shadow-2xl`** (from the preset) — general-purpose, tuned for webview parity.
- **`.shadow-*-premium`** (from `tokens.css`) — the soft-depth scale used by premium components.
- **Accent elevation:** `.shadow-primary` / `.shadow-primary-lg` add a soft blue glow under the key action.

### Motion

Shared tokens: `--ease-out-soft`, `--ease-spring`, and durations `--dur-fast (150ms)` / `--dur-base (220ms)` / `--dur-slow (340ms)`; Tailwind exposes `ease-out-soft` and `spring`. Theme switches use a scoped `.theme-transition` class so colors cross-fade without reflow. All transform-based effects are behind `motion-safe:`.

### Glass

`.glass`, `.glass-strong`, `.glass-chrome` (sidebar/header tone), and `.glass-sheen` (subtle top highlight). Always paired with high fill opacity for legibility.

---

## Utility classes

Defined in `tokens.css` (`@layer utilities`):

- **Glass:** `.glass`, `.glass-strong`, `.glass-chrome`, `.glass-sheen`
- **Elevation:** `.shadow-sm-premium … .shadow-2xl-premium`, `.shadow-primary`, `.shadow-primary-lg`
- **Motion:** `.hover-elevate`, `.press`, `.accent-glow`, `.accent-glow-soft`, `.animate-pop`, `.animate-fade-in-up`, `.animate-scale-in`
- **Components:** `.card-premium`, `.card-interactive`, `.container-premium`, `.badge-premium`, `.tab-premium`(`.active`)
- **Chrome:** `.sidebar-premium`, `.header-premium`, `.content-wrapper`
- **Typography:** `.heading-xl…xs`, `.text-body`, `.text-caption`
- **Misc:** `.no-scrollbar`

---

## Components

Import everything from the single surface — never reach into `src/components/ui/*` directly from a tool:

```tsx
import { Button, Card, Input, Select, Segmented, ToolSection, PaneHeader, cn } from '@/design-system';
```

**Primitives** (shadcn-style, Radix-based, in `src/components/ui/`, re-exported by `src/design-system/index.ts`):
`Button`, `Card`(+ parts), `Input`, `Textarea`, `Label`, `Select`(+ parts), `Switch`, `Dialog`(+ parts), `Tooltip`, `Segmented`, `CopyButton`, `EmptyState`, `DropZone`.

**Layout scaffolding:**
`ToolSection`, `ToolLabel`, `ToolHint`, `ToolContent` (section structure) and `ToolToolbar`, `ToolPanes`, `ToolPane`, `PaneHeader` (toolbar + split-pane layouts).

---

## Usage guidelines

**Do**
- Build tools from the scaffolding (`ToolSection`/`ToolToolbar`/`ToolPanes`) so every tool shares the same rhythm and headers.
- Use `bg-primary/10` + `text-primary` for selected/active states; reserve solid `bg-primary` for the one primary action.
- Use semantic palettes for status: amber = warning, red = destructive, green = success.
- Lean on `rounded-lg`, the shadow scale, and `.hover-elevate` for interactive cards.
- Test every change in **both** light and dark before calling it done.

**Don't**
- Hard-code hex colors or px radii — use tokens / Tailwind classes.
- Paint large areas in saturated accent blue.
- Add bespoke shadows or easing curves — use the scales and motion tokens.
- Animate transforms without a `motion-safe:` guard.

---

## Accessibility

- **Reduced motion:** a global `prefers-reduced-motion` guard neutralizes animations/transitions; transform effects are additionally gated behind `motion-safe:`.
- **Focus:** visible focus rings use `--ring` (the accent); the `.accent-glow` utilities provide soft focus halos.
- **Contrast:** text tokens (`--foreground`, `--muted-foreground`) are tuned for legible contrast in both themes; keep custom text on accent/semantic fills above WCAG AA.
- **Scrollbars:** one thin, themed cross-platform scrollbar (`.no-scrollbar` opts out where needed).

---

## Reuse in another project

The system is portable. Short version: copy `src/design-system/` (plus `src/components/ui/` and `src/lib/utils.ts`), import `tokens.css` at the top of your global CSS, add the preset to `tailwind.config.js`, and install Inter. Full steps are in [`src/design-system/README.md`](../../src/design-system/README.md).
