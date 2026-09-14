# Changelog: api-client-postman-style-tabs

## Chosen Proposal

Restyle `RequestTabs.tsx`'s open-request tab strip to match the Postman-style reference screenshot
the user provided: a flat/borderless chrome bar, the active tab rendered as a rounded pill (filled
background + shadow) instead of a full-height rectangle with a top accent bar, and a folder icon at
the end of the strip. The method-colored, abbreviated prefix (`POST`/`GET`) already existed and
needed no change.

Two elements from the reference photo needed a decision before implementing, since neither maps
directly onto DevTool's existing model — resolved via `AskUserQuestion` before any code was written:

- **The orange "unsaved" dot** next to a tab's name in Postman's screenshot marks a change not yet
  pushed to Postman's cloud sync. DevTool autosaves every edit straight to the store — there is no
  "unsaved" state to represent, and a prior analysis round already reasoned through this exact
  difference (`design/reference/ANALYSIS-POSTMAN.md`, "Cố ý KHÁC — không phải thiếu sót"). **Decision:
  no dot added** — the existing sending-spinner / failed-request status dot stays as the tab's only
  status indicator.
- **The folder icon** at the tab strip's far right. **Decision: "reveal in sidebar"** — clicking it
  scrolls/expands the sidebar tree to the active request. The sidebar already does this automatically
  the moment a tab *becomes* active (`Sidebar.tsx`'s existing `revealRequest` effect + `Row`'s
  `scrollIntoView` effect); this button re-triggers the same behavior on demand, for when the user has
  since scrolled the sidebar away on their own (switching tabs wouldn't re-trigger those effects, since
  `activeRequestId` doesn't actually change in that case).

## Diagrams

None — single-component visual restyle plus one small prop-threaded signal (`revealTick`); no new
system boundary, service, or data model.

## Why This Proposal

Matches the user's explicit request (a specific reference screenshot) without importing a concept
(the unsaved dot) that contradicts DevTool's autosave design, already deliberated in an earlier
session. The "reveal in sidebar" interpretation of the folder icon was chosen over "list all open
tabs in a dropdown" because DevTool's tab strip already scrolls to reveal an off-screen tab on
selection (`RequestTabs.tsx`'s own `stripRef` effect) and Ctrl+Tab/⌘P already cover tab-switching —
an all-tabs dropdown would have been a second, mostly redundant path to the same place, whereas
"jump the sidebar back to what's open" had no existing equivalent.

## Final AC / DoD Status

| Item | Status | Notes |
|------|--------|-------|
| Active tab renders as a rounded pill, not a rectangle + top accent bar | Met | `bg-card` + `shadow-sm` + `rounded-md`; verified visually via Playwright screenshot |
| Method prefix stays color-coded + abbreviated | Met | Unchanged (`methodColor`/`methodShort`, already matched the reference) |
| Unsaved-dot semantics decided, not guessed | Met | Explicitly deferred — no dot added; decision recorded here and in `ANALYSIS-POSTMAN.md`'s cross-reference |
| Folder icon at the tab bar's end does something meaningful | Met | Wired to "reveal in sidebar" (`revealTick` prop chain: `ApiClient` → `RequestTabs`/`Sidebar`) |
| No regression to existing tab behavior (close, middle-click, context menu, scroll-into-view on select) | Met | 1243/1243 tests pass; new `Sidebar.test.tsx` case proves the `revealTick` re-scroll fires and fails without the feature (`git stash` check) |

## Remaining Risk

None identified. The "reveal in sidebar" button has no automated visual-regression coverage (component
tests only prove the `scrollIntoView` call fires again on `revealTick`, per project convention that
CSS/layout facts are verified via Playwright rather than jsdom) — acceptable given the existing
`Sidebar.test.tsx`/`RequestTabs.tsx` test patterns already draw this line the same way.

## Files Changed

- `src/components/tools/apiclient/RequestTabs.tsx` — pill-styled tabs (removed `border-r` separators
  and the top accent bar span; active tab now `bg-card`/`shadow-sm`/`rounded-md`), added the "Reveal in
  sidebar" `IconButton` with a `Folder` icon.
- `src/components/tools/apiclient/Sidebar.tsx` — added `revealTick` prop, threaded into `NodeCtx`, and
  added it to the two effects (`revealRequest` call, `Row`'s `scrollIntoView`) that need to re-fire on
  demand even when `activeRequestId` hasn't changed.
- `src/components/tools/apiclient/ApiClient.tsx` — added `revealTick` state and the `onRevealActive`
  handler wiring `RequestTabs` to `Sidebar`.
- `src/components/tools/apiclient/Sidebar.test.tsx` — new test proving the `revealTick` re-scroll.
