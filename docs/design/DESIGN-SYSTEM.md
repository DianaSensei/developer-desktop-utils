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

## Design rules (apply when building, editing, or reviewing any UI)

These are behavioral commands, not background reading — they govern how to *decide*, while the foundations below define *what to use*. When a request conflicts with a rule here, flag the conflict before proceeding. **Reuse before inventing:** existing tokens, utilities, and scaffolding always win over a new parallel style, even a "nicer" one.

### Before writing any UI code

Answer these first; if unknown, ask or state the assumption inline:

- Who is the user and what is the **one** primary action on this screen? There is exactly one focal point per view.
- What states must exist: empty, loading, partial, error, success, ideal?
- Which existing component, token, or scaffolding (`ToolSection`/`ToolToolbar`/`ToolPanes`, the primitives) covers this? Use it — do not invent a parallel style.

### Hierarchy & layout

- One primary action per view; secondary actions visibly de-emphasized; tertiary quietest. Never give two elements equal maximum emphasis — if everything is bold, nothing is.
- Build from the scaffolding so every tool shares the same rhythm and headers. The content area is the hero: inputs and outputs fill the available width; chrome shrinks to the minimum.
- Group related items by proximity; separate unrelated groups with space, not just borders.
- Align to the spacing scale and a consistent grid — no one-off pixel values. Lead the eye most-to-least important; put the primary action where the user looks first (top-left for input) or acts last (inline/right for output).

### Spacing

- Use Tailwind's scale only. Vertical rhythm inside a tool is `tool-spacer` (`space-y-5 sm:space-y-6`); section padding `tool-padding`. Keep step sizes consistent within a view — inconsistent gaps read as bugs.
- Prefer whitespace over cramming. Density is a deliberate choice, not a default.

### Typography

- Use the typography utilities, never ad-hoc sizes: labels `text-xs font-medium`, hints `text-[11px] text-muted-foreground`, body `text-sm`, mono `font-mono text-sm`, headings via `.heading-xl…xs`. (See the type scale below.)
- One family (Inter) plus the mono fallback; express hierarchy through weight and size, not new fonts.
- Left-align body and long-form text; never justify or center it.

### Color

- Color communicates meaning (state, action, status), not decoration. **Never use color as the only signal** — pair it with text, icon, or shape (e.g. error = red + icon + message) for colorblind users.
- Pull every color from tokens (`bg-card`, `text-muted-foreground`, …); no raw hex when a token exists. Reserve solid accent blue for the single primary action; use `bg-primary/10` + `text-primary` for selected/active states. Keep semantic palettes (amber/red/green, HTTP-method, syntax) un-tinted by the accent.

### Affordances & interaction

- Interactive elements look interactive; non-interactive elements must not mimic them. Every action gets immediate visible feedback (hover, active, focus, loading, success, error) using the shared motion tokens — no jarring instant swaps.
- Keep clickable targets comfortable (≥44px on touch; dense pointer targets fine on desktop, but not cramped).
- Prefer recognition over recall: show options, autocomplete, and visible navigation. Use progressive disclosure — hide advanced/rare options until needed.
- **Keyboard-first:** wire `useQuickPaste` (⌘V) and `useInputHistory` (⌘Z/⌘⇧Z) on every text tool.

### Feedback & system status

- Implement **all** states for any data-driven view: loading, empty, error, populated. An empty state guides the user to the next action — never a blank void.
- Show progress for anything over ~1s (spinner, skeleton, progress bar). Never freeze the UI; offload heavy work to a worker/Rust command.
- Confirm destructive or irreversible actions and offer undo where possible.

### Error prevention & recovery

- Prevent errors first: sensible defaults, input constraints, inline validation, disabled-until-valid where appropriate.
- Error messages say what went wrong **and** how to fix it, in plain language — no raw codes or "An error occurred."
- Never trap the user: always provide a clear exit/back/cancel. Preserve user input on error — never wipe a form because one field failed.

### Forms

- One column. Labels above fields (never placeholder-only — placeholders disappear and fail accessibility). Mark required vs optional explicitly; match field width to expected input length.
- Group related fields and order them logically; ask only for what is truly needed. Validate inline and on blur, not only on submit.

### Responsive

- Desktop-first (this is a cross-platform desktop tool), but content must reflow down to narrow widths without horizontal scroll — use the responsive scaffolding utilities rather than fixed pixel widths.

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
- Ship a UI with missing loading/empty/error states.
- Use placeholder text as the only label, or rely on color alone for status.
- Remove focus outlines without a visible replacement.
- Add a second co-equal primary button on the same view.
- Center or justify long body text, or block the user with no way back/cancel.

---

## Accessibility (non-negotiable)

- **Contrast:** meet WCAG AA — 4.5:1 normal text, 3:1 large text and UI components. Text tokens (`--foreground`, `--muted-foreground`) are tuned for both themes; keep custom text on accent/semantic fills above AA.
- **Keyboard:** every interactive element is keyboard reachable and operable. Visible focus rings use `--ring`; the `.accent-glow` utilities provide soft halos. Never remove a focus outline without replacing it.
- **Semantics:** use native controls and the shared primitives first (`button`, `a`, `label`, headings in order); reach for ARIA only when semantics are insufficient. Every input has an associated label; every meaningful image has alt text (decorative images marked empty).
- **Reduced motion:** a global `prefers-reduced-motion` guard neutralizes animations/transitions; transform effects are additionally gated behind `motion-safe:`. Never rely on motion alone to convey meaning.
- **Scrollbars:** one thin, themed cross-platform scrollbar (`.no-scrollbar` opts out where needed).

---

## Self-review before declaring UI done

Verify each item and report the result; if any answer is "no," fix it or explicitly flag it before finishing:

1. Exactly one clear primary action per view? Hierarchy obvious at a glance (squint test)?
2. Spacing, type, and color all from the defined scale/tokens (no raw hex or one-off px)?
3. Loading, empty, error, and success states all handled?
4. Keyboard navigable with a visible focus state; ⌘V / ⌘Z hooks wired on text tools?
5. Contrast meets AA; every input labeled; every meaningful image has alt text?
6. Color never the only signal for status?
7. Destructive actions confirmed/reversible; user input preserved on error?
8. Reflows to narrow width without horizontal scroll?
9. Consistent with existing components and patterns; built from the scaffolding?
10. Verified in **both** light and dark themes?

---

## Reuse in another project

The system is portable. Short version: copy `src/design-system/` (plus `src/components/ui/` and `src/lib/utils.ts`), import `tokens.css` at the top of your global CSS, add the preset to `tailwind.config.js`, and install Inter. Full steps are in [`src/design-system/README.md`](../../src/design-system/README.md).
