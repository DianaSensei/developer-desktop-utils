# Changelog: api-client-request-panel-pill-tabs

## Chosen Proposal

Extend the shared `Tabs` component (`src/components/ui/tabs.tsx`) with an opt-in `variant: 'pill'`
mode, and switch API Client's `RequestPanel` (Params/Body/Auth/Script/Tests/Settings) to it —
matching the same Postman-style reference the outer request tabs (`RequestTabs.tsx`) already
adopted: active tab as a filled rounded pill instead of a sliding underline bar, plus a small green
"has content" dot and a muted count badge replacing the old plain-text `" (n)"`/`" •"` suffixes baked
into the label string.

`variant` defaults to `'underline'` (unchanged) — every other consumer of this shared component
(Kafka topic views, RabbitMQ queue/exchange views) keeps its existing sliding-underline look, since
their tab bars weren't part of this request.

## Diagrams

None — visual restyle of an existing shared component plus a small per-request-property badge
computation; no new system boundary or data model.

## Why This Proposal

An opt-in variant on the shared component, rather than either (a) forking a second tab-bar component
for API Client or (b) changing the shared component's default look for every consumer, keeps the
change scoped to exactly what was asked (the request panel's tabs) without silently restyling Kafka's
and RabbitMQ's tab bars as a side effect, and without duplicating the overflow-collapse/measurement
logic `Tabs` already handles.

## Final AC / DoD Status

| Item | Status | Notes |
|------|--------|-------|
| Active tab renders as a rounded pill, matching the reference | Met | `rounded-md`/`bg-card`/`shadow-sm`; verified visually via Playwright in dark mode (the reference's own theme) |
| Count/"has content" shown as a distinct badge, not text baked into the label | Met | New `tabBadge()` helper renders a muted count `<span>` and/or a green dot `<span>` via `TabDef.badge`, replacing the `count()` helper and inline `' •'` strings |
| Other `Tabs` consumers (Kafka, RabbitMQ) unaffected | Met | `variant` defaults to `'underline'`; new test asserts the default variant keeps its `border-b-2` class and gets no `rounded-md` |
| No regression to tab overflow/measurement, tab switching | Met | 1247/1247 tests pass; new `tabs.test.tsx` proves pill mode still calls `onSelect` correctly |

## Remaining Risk

None identified. Visual-only change with no logic beyond className branching and one small badge
helper; confirmed against the running app in dark mode (matching the user's own reference
screenshot's theme) via Playwright, after first catching and fixing a real contrast bug during that
verification (see below).

## Files Changed

- `src/components/ui/tabs.tsx` — added `variant?: 'underline' | 'pill'` to `Tabs`/`TabRow`/`TabBtn`;
  pill mode skips the sliding-underline `ResizeObserver` effect and bar entirely.
- `src/components/tools/apiclient/RequestPanel.tsx` — switched to `variant="pill"`; replaced the
  `count()` helper and inline `' •'` label suffixes with a `tabBadge()` helper rendering an actual
  badge (`TabDef.badge`); added a `bg-bg-2/10` tint to the tab bar's container — pill mode's active
  tab is `bg-card`, the same tone as the bright workbench surface the bar itself sits on, so without
  a dim band behind the strip the pill had nothing to contrast against and rendered as plain text
  (caught via a Playwright screenshot during verification, not visible from reading the diff alone).
- `src/components/ui/tabs.test.tsx` (new) — pill vs. underline variant coverage.
