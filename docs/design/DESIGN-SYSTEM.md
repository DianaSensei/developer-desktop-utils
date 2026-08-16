# DevTool Design System

> ## ⚠️ Two systems exist right now — read this first
>
> | | Where | Status |
> |---|---|---|
> | **Current** | `src/design-system/` + this document | What the app ships **today**. Still accurate. |
> | **Approved target** | [`design/`](../../design/) | The **v4 design kit** — approved, not yet migrated into the app. |
>
> The [`design/`](../../design/) kit is the approved direction: accent swappable via three
> HSL channels, status colors as a separate fixed system, bilingual VI/EN, a rebuilt
> component set. It ships with a live sample page (`design/preview/index.html`) you can
> open directly in a browser.
>
> **Writing new UI?** Read [`design/RULES.md`](../../design/RULES.md) — it supersedes the
> "Design rules" section below wherever the two disagree. This document remains the
> reference for everything the migration has not reached yet, and for app-specific
> concerns the kit does not cover (layout utilities, cross-platform webview parity).
>
> The migration replaces this document's foundations section phase by phase. Until then,
> **do not** assume a value here matches `design/tokens.css` — several deliberately differ
> (radius scale, control heights, shadow system, `fontFamily.mono`).

---

The single reference for how DevTool looks and feels: **swappable accent · soft-depth elevation · Apple-style frosted glass · Be Vietnam Pro type · one motion rhythm**, all driven by CSS variables so theming and dark mode are free.

> **Source of truth is the code, not this document.** The actual tokens, utilities, and Tailwind theme live in [`src/design-system/`](../../src/design-system/) — `tokens.css` (CSS variables + utility classes), `tailwind-preset.cjs` (Tailwind theme), and `index.ts` (component import surface). If a value here ever disagrees with `tokens.css`, `tokens.css` wins. This doc explains the *intent* and *how to use it*; [`src/design-system/README.md`](../../src/design-system/README.md) is the short "how to copy it into another project" guide.

---

## Principles

- **Accent used sparingly.** Selections and active states are a light **tint** (`bg-acc/10` + accent text), never a saturated fill. Reserve solid blue for primary buttons, focus rings, and the single key action on a screen. Flooding a view with blue cheapens it.
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

- Use Tailwind's scale only. Vertical rhythm inside a tool is `tool-spacer` (`space-y-6 sm:space-y-7`); section padding `tool-padding`. Keep step sizes consistent within a view — inconsistent gaps read as bugs.
- Prefer whitespace over cramming. Density is a deliberate choice, not a default.

### Typography

- Use the typography utilities, never ad-hoc sizes: labels `text-xs font-medium`, hints `text-[11px] text-fg-mute`, body `text-sm`, mono `font-mono text-sm`, headings via `.heading-xl…xs`. (See the type scale below.)
- One sans family (Be Vietnam Pro) plus one mono (IBM Plex Mono); express hierarchy through weight and size, not new fonts.
- Left-align body and long-form text; never justify or center it.

### Color

- Color communicates meaning (state, action, status), not decoration. **Never use color as the only signal** — pair it with text, icon, or shape (e.g. error = red + icon + message) for colorblind users.
- Pull every color from tokens (`bg-card`, `text-fg-mute`, …); no raw hex when a token exists. Reserve solid accent blue for the single primary action; use `bg-acc/10` + `text-acc` for selected/active states. Keep semantic palettes (amber/red/green, HTTP-method, syntax) un-tinted by the accent.

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

All colors are CSS variables (HSL component triples) defined in `tokens.css` under `:root` (light) and `.dark`. Reference them through Tailwind classes (`bg-card`, `text-fg-mute`, `border-line`, …) — never hard-code hex.

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

Font stack is **Be Vietnam Pro** (sans) + **IBM Plex Mono**, self-hosted with a full system fallback — see `design/tokens.css`. Chosen for Vietnamese: stacked diacritics (ế ộ ữ) stay clear of the letterform. Use the typography utility classes rather than ad-hoc sizes:

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
`Button`, `Card`(+ parts), `Input`, `Textarea`, `Label`, `Select`(+ parts), `Switch`, `Dialog`(+ parts), `Tooltip`, `Segmented`, `CopyButton`, `EmptyState`, `DropZone`, `IconButton`, `DropdownMenu`(+ parts), `SplitPane`, `StatusDot`, `ContextMenu` (+ `useContextMenu`), `ConfirmDialog`, `SearchInput`, `Tabs`, `Callout`, `Badge`, `Spinner` (+ `LoadingRow`), `SectionLabel`, `CollapsibleSection`, `Stat` (+ `StatGrid`).

**Data display:**
`DataTable`, `Thead`, `Tbody`, `Tr`, `Th`, `Td`.

**Layout scaffolding:**
`ToolSection`, `ToolLabel`, `ToolHint`, `ToolContent`, `Field` (section + form structure) and `ToolToolbar`, `ToolPanes`, `ToolPane`, `PaneHeader` (toolbar + split-pane layouts).

### Interaction foundation — reuse before hand-rolling

These patterns kept getting reimplemented per-tool with small drifting variations. Use the shared version:

- **`IconButton`** — the icon-only action button (`rounded p-1.5 text-fg-mute hover:bg-acc/10 hover:text-fg`). Always pass `title` since there's no visible label.
  ```tsx
  <IconButton title="More" onClick={...}><MoreVertical className="h-4 w-4" /></IconButton>
  ```
- **`DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` / `DropdownMenuItem` / `DropdownMenuLabel` / `DropdownMenuSeparator`** — any "▾ button that opens a small action list" (body-type picker, format picker, header "more" menu, per-row context actions). Dependency-free, built on `useDismissable` — do not hand-roll `open` state + an absolutely positioned `div` again.
  ```tsx
  <DropdownMenu>
    <DropdownMenuTrigger className="flex items-center gap-1 text-xs">
      Options <ChevronDown className="h-3.5 w-3.5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-48">
      <DropdownMenuLabel>Export</DropdownMenuLabel>
      <DropdownMenuItem icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>Download</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem danger onClick={handleDelete}>Delete</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  ```
- **`SplitPane`** — any resizable two-pane layout (request/response split, sidebar/detail split). Handles pointer-drag resize, persisted-percent (controlled) or self-managed (uncontrolled), and reclamp-on-container-resize. Do not hand-roll pointer-drag divider logic again.
  ```tsx
  <SplitPane
    direction="horizontal"
    percent={splitPercent}
    onPercentChange={setSplitPercent}
    minPanePx={320}
    first={<RequestPane />}
    second={<ResponsePane />}
  />
  ```
- **`StatusDot`** — the connection/live/recording indicator dot (Kafka broker, RabbitMQ connection, environment selector, live consumer row, time-tracker running state, Mock Server running state). One place defines what each tone means; do not reach for a raw `<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />` again.
  ```tsx
  <StatusDot tone={connected ? 'live' : 'idle'} title={connected ? 'connected' : 'not connected'} />
  <StatusDot tone="recording" pulse size="xs" />
  <StatusDot tone="live" size="md" glow />  {/* headline "server is running" state */}
  ```
  `size`: `xs` (1.5) / `sm` (2, default) / `md` (2.5). `glow` adds a soft halo ring in the tone color for the one dot on screen that's the primary state indicator, not for list rows.
- **`ContextMenu` / `useContextMenu`** — right-click menu for tree/list rows (collections, connections, topics). Cursor-positioned sibling of `DropdownMenu`, same entry shape (`icon`, `label`, `onClick`, `danger`, `sep`).
  ```tsx
  const menu = useContextMenu();
  <div onContextMenu={(e) => menu.open(e, [
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: rename },
    { icon: <Trash2 className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: remove },
  ])}>
    {row}
  </div>
  {menu.state && <ContextMenu state={menu.state} onClose={menu.close} />}
  ```
- **`ConfirmDialog`** — confirmation for any destructive/irreversible action (delete, purge, disconnect-and-lose-state). Every destructive action must go through this or an equivalent confirm step — see "Error prevention & recovery" above.
  ```tsx
  <ConfirmDialog
    open={confirmOpen}
    onOpenChange={setConfirmOpen}
    title="Delete collection?"
    description="This removes the collection and everything in it. This can't be undone."
    confirmLabel="Delete"
    onConfirm={() => store.deleteCollection(id)}
  />
  ```
- **`SearchInput`** — the icon-in-input search box (sidebar filters, list-view search, collection search). Wraps `Input`; do not reposition a `Search` icon by hand again.
  ```tsx
  <SearchInput value={query} onChange={setQuery} placeholder="Search exchanges…" />
  ```
- **`Tabs`** — horizontal tab strip that collapses overflow tabs into a `»` menu as it runs out of room (measures real widths, never clips the active tab). Use for any tool with more than a couple of horizontal view tabs (request/response panel tabs, per-item detail views).
  ```tsx
  <Tabs
    tabs={[{ id: 'body', label: 'Response' }, { id: 'headers', label: 'Headers', badge: <Badge/> }]}
    active={tab}
    onSelect={setTab}
    right={<StatusReadout />}
  />
  ```
  Uses `border-acc` for the active-tab underline by default (per the "reserve accent for the key action/state" color rule) — override via `className` if a tool has an established alternate accent.

### Display foundation — one answer per pattern

The second pass covered the things tools *show* rather than the things users click. Same rule: reach for these before writing the class string again.

- **`Callout`** — the inline status banner (`tone`: `error` / `warning` / `success` / `info`). The single answer to "how does a view show an error". Sizes `sm` (11px, inside a panel) and `md` (14px, default). Pass `icon` to override the tone glyph or `icon={false}` to drop it; `title` for a bold first line; `actions` for a retry button. Do not hand-write `border-bad/40 bg-bad/10` again, and do not fall back to a bare `<p className="text-sm text-bad">` — a failure should look the same in every tool.
  ```tsx
  {error && <Callout tone="error">{error}</Callout>}
  <Callout tone="warning" size="sm" title="Credential storage">Profiles are saved on this device.</Callout>
  ```
  `Callout` is the always-rendered state of a value. For a transient, dismissable result banner tied to an action, `StatusMessage` still applies.
- **`Badge`** — the small inline label: connection state, message count, mode chip, "beta". Two closed axes — `tone` (`neutral`/`success`/`warning`/`danger`/`info`/`accent`) and `variant` (`soft`/`solid`/`outline`) — plus `size` (`xs`/`sm`), `pill`, `mono`, and `uppercase` (which switches to the semibold state-chip look; leave it off for counts and free text).
  ```tsx
  <Badge tone="success" uppercase>running</Badge>
  <Badge pill>{items.length}</Badge>
  ```
  A badge whose color encodes a domain value rather than a status (the API Client's per-HTTP-verb method chip) keeps its own color module — that's the one legitimate exception.
- **`DataTable` / `Thead` / `Tbody` / `Tr` / `Th` / `Td`** — the dense read-only grid every "list of things from a server" view needs. Fixes the wrapper, header tint, row separators and cell padding in one place. `Th align="right"`, `Td numeric` (right + `tabular-nums`), `Td mono`, `Tr interactive` (hover + pointer), `Tbody zebra` (alternating tint instead of hairlines), `Thead sticky`, and `DataTable density="compact"` for tables embedded in a dialog or panel. Density travels by context, so set it once on `DataTable`.
  ```tsx
  <DataTable>
    <Thead><Tr><Th>Name</Th><Th align="right">Ready</Th></Tr></Thead>
    <Tbody>
      {rows.map((r) => (
        <Tr key={r.name} interactive onClick={() => open(r)}>
          <Td mono>{r.name}</Td><Td numeric>{r.ready}</Td>
        </Tr>
      ))}
    </Tbody>
  </DataTable>
  ```
  These are deliberately thin styled elements, not a `columns`-config table: the views need badges, buttons and status dots inside cells far more than they need automatic rendering.
- **`Stat` / `StatGrid`** — a labelled number. Three shapes: `card` (bordered tile in a dashboard grid, default), `compact` (smaller tile for a summary strip), `inline` (value + label on one baseline, for toolbars). `tone` colors the value; `mono` switches it to monospace-and-wrapping when the "number" is really an identifier (IP, hostname, node name); `sub` adds a secondary line; `action` docks a control (e.g. a `CopyButton`) at the right edge.
  ```tsx
  <StatGrid columns={4}>
    <Stat label="Ready" value={formatNumber(q.messages_ready)} />
    <Stat label="Failed" value={failed} tone={failed ? 'danger' : 'muted'} />
  </StatGrid>
  <Stat variant="inline" tone="success" label="unique" value={count} />
  ```
- **`Spinner` / `LoadingRow`** — the busy indicator, and the muted "⟳ Loading…" line a view shows while fetching. `Spinner` sizes `xs`/`sm`/`md`/`lg`; give it a `label` only when it stands alone with no adjacent text. The spin is intentionally not behind `motion-safe:` — a frozen spinner communicates nothing.
  ```tsx
  <Button disabled={busy}>{busy ? <Spinner size="sm" className="mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />} Start</Button>
  {loading && <LoadingRow label="Loading topic details…" />}
  ```
- **`SectionLabel`** — the uppercase micro-caption above a group of controls or rows. `size` `xs` (default) / `sm`; `count` appends a count chip; `rule` extends a hairline to the right, turning it into a divider; `actions` docks controls at the right. Use this instead of picking a fresh combination of `text-[10px]`/`[11px]`/`xs` and `tracking-wide`/`wider`/`widest`.
  ```tsx
  <SectionLabel>Advanced</SectionLabel>
  <SectionLabel rule count={items.length}>Interfaces</SectionLabel>
  ```
- **`CollapsibleSection`** — the disclosure: a header row that toggles a body. Controlled (`open` + `onOpenChange`) or uncontrolled (`defaultOpen`). `variant="bordered"` wraps it in a card outline, `eyebrow` makes the header an uppercase caption, `hint` adds a muted aside after the title, `actions` docks controls in the header. House behaviour is fixed here: **one chevron that rotates** — pointing right when closed, down when open — never an icon swap.
  ```tsx
  <CollapsibleSection variant="bordered" title="Advanced / TLS" hint="— vhost, heartbeat, CA" open={open} onOpenChange={setOpen}>
    {fields}
  </CollapsibleSection>
  ```
- **`Field`** — one labelled form control: label row (+ optional `actions`), the control, and an optional `hint` underneath. `error` replaces the hint in the destructive tone; `required` adds a muted asterisk. Pass `htmlFor` with a matching input `id` so clicking the label focuses the control.
  ```tsx
  <Field label="Timeout" hint="Per request, in milliseconds." htmlFor="timeout">
    <Input id="timeout" value={timeout} onChange={...} />
  </Field>
  ```

### Code surfaces — one CodeMirror look

Four editors use CodeMirror 6: the API Client's `CodeEditor` (scripts, tests, request bodies), its `ResponseViewer`, its `VarInput` URL bar, and the SQL Formatter. They share **one** theme and **one** syntax palette, both in `src/components/ui/code-theme.ts`.

- **`useCodeTheme(viewRef, opts)`** — call it in the component, put the returned `extension` in the initial `EditorState`, and the editor is themed *and* stays correct when the user flips light/dark.
  ```tsx
  const viewRef = useRef<EditorView | null>(null);
  const theme = useCodeTheme(viewRef, { fontSize: '12px', gutter: 'flush', activeLine: false });
  // …then: EditorState.create({ extensions: [basicSetup, theme.extension, …] })
  ```
  `CodeThemeOptions`: `fontSize` · `contentPadding` · `gutter` (`panel` tinted + divider, or `flush` transparent for a viewer) · `activeLine` (off for read-only) · `fill` (off for a single-line field).

- **`codeHighlight`** — the syntax palette, driven entirely by the `--sql-*` / `--js-*` tokens so light/dark swaps in CSS with no editor rebuild. Add a tag here rather than defining a second `HighlightStyle`, and **do not add hard-coded fallback colors** (`var(--sql-number, hsl(...))`) — the tokens are always defined, so a fallback is dead code that only lets the palettes drift apart again.

**The `dark` flag matters.** CodeMirror picks between its own `&light` and `&dark` base rules from the flag passed to `EditorView.theme(spec, { dark })` — it cannot see the app's `.dark` class. An editor built without it is pinned to the light base theme, so anything the app spec doesn't restate stays light in dark mode (most visibly `&light .cm-tooltip { background: #f5f5f5 }` behind autocomplete, and `&light .cm-selectionBackground { background: #d9d9d9 }` behind selected text). `useCodeTheme` passes the flag and reconfigures a `Compartment` on every theme change — never build a bare `EditorView.theme()` for a new editor.

A small purpose-specific overlay on top of the shared theme is fine (`varTheme` for `{{variable}}` pills, `singleLineTheme` for the URL bar). A second full theme is not.

---

## Usage guidelines

**Do**
- Build tools from the scaffolding (`ToolSection`/`ToolToolbar`/`ToolPanes`) so every tool shares the same rhythm and headers.
- Use `bg-acc/10` + `text-acc` for selected/active states; reserve solid `bg-acc` for the one primary action.
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

The system is portable. Short version: copy `src/design-system/` (plus `src/components/ui/` and `src/lib/utils.ts`), import `tokens.css` at the top of your global CSS, add the preset to `tailwind.config.js`, and install the fonts. Full steps are in [`src/design-system/README.md`](../../src/design-system/README.md).
