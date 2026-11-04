// The single CodeMirror 6 look for the app, used by the design system's
// editors (code-editor.tsx, CodeViewer, InlineCodeField) and SqlFormatter's
// custom setup. Nothing outside components/ui should build a CodeMirror
// instance without it.
//
// `codeTheme(dark, …)` passes CodeMirror's `dark` flag, which selects its
// `&light`/`&dark` base rules (it cannot see the app's `.dark` class);
// without it tooltips and selection stayed light in dark mode.
// `useCodeTheme` keeps an open editor in sync when the theme changes.

import { EditorView } from '@codemirror/view';
import { Compartment, Prec, type Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags, tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { useIsDark } from '@/hooks/useIsDark';
import { findWidget } from './code-find';

/** Code surfaces use the kit's `--mono` token, like `font-mono`. */
export const CODE_FONT = 'var(--mono)';

/**
 * Syntax colors from the `--sql-*` / `--js-*` tokens, so light/dark switches
 * in CSS without rebuilding editors. No fallbacks: the tokens always exist.
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
 * After Enter inside auto-closed brackets, the closer sits on the next line
 * and typing it would insert a duplicate. When the rest of the line is blank
 * and the next line starts with the typed bracket, the caret jumps past it
 * instead. `Prec.highest` runs before `closeBrackets`.
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
  /** Font size. Default `13px`, the same on every code surface. */
  fontSize?: string;
  /** Vertical padding inside the content column (top/bottom), in px. Default 8. */
  paddingY?: number;
  /**
   /**
    * Horizontal padding on both edges of the content, in px. Default 12, the
    * same as `px-3` on Input/Textarea. Adds to the gutter's own padding. Use
    * `0` only when an outer wrapper provides it (InlineCodeField).
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
  /** Font stack. Default `var(--mono)` (the app's Code font setting). */
  fontFamily?: string;
}

/**
 /**
  * Options with defaults filled in, separate from `codeTheme()` so the
  * defaults can be unit tested (`EditorView.theme()` returns an opaque
  * Extension).
  */
export function resolveCodeThemeOptions(opts: CodeThemeOptions = {}) {
  return {
    fontSize: opts.fontSize ?? '13px',
    paddingY: opts.paddingY ?? 8,
    paddingX: opts.paddingX ?? 12,
    gutter: opts.gutter ?? 'panel',
    activeLine: opts.activeLine ?? true,
    fill: opts.fill ?? true,
    fontFamily: opts.fontFamily ?? CODE_FONT,
  } as const;
}

/**
 * The app's editor chrome. `dark` must match the app theme — it selects
 * CodeMirror's own `&light`/`&dark` base rules, which cover surfaces this spec
 * intentionally doesn't restate.
 */
export function codeTheme(dark: boolean, opts: CodeThemeOptions = {}): Extension {
  const { fontSize, paddingY, paddingX, gutter, activeLine, fill, fontFamily } = resolveCodeThemeOptions(opts);

  return [findWidget, EditorView.theme(
    {
      '&': {
        // flex:1 rather than height:100% — percentage heights don't resolve
        // through a flex:1 parent on Windows WebView2, which makes the gutter
        // and content stack vertically instead of sitting side by side.
        ...(fill ? { flex: '1 1 0', minHeight: '0' } : {}),
        fontSize,
        fontFamily,
        backgroundColor: 'transparent',
        // Explicit line height (CodeMirror sets none, so it varied with the
        // fallback font); close to the app's `leading-relaxed`.
        lineHeight: '1.6',
        // Reset the body's negative tracking: monospace glyphs must keep
        // their exact cell width for alignment.
        letterSpacing: 'normal',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', minHeight: '0', fontFamily: 'inherit' },
      '.cm-content': {
        caretColor: 'hsl(var(--fg-c))',
        padding: `${paddingY}px ${paddingX}px`,
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(var(--fg-c))', borderLeftWidth: '1.5px' },
      // CodeMirror's own placeholder renders in the document flow. Full
      // --fg-mute: at /0.75 it fell to ~2.9:1, under WCAG AA.
      '.cm-placeholder': { color: 'hsl(var(--fg-mute-c))', fontStyle: 'normal' },

      '.cm-gutters': gutter === 'panel'
        ? {
            backgroundColor: 'hsl(var(--bg-2-c) / 0.4)',
            color: 'hsl(var(--fg-mute-c))',
            border: 'none',
            borderRight: '1px solid hsl(var(--line-c))',
          }
        : {
            backgroundColor: 'transparent',
            // Line numbers are read too; /0.5 measured 2.0:1.
            color: 'hsl(var(--fg-mute-c))',
            border: 'none',
          },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 8px' },

      // Fold gutter styled as a real toggle (larger target, hover fill).
      // `flex-start` keeps the marker on the first visual row of a
      // wrapped line, next to the actual `{`/`[`.
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

      // Folded-region placeholder ("{…}"): CodeMirror hard-codes light-only
      // colors here, so use tokens.
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

      // Selection needs focused and unfocused rules; read-only viewers show
      // the unfocused one while the user copies.
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'hsl(var(--acc-c) / 0.2)',
      },
      '.cm-selectionMatch': { backgroundColor: 'hsl(var(--acc-c) / 0.12)' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'hsl(var(--acc-c) / 0.15)',
        outline: '1px solid hsl(var(--acc-c) / 0.35)',
      },

      // Popups (tooltips, autocomplete).
      '.cm-tooltip': {
        backgroundColor: 'hsl(var(--card-c))',
        border: '1px solid hsl(var(--line-c))',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgb(0 0 0 / 0.18)',
        color: 'hsl(var(--fg-c))',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': { overflow: 'hidden' },
      '.cm-tooltip-autocomplete > ul > li': {
        // Same font size as the editor.
        padding: '4px 10px',
        fontFamily,
        fontSize,
        color: 'hsl(var(--fg-c))',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'hsl(var(--acc-c))',
        color: 'hsl(var(--acc-fg-c))',
      },
      '.cm-completionLabel': { color: 'inherit' },
      '.cm-completionDetail': { color: 'hsl(var(--fg-mute-c))' },

      // Go-to-line and other bottom panels (Find has its own widget: code-find.ts).
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
  )];
}

/**
 * VS Code Light+ / Dark+ token colors for the Text Editor tool, where files
 * should look the way they do in VS Code. Covers every tag the bundled
 * grammars (@codemirror/language-data) emit — declarations vs control flow,
 * types, functions, properties, constants, markup, tags/attributes, diff.
 * Colors come from the `--vsc-*` tokens (tokens.css), so light/dark switch in
 * CSS. Unstyled tags (operators, punctuation) inherit the editor foreground,
 * as in VS Code.
 */
export const vscodeHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.quote], color: 'var(--vsc-comment)' },
  { tag: [t.keyword, t.definitionKeyword, t.modifier, t.operatorKeyword, t.self, t.bool, t.null, t.atom], color: 'var(--vsc-keyword)' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: 'var(--vsc-control)' },
  { tag: [t.string, t.special(t.string), t.character, t.docString, t.attributeValue, t.monospace], color: 'var(--vsc-string)' },
  { tag: t.regexp, color: 'var(--vsc-regexp)' },
  { tag: t.escape, color: 'var(--vsc-escape)' },
  { tag: [t.number, t.integer, t.float, t.unit], color: 'var(--vsc-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName], color: 'var(--vsc-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.definition(t.className), t.standard(t.typeName)], color: 'var(--vsc-type)' },
  { tag: [t.variableName, t.definition(t.variableName), t.propertyName, t.definition(t.propertyName), t.labelName, t.special(t.variableName)], color: 'var(--vsc-variable)' },
  { tag: [t.constant(t.variableName), t.constant(t.propertyName), t.standard(t.variableName), t.color], color: 'var(--vsc-constant)' },
  { tag: t.tagName, color: 'var(--vsc-tag)' },
  { tag: t.angleBracket, color: 'var(--vsc-punct-mute)' },
  { tag: t.attributeName, color: 'var(--vsc-attribute)' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta, t.annotation], color: 'var(--vsc-keyword)' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--vsc-heading)', fontWeight: '700' },
  { tag: t.list, color: 'var(--vsc-keyword)' },
  { tag: t.contentSeparator, color: 'var(--vsc-punct-mute)' },
  { tag: [t.link, t.url], color: 'var(--vsc-link)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.inserted, color: 'var(--vsc-inserted)' },
  { tag: t.deleted, color: 'var(--vsc-deleted)' },
  { tag: t.changed, color: 'var(--vsc-constant)' },
  { tag: t.invalid, color: 'var(--vsc-invalid)' },
]);

/**
 * JetBrains' New UI Light / Dark editor schemes (the Text Editor's default
 * "IntelliJ" theme). Deliberately fewer hues than VS Code: identifiers,
 * operators, punctuation and type names stay the plain foreground; comments
 * are grey so they recede; keywords share one warm color. Colors come from the
 * `--ij-*` tokens (tokens.css). SQL function calls and types are marked by
 * the editor's SQL assist (they are plain identifiers in the grammar).
 */
export const intellijHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.quote], color: 'var(--ij-comment)' },
  { tag: t.docComment, color: 'var(--ij-doc-comment)', fontStyle: 'italic' },
  {
    tag: [t.keyword, t.definitionKeyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.moduleKeyword,
      t.self, t.bool, t.null, t.atom, t.standard(t.typeName)],
    color: 'var(--ij-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.character, t.docString, t.attributeValue, t.regexp, t.monospace], color: 'var(--ij-string)' },
  { tag: t.escape, color: 'var(--ij-escape)' },
  { tag: [t.number, t.integer, t.float, t.unit, t.color], color: 'var(--ij-number)' },
  { tag: [t.function(t.definition(t.variableName)), t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--ij-function)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--ij-property)' },
  { tag: [t.constant(t.variableName), t.constant(t.propertyName), t.standard(t.variableName)], color: 'var(--ij-property)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.definition(t.className)], color: 'var(--ij-type)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--ij-tag)' },
  { tag: t.attributeName, color: 'var(--ij-attribute)' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta, t.annotation], color: 'var(--ij-annotation)' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--ij-keyword)', fontWeight: '700' },
  { tag: [t.list, t.contentSeparator], color: 'var(--ij-keyword)' },
  { tag: [t.link, t.url], color: 'var(--ij-link)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.inserted, color: 'var(--ij-inserted)' },
  { tag: t.deleted, color: 'var(--ij-deleted)' },
  { tag: t.changed, color: 'var(--ij-function)' },
  { tag: t.invalid, color: 'var(--ij-invalid)' },
]);

/** The editor chrome plus the VS Code palette — the Text Editor's pair. */
export function codeThemeWithVscodeHighlight(dark: boolean, opts?: CodeThemeOptions): Extension {
  return [codeTheme(dark, opts), syntaxHighlighting(vscodeHighlight)];
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

  // Created once: the compartment and initial extension must survive
  // re-renders; later theme changes reconfigure the compartment.
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
