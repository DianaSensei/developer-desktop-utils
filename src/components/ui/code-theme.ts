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

/** One mono stack for every code surface, webview-safe on all three platforms. */
export const CODE_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

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
  { tag: tags.variableName, color: 'hsl(var(--foreground))' },
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
  /** Default `12.5px`. */
  fontSize?: string;
  /** Padding inside the content column. Default `8px 0`. */
  contentPadding?: string;
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
 * The app's editor chrome. `dark` must match the app theme — it selects
 * CodeMirror's own `&light`/`&dark` base rules, which cover surfaces this spec
 * intentionally doesn't restate.
 */
export function codeTheme(dark: boolean, opts: CodeThemeOptions = {}): Extension {
  const {
    fontSize = '12.5px',
    contentPadding = '8px 0',
    gutter = 'panel',
    activeLine = true,
    fill = true,
  } = opts;

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
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', minHeight: '0', fontFamily: 'inherit' },
      '.cm-content': { caretColor: 'hsl(var(--foreground))', padding: contentPadding },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(var(--foreground))', borderLeftWidth: '1.5px' },
      // CodeMirror's own placeholder decoration — renders inline in the real
      // document flow (respects the gutter, wraps multi-line text correctly),
      // unlike a hand-rolled absolutely-positioned overlay.
      // `--muted-foreground` đã là màu mờ; đè thêm alpha 0.55 lên trên khiến
      // chữ ví dụ gần như không đọc được (đo được ở Script tab của API
      // Client). Input dùng `/75` cho placeholder — theo cùng mức đó.
      '.cm-placeholder': { color: 'hsl(var(--muted-foreground) / 0.75)', fontStyle: 'normal' },

      '.cm-gutters': gutter === 'panel'
        ? {
            backgroundColor: 'hsl(var(--muted) / 0.4)',
            color: 'hsl(var(--muted-foreground))',
            border: 'none',
            borderRight: '1px solid hsl(var(--border))',
          }
        : {
            backgroundColor: 'transparent',
            color: 'hsl(var(--muted-foreground) / 0.5)',
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
        color: 'hsl(var(--muted-foreground) / 0.75)',
        transition: 'background-color 150ms, color 150ms',
      },
      '.cm-foldGutter span:hover': {
        backgroundColor: 'hsl(var(--accent))',
        color: 'hsl(var(--accent-foreground))',
      },

      // Folded-region placeholder ("{…}"). CodeMirror's base theme hard-codes
      // light-only colors here (#eee/#ddd/#888) with no `dark` variant, so a
      // folded region in dark mode was a bright unthemed chip — replace it
      // with real tokens so it reads as part of the editor in both themes.
      '.cm-foldPlaceholder': {
        backgroundColor: 'hsl(var(--muted))',
        border: '1px solid hsl(var(--border))',
        color: 'hsl(var(--muted-foreground))',
        borderRadius: '4px',
        margin: '0 2px',
        padding: '0 4px',
      },

      '.cm-activeLine': { backgroundColor: activeLine ? 'hsl(var(--primary) / 0.05)' : 'transparent' },
      '.cm-activeLineGutter': { backgroundColor: activeLine ? 'hsl(var(--primary) / 0.08)' : 'transparent' },

      // Selection has to be stated for both the focused and unfocused case —
      // CodeMirror styles them with separate rules, and the unfocused one is
      // what a read-only viewer shows while the user copies out of it.
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'hsl(var(--primary) / 0.2)',
      },
      '.cm-selectionMatch': { backgroundColor: 'hsl(var(--primary) / 0.12)' },
      '.cm-searchMatch': { backgroundColor: 'hsl(var(--primary) / 0.18)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'hsl(var(--primary) / 0.32)' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'hsl(var(--primary) / 0.15)',
        outline: '1px solid hsl(var(--primary) / 0.35)',
      },

      // Popups. Every editor gets these — an unthemed autocomplete list was the
      // most visible symptom of the missing dark flag.
      '.cm-tooltip': {
        backgroundColor: 'hsl(var(--popover))',
        border: '1px solid hsl(var(--border))',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgb(0 0 0 / 0.18)',
        color: 'hsl(var(--foreground))',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': { overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul > li': {
        padding: '3px 8px',
        fontFamily: CODE_FONT,
        fontSize: '12px',
        color: 'hsl(var(--foreground))',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'hsl(var(--accent))',
        color: 'hsl(var(--accent-foreground))',
      },
      '.cm-completionLabel': { color: 'inherit' },
      '.cm-completionDetail': { color: 'hsl(var(--muted-foreground))' },

      // Search / goto-line panel.
      '.cm-panels': { backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--foreground))' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid hsl(var(--border))' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid hsl(var(--border))' },
      '.cm-textfield': {
        backgroundColor: 'hsl(var(--background))',
        border: '1px solid hsl(var(--border))',
        color: 'hsl(var(--foreground))',
      },
      '.cm-button': {
        backgroundColor: 'hsl(var(--secondary))',
        backgroundImage: 'none',
        border: '1px solid hsl(var(--border))',
        borderRadius: '4px',
        color: 'hsl(var(--foreground))',
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
