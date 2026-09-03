// The one CodeMirror 6 look for the whole app. Consumed by the design
// system's editor components (JsonEditor/JavaScriptEditor/SqlEditor/
// TextEditor in code-editor.tsx, CodeViewer, InlineCodeField) plus
// SqlFormatter's bespoke setup — nothing outside components/ui should build a
// CodeMirror instance without going through these.
//
// Four editors had grown independently — the API Client's `CodeEditor`
// (scripts, tests, request bodies), its `ResponseViewer`, its `VarInput` URL
// bar, and the SQL Formatter — each with its own `EditorView.theme()` block and
// its own `HighlightStyle.define()`. They had drifted:
//
//   • font size 12px / 12.5px / 13px for the same kind of surface
//   • only SqlFormatter themed tooltips, autocomplete and matching brackets
//   • CodeEditor and ResponseViewer carried *different* fallback colors for the
//     same tags (`var(--sql-number, hsl(25 80% 55%))` vs `hsl(210 90% 65%)`),
//     dead code that implied two palettes but never applied, since the tokens
//     are always defined in tokens.css
//
// More seriously, none of them passed `{ dark: true }` to `EditorView.theme()`.
// CodeMirror decides between its `&light` and `&dark` base rules from that flag
// alone — it cannot see the app's `.dark` class — so every editor was pinned to
// the light base theme. Anything the app theme didn't explicitly override
// therefore stayed light in dark mode: the autocomplete tooltip
// (`&light .cm-tooltip { background: #f5f5f5 }`) and the text-selection fill
// (`&light .cm-selectionBackground { background: #d9d9d9 }`) most visibly.
//
// `codeTheme(dark, …)` fixes that by taking the flag, and `useCodeTheme` keeps
// a live editor in sync when the user flips the theme.

import { EditorView } from '@codemirror/view';
import { Compartment, Prec, type Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { useIsDark } from '@/hooks/useIsDark';

/** Every code surface uses the kit's `--mono` token (IBM Plex Mono, then the
 *  system stack) — same font `font-mono` resolves to everywhere else in the
 *  app. This used to hardcode its own system-only stack that never picked up
 *  IBM Plex Mono, so CodeMirror surfaces (Script editor, JSON viewer, address
 *  bar…) silently rendered a different monospace than the rest of the app —
 *  visible wherever the two sit side by side. */
export const CODE_FONT = 'var(--mono)';

/**
 * Syntax colors, all from the `--sql-*` / `--js-*` tokens so light/dark swap
 * happens in CSS with no editor rebuild. No hard-coded fallbacks: the tokens
 * are defined unconditionally in tokens.css, and fallbacks that never apply
 * only invite the palettes to drift apart again.
 */
export const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sql-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.regexp], color: 'var(--sql-string)' },
  { tag: tags.comment, color: 'var(--sql-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--sql-number)' },
  { tag: tags.operator, color: 'var(--sql-operator)' },
  { tag: tags.punctuation, color: 'var(--sql-operator)' },
  { tag: [tags.bool, tags.null], color: 'var(--sql-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--sql-type)' },
  // Object keys / JSON property names.
  { tag: tags.propertyName, color: 'var(--js-property)' },
  // Method calls — `.aggregate(`, `.find(`.
  { tag: tags.function(tags.name), color: 'var(--js-method)' },
  { tag: tags.variableName, color: 'hsl(var(--fg-c))' },
  { tag: tags.definition(tags.variableName), color: 'var(--sql-function)' },
]);

const SKIPPABLE_CLOSERS = new Set(['}', ']', ')']);

/**
 * CodeMirror's own bracket auto-close only "types over" a closing bracket
 * that sits *immediately* after the caret. Press Enter right after an
 * auto-inserted `{` — a near-universal habit while writing JSON/JS — and the
 * closer lands on its own line below; typing `}` no longer finds it adjacent,
 * so it inserts a second, duplicate closer instead of reusing the existing
 * one (`{\n\n}` becomes `{\n}\n}` after typing `}`).
 *
 * This extension closes that gap: when the rest of the current line is blank
 * and the next line's first non-blank character is the bracket just typed,
 * the caret jumps past it instead of inserting anything. `Prec.highest` runs
 * it before `closeBrackets`' own same-line handling, which it leaves alone.
 */
export const smartBracketSkip = Prec.highest(EditorView.inputHandler.of((view, from, to, insert) => {
  if (from !== to || insert.length !== 1 || !SKIPPABLE_CLOSERS.has(insert)) return false;
  const { state } = view;
  const line = state.doc.lineAt(from);
  if (state.doc.sliceString(from, line.to).trim() !== '') return false;
  if (line.number >= state.doc.lines) return false;
  const nextLine = state.doc.line(line.number + 1);
  const nextText = state.doc.sliceString(nextLine.from, nextLine.to);
  const leading = nextText.length - nextText.trimStart().length;
  if (nextText[leading] !== insert) return false;
  view.dispatch({ selection: { anchor: nextLine.from + leading + 1 }, scrollIntoView: true, userEvent: 'input.type' });
  return true;
}));

export interface CodeThemeOptions {
  /**
   * Default `13px`. Was three different values (12 / 12.5 / 13) across the
   * editable editor, the response viewer, SQL Formatter and Markdown Preview
   * — invisible until two of them sit side by side (a request body editor
   * next to its response viewer is the app's single most common split-pane),
   * where the mismatch reads as sloppiness rather than as a deliberate
   * choice. One size for every code surface now; a call site overrides only
   * for a documented reason (there currently are none).
   */
  fontSize?: string;
  /** Vertical padding inside the content column (top/bottom), in px. Default 8. */
  paddingY?: number;
  /**
   * Horizontal padding on BOTH edges of the content column, in px. Default 12
   * — the app's own `px-3` control padding (`Input`, `Textarea`), so a code
   * surface breathes the same amount as every other form control it sits next
   * to instead of running its own tighter rhythm.
   *
   * Every code surface used to hard-code this at 0: `.cm-content`'s CSS
   * `padding` shorthand only ever carried a vertical value ('8px 0', '6px 0',
   * '10px 0'), so text on every editable and read-only surface in the app —
   * scripts, JSON/JS/SQL bodies, API responses — ran edge-to-edge against the
   * pane border and the scrollbar, with nothing between the last character of
   * a long line and where the eye expects a margin to start. That reads as
   * cramped no matter how good the syntax colors are.
   *
   * Left space stacks with the line-number gutter's own padding rather than
   * replacing it — a slightly wider gutter-to-code gap than a bare `0` is the
   * intended trade, not a rounding error. Set to `0` only for a surface with
   * its own outer padding supplying it instead (`InlineCodeField`, whose
   * `px-3` wrapper already does this).
   */
  paddingX?: number;
  /**
   * `panel` (default) tints the gutter and draws a divider — for an editor that
   * owns a bordered box. `flush` leaves it transparent and borderless, for a
   * viewer sitting directly on a pane background.
   */
  gutter?: 'panel' | 'flush';
  /** Highlights the caret's line. Off for read-only viewers. Default true. */
  activeLine?: boolean;
  /** `false` drops the flex sizing, for a single-line field. Default true. */
  fill?: boolean;
}

/**
 * Options with every default filled in. Split out from `codeTheme()` itself
 * so the defaults — the one thing a future edit is likely to change without
 * meaning to touch every code surface in the app at once — are checkable
 * without mounting a real CodeMirror instance (`EditorView.theme()`'s return
 * value is an opaque `StyleModule`-backed `Extension`; there's nothing in it
 * a plain unit test can read).
 */
export function resolveCodeThemeOptions(opts: CodeThemeOptions = {}) {
  return {
    fontSize: opts.fontSize ?? '13px',
    paddingY: opts.paddingY ?? 8,
    paddingX: opts.paddingX ?? 12,
    gutter: opts.gutter ?? 'panel',
    activeLine: opts.activeLine ?? true,
    fill: opts.fill ?? true,
  } as const;
}

/**
 * The app's editor chrome. `dark` must match the app theme — it selects
 * CodeMirror's own `&light`/`&dark` base rules, which cover surfaces this spec
 * intentionally doesn't restate.
 */
export function codeTheme(dark: boolean, opts: CodeThemeOptions = {}): Extension {
  const { fontSize, paddingY, paddingX, gutter, activeLine, fill } = resolveCodeThemeOptions(opts);

  return EditorView.theme(
    {
      '&': {
        // flex:1 rather than height:100% — percentage heights don't resolve
        // through a flex:1 parent on Windows WebView2, which makes the gutter
        // and content stack vertically instead of sitting side by side.
        ...(fill ? { flex: '1 1 0', minHeight: '0' } : {}),
        fontSize,
        fontFamily: CODE_FONT,
        backgroundColor: 'transparent',
        // 1.6, not the browser's un-set default. CodeMirror never declared a
        // line-height, so every editor rendered whatever the resolved font
        // stack's own metrics happened to produce — different for IBM Plex
        // Mono than for its fallbacks (Menlo, Consolas, Liberation Mono), so
        // a user on Windows/Linux who never gets the web font got a visibly
        // different rhythm than one on macOS, without either being a choice
        // anyone made. A tool whose job is showing rows of JSON/log/response
        // text also benefits from more air between lines than a code editor
        // optimized for keeping a whole file on screen — 1.6 sits close to
        // the app's own `leading-relaxed` (1.625) prose rhythm rather than a
        // typical IDE's tighter ~1.35–1.5.
        lineHeight: '1.6',
        // The body-wide `-0.006em` tracking (globals.css, tuned for
        // proportional prose) was never reset here, so it cascaded into every
        // CodeMirror instance in the app — editors, the response viewer, the
        // URL bar. Negative tracking on a MONOSPACE font is a correctness
        // bug, not a style choice: the entire point of the typeface is that
        // every glyph is exactly one cell wide, which is what makes a JSON
        // object's keys, an aligned diff, or a column of numbers line up.
        // Shrinking that cell by a fraction of a pixel doesn't look
        // different at a glance, but it is the thing a "something's subtly
        // off" reaction is reacting to.
        letterSpacing: 'normal',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', minHeight: '0', fontFamily: 'inherit' },
      '.cm-content': {
        caretColor: 'hsl(var(--fg-c))',
        padding: `${paddingY}px ${paddingX}px`,
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(var(--fg-c))', borderLeftWidth: '1.5px' },
      // CodeMirror's own placeholder decoration — renders inline in the real
      // document flow (respects the gutter, wraps multi-line text correctly),
      // unlike a hand-rolled absolutely-positioned overlay.
      // `--muted-foreground` đã là màu mờ; đè thêm alpha 0.55 lên trên khiến
      // chữ ví dụ gần như không đọc được (đo được ở Script tab của API
      // Client). Input dùng `/75` cho placeholder — theo cùng mức đó.
      '.cm-placeholder': { color: 'hsl(var(--fg-mute-c) / 0.75)', fontStyle: 'normal' },

      '.cm-gutters': gutter === 'panel'
        ? {
            backgroundColor: 'hsl(var(--bg-2-c) / 0.4)',
            color: 'hsl(var(--fg-mute-c))',
            border: 'none',
            borderRight: '1px solid hsl(var(--line-c))',
          }
        : {
            backgroundColor: 'transparent',
            color: 'hsl(var(--fg-mute-c) / 0.5)',
            border: 'none',
          },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 8px' },

      // Fold gutter: the default glyphs ("⌄"/"›") are tiny, low-contrast, and
      // have no click feedback — style them as a real toggle affordance
      // (comfortable target, hover fill) matching IconButton elsewhere.
      //
      // `alignItems: 'flex-start'`, not 'center': a gutter element is as tall
      // as the *entire* wrapped line it marks (matching `.cm-lineNumbers`, so
      // the row numbers/markers stay aligned with the content next to them).
      // When the line a fold starts on is long enough to wrap into several
      // visual rows, centering the marker in that tall box strands it
      // mid-paragraph, nowhere near the actual `{`/`[` on the first visual
      // row — flex-start pins it there instead.
      '.cm-foldGutter .cm-gutterElement': { display: 'flex', alignItems: 'flex-start' },
      '.cm-foldGutter span': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '15px',
        height: '15px',
        borderRadius: '4px',
        color: 'hsl(var(--fg-mute-c) / 0.75)',
        transition: 'background-color var(--dur-fast) var(--ease-out-soft), color var(--dur-fast) var(--ease-out-soft)',
      },
      '.cm-foldGutter span:hover': {
        backgroundColor: 'hsl(var(--acc-c))',
        color: 'hsl(var(--acc-fg-c))',
      },

      // Folded-region placeholder ("{…}"). CodeMirror's base theme hard-codes
      // light-only colors here (#eee/#ddd/#888) with no `dark` variant, so a
      // folded region in dark mode was a bright unthemed chip — replace it
      // with real tokens so it reads as part of the editor in both themes.
      '.cm-foldPlaceholder': {
        backgroundColor: 'hsl(var(--bg-2-c))',
        border: '1px solid hsl(var(--line-c))',
        color: 'hsl(var(--fg-mute-c))',
        borderRadius: '4px',
        margin: '0 2px',
        padding: '0 4px',
      },

      '.cm-activeLine': { backgroundColor: activeLine ? 'hsl(var(--acc-c) / 0.05)' : 'transparent' },
      '.cm-activeLineGutter': { backgroundColor: activeLine ? 'hsl(var(--acc-c) / 0.08)' : 'transparent' },

      // Selection has to be stated for both the focused and unfocused case —
      // CodeMirror styles them with separate rules, and the unfocused one is
      // what a read-only viewer shows while the user copies out of it.
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'hsl(var(--acc-c) / 0.2)',
      },
      '.cm-selectionMatch': { backgroundColor: 'hsl(var(--acc-c) / 0.12)' },
      '.cm-searchMatch': { backgroundColor: 'hsl(var(--acc-c) / 0.18)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'hsl(var(--acc-c) / 0.32)' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'hsl(var(--acc-c) / 0.15)',
        outline: '1px solid hsl(var(--acc-c) / 0.35)',
      },

      // Popups. Every editor gets these — an unthemed autocomplete list was the
      // most visible symptom of the missing dark flag.
      '.cm-tooltip': {
        backgroundColor: 'hsl(var(--card-c))',
        border: '1px solid hsl(var(--line-c))',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgb(0 0 0 / 0.18)',
        color: 'hsl(var(--fg-c))',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': { overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul > li': {
        // 4px/10px, and the SAME `fontSize` the editor itself resolved to —
        // this used to hardcode '3px 8px' + a flat 12px regardless of what
        // size the calling editor picked, so once editors moved to a shared
        // 13px default the autocomplete list was quietly smaller than the
        // code you were typing into it.
        padding: '4px 10px',
        fontFamily: CODE_FONT,
        fontSize,
        color: 'hsl(var(--fg-c))',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'hsl(var(--acc-c))',
        color: 'hsl(var(--acc-fg-c))',
      },
      '.cm-completionLabel': { color: 'inherit' },
      '.cm-completionDetail': { color: 'hsl(var(--fg-mute-c))' },

      // Search / goto-line panel.
      '.cm-panels': { backgroundColor: 'hsl(var(--card-c))', color: 'hsl(var(--fg-c))' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid hsl(var(--line-c))' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid hsl(var(--line-c))' },
      '.cm-textfield': {
        backgroundColor: 'hsl(var(--bg-c))',
        border: '1px solid hsl(var(--line-c))',
        color: 'hsl(var(--fg-c))',
      },
      '.cm-button': {
        backgroundColor: 'hsl(var(--bg-2-c))',
        backgroundImage: 'none',
        border: '1px solid hsl(var(--line-c))',
        borderRadius: '4px',
        color: 'hsl(var(--fg-c))',
      },
    },
    { dark },
  );
}

/** `codeTheme` + the shared highlight style — the usual pair. */
export function codeThemeWithHighlight(dark: boolean, opts?: CodeThemeOptions): Extension {
  return [codeTheme(dark, opts), syntaxHighlighting(codeHighlight)];
}

/**
 * Wires an editor to the app theme.
 *
 * Returns the extension to place in the initial `EditorState`, and reconfigures
 * that slot whenever the user flips light/dark — so an open editor restyles in
 * place instead of keeping whichever theme it was born with.
 *
 * ```ts
 * const theme = useCodeTheme(viewRef, { gutter: 'flush' });
 * // …then include `theme.extension` in EditorState.create({ extensions: [...] })
 * ```
 *
 * `opts` is read fresh on each reconfigure, so it does not need to be memoized.
 */
export function useCodeTheme(
  viewRef: React.RefObject<EditorView | null>,
  opts: CodeThemeOptions = {},
): { extension: Extension } {
  const dark = useIsDark();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Built once, lazily — the compartment identity and the extension the editor
  // is constructed with must both survive re-renders. Later theme flips go
  // through the compartment in the effect below.
  const slot = useRef<{ compartment: Compartment; extension: Extension } | null>(null);
  if (slot.current === null) {
    const compartment = new Compartment();
    slot.current = { compartment, extension: compartment.of(codeThemeWithHighlight(dark, opts)) };
  }
  const { compartment, extension } = slot.current;

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartment.reconfigure(codeThemeWithHighlight(dark, optsRef.current)),
    });
  }, [dark, compartment, viewRef]);

  return { extension };
}
