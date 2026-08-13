---
name: taste-skill
description: Anti-slop UI polish checklist for DevTool's dense product UI (tool panes, forms, data views). Adapted from leonxlnx/taste-skill (github.com/leonxlnx/taste-skill), which targets marketing/landing pages — this version keeps only the parts that transfer to dashboards and drops everything about heroes, marquees, scroll-hijacking, and marketing copy. Use when polishing or reviewing any tool's UI/UX in this codebase.
---

# taste-skill (DevTool edition)

Source skill (`leonxlnx/taste-skill`) explicitly excludes dashboards, dense product UI, and code editors from its scope — it's built for landing pages and portfolios. DevTool's tools (API Client, Kafka Explorer, RabbitMQ, etc.) are all dense product UI, so most of the source skill's hero/marketing/scroll-hijack rules don't apply here. This is the subset that does, rewritten against `docs/ai/CLAUDE.md` and `docs/design/DESIGN-SYSTEM.md`, which remain the primary source of truth for tokens and components.

Read `docs/design/DESIGN-SYSTEM.md` first for the actual rules and self-review checklist. This file adds sharper, more mechanical checks on top.

## 1. Read the room before touching anything

State in one line what you're improving and for whom, e.g. *"API Client request/response panes: reduce clicks-to-result, make errors and long waits legible, tighten visual noise."* Don't restyle a tool wholesale when the ask is "make it easier to use" — fix friction first, aesthetics second.

## 2. Typography & density discipline

- Follow the existing type scale exactly: labels `text-xs font-medium`, hints `text-[11px] text-muted-foreground`, body `text-sm`, mono `font-mono text-sm`. Don't introduce new sizes ad hoc.
- Dense product UI (this app) lives at density 7-9 on the source skill's dial: tight paddings, `divide-y`/`border-t` instead of nested cards, `font-mono` for all technical values (status codes, timings, sizes, tokens).
- No decorative empty space "for calm" — every pixel in a tool pane should be doing work. This is the opposite instinct from a landing page.

## 3. Color & state discipline

- One accent per semantic meaning, reused consistently: method colors (GET/POST/etc.), status colors (2xx/3xx/4xx/5xx), connection dot (live/idle/error). Don't invent a new color for the same meaning in a different panel.
- No decorative colored dots — only real state (live connection, unsaved changes). This mirrors the source skill's "zero decorative status dots" rule.
- Every interactive control needs all of: default, hover, active/pressed (`scale-[0.98]` or `-translate-y-[1px]`), disabled, focus-visible. Ship all four, not just the happy path.

## 4. The four states every data view needs

Loading, empty, error, and populated — for every request/response pane, list, or table:
- **Loading**: skeleton matching the eventual shape, not a generic spinner, for anything that can take >300ms.
- **Empty**: tells the user what to do next ("Send a request to see the response here"), not a blank pane.
- **Error**: inline, specific, actionable — not just "Something went wrong."
- **Populated**: the default case, already covered by existing components.

## 5. Contrast & accessibility (mandatory, not optional)

- WCAG AA minimum (4.5:1 body, 3:1 large text) on every button, badge, and status pill in both light and dark mode — check both, not just one.
- Never ship a button whose label is the same color as its background.
- Placeholder text, helper text, and disabled states must still clear contrast minimums — "muted" isn't a license to fail AA.

## 6. Motion — restrained and motivated

DevTool default is `MOTION_INTENSITY` 2-3 (near-static), not the source skill's marketing baseline of 6-8:
- Transitions on state changes (tab switch, pane resize, copy feedback) use existing CSS `transition-*` utilities — nothing longer than ~200ms.
- No infinite loops, no scroll-triggered reveals, no parallax. This is a tool, not a pitch.
- Every animation needs a one-sentence justification (feedback, hierarchy, state transition). If you can't state it, cut it.
- Respect `prefers-reduced-motion` for anything beyond simple opacity/color transitions.

## 7. AI-tells to avoid (the parts of Section 9 that generalize)

- No hand-rolled SVG icons — use the existing `lucide-react` icons already in use across the app (the source skill discourages lucide for marketing sites, but this codebase standardizes on it — don't fight the existing convention).
- No fake-precise placeholder numbers in examples/docs/guides ("99.99%", "1234567") — use realistic, slightly messy sample data.
- No filler verbs in UI copy ("Elevate", "Seamless", "Unleash"). Buttons and labels say exactly what they do: "Send", "Copy", "Save Environment".
- No duplicate-intent controls in the same view (two buttons that both mean "run this request").

## 8. Pre-flight before calling a UI change done

1. Does it use `src/components/ui/` / `@/design-system` components only — no native `<select>`, `alert`, `confirm`?
2. Does every interactive element have hover/active/disabled/focus states?
3. Does every async data view have loading/empty/error states, not just populated?
4. Does it pass AA contrast in both light and dark mode?
5. Is every animation justified in one sentence, and does it respect `prefers-reduced-motion`?
6. Did you resist adding a new color, size, or spacing value that isn't already a token?

## Out of scope (inherit from the source skill)

This file does not cover: marketing pages, onboarding/landing surfaces, or anything with a "hero." If DevTool ever ships a public marketing page, pull the *original* `leonxlnx/taste-skill` for that surface instead of this one.
