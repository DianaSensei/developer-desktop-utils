// How the Text Editor draws code: color theme, font, size and SQL column
// hints. Persisted with the editor's other settings (store.ts) and changed
// from the status bar's "Aa" menu.
//
// The default is the "IntelliJ" look: JetBrains Mono without ligatures, the
// New UI Light/Dark palette (grey comments, plain identifiers, italic
// function names), no bracket rainbow. "VS Code" keeps Light+/Dark+ with
// bracket pair colors.

import { EditorView, scrollPastEnd } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { CODE_FONT, codeTheme, intellijHighlight, vscodeHighlight } from '@/components/ui/code-theme';
import { sqlAssist } from './sqlAssist';

export type EditorColorTheme = 'intellij' | 'vscode';
export type EditorFont = 'jetbrains-mono' | 'ibm-plex-mono' | 'fira-code' | 'app';

export interface EditorAppearance {
  theme: EditorColorTheme;
  font: EditorFont;
  /** px */
  fontSize: number;
  /** Column-name chips in SQL INSERT … SELECT / VALUES. */
  hints: boolean;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Extra space between characters, px (may be negative). */
  letterSpacing: number;
  weight: EditorWeight;
  /** `thin` = grayscale antialiasing (macOS's crisp, light look);
   *  `full` = the platform default (subpixel where available: heavier). */
  smoothing: EditorSmoothing;
  /** Space around the text: above the first line, below the last, and
   *  between the line numbers and the code. */
  padding: EditorPadding;
}

export type EditorWeight = 300 | 400 | 500;
export type EditorSmoothing = 'thin' | 'full';
export type EditorPadding = 'compact' | 'normal' | 'roomy';

export const EDITOR_THEMES: EditorColorTheme[] = ['intellij', 'vscode'];
export const EDITOR_FONTS: EditorFont[] = ['jetbrains-mono', 'ibm-plex-mono', 'fira-code', 'app'];
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const EDITOR_WEIGHTS: EditorWeight[] = [300, 400, 500];
export const EDITOR_SMOOTHING: EditorSmoothing[] = ['thin', 'full'];
export const EDITOR_PADDINGS: EditorPadding[] = ['compact', 'normal', 'roomy'];
export const MIN_LINE_HEIGHT = 1.2;
export const MAX_LINE_HEIGHT = 2.2;
export const MIN_LETTER_SPACING = -1;
export const MAX_LETTER_SPACING = 2;

/** px: [top/bottom inside the content, left of the code, right of the line numbers]. */
const PADDING: Record<EditorPadding, { y: number; x: number; gutter: number }> = {
  compact: { y: 4, x: 6, gutter: 8 },
  normal: { y: 10, x: 14, gutter: 12 },
  roomy: { y: 18, x: 22, gutter: 16 },
};

export const DEFAULT_APPEARANCE: EditorAppearance = {
  theme: 'intellij',
  font: 'jetbrains-mono',
  fontSize: 13,
  hints: true,
  lineHeight: 1.6,
  letterSpacing: 0,
  weight: 400,
  smoothing: 'thin',
  padding: 'normal',
};

const FALLBACK = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const FONT_FAMILY: Record<EditorFont, string> = {
  'jetbrains-mono': `"JetBrains Mono", ${FALLBACK}`,
  'ibm-plex-mono': `"IBM Plex Mono", ${FALLBACK}`,
  'fira-code': `"Fira Code", ${FALLBACK}`,
  app: CODE_FONT,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Rounds to one decimal (1.6, not 1.6000000000000003) within range. */
export function clampLineHeight(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_APPEARANCE.lineHeight;
  return Math.round(clamp(n, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT) * 10) / 10;
}

/** Quarter-pixel steps within range. */
export function clampLetterSpacing(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_APPEARANCE.letterSpacing;
  return Math.round(clamp(n, MIN_LETTER_SPACING, MAX_LETTER_SPACING) * 4) / 4;
}

export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_APPEARANCE.fontSize;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)));
}

/** A saved value, with anything unknown or missing back to the default. */
export function normalizeAppearance(raw: unknown): EditorAppearance {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EditorAppearance, unknown>>;
  return {
    theme: EDITOR_THEMES.includes(o.theme as EditorColorTheme) ? (o.theme as EditorColorTheme) : DEFAULT_APPEARANCE.theme,
    font: EDITOR_FONTS.includes(o.font as EditorFont) ? (o.font as EditorFont) : DEFAULT_APPEARANCE.font,
    fontSize: typeof o.fontSize === 'number' ? clampFontSize(o.fontSize) : DEFAULT_APPEARANCE.fontSize,
    hints: typeof o.hints === 'boolean' ? o.hints : DEFAULT_APPEARANCE.hints,
    lineHeight: typeof o.lineHeight === 'number' ? clampLineHeight(o.lineHeight) : DEFAULT_APPEARANCE.lineHeight,
    letterSpacing: typeof o.letterSpacing === 'number' ? clampLetterSpacing(o.letterSpacing) : DEFAULT_APPEARANCE.letterSpacing,
    weight: EDITOR_WEIGHTS.includes(o.weight as EditorWeight) ? (o.weight as EditorWeight) : DEFAULT_APPEARANCE.weight,
    smoothing: EDITOR_SMOOTHING.includes(o.smoothing as EditorSmoothing) ? (o.smoothing as EditorSmoothing) : DEFAULT_APPEARANCE.smoothing,
    padding: EDITOR_PADDINGS.includes(o.padding as EditorPadding) ? (o.padding as EditorPadding) : DEFAULT_APPEARANCE.padding,
  };
}

export function fontFamilyFor(font: EditorFont): string {
  return FONT_FAMILY[font];
}

// Theme-specific chrome on top of codeTheme. EditorView.theme beats the
// bracket colorizer's baseTheme, so the IntelliJ look can switch it off.
const intellijChrome = EditorView.theme({
  '.cm-content': { color: 'var(--ij-fg)' },
  '.cm-bracket-0, .cm-bracket-1, .cm-bracket-2': { color: 'inherit' },
  // `> span`: the syntax highlighter's own span may sit inside the mark.
  '.cm-sql-fn, .cm-sql-fn > span': { color: 'var(--ij-function)', fontStyle: 'italic' },
  '.cm-sql-type, .cm-sql-type > span': { color: 'var(--ij-keyword)' },
  '.cm-inlay-hint': { color: 'var(--ij-hint-fg)', backgroundColor: 'var(--ij-hint-bg)' },
  '.cm-gutters': { color: 'hsl(var(--fg-mute-c) / 0.8)' },
  '.cm-activeLineGutter': { color: 'hsl(var(--fg-c))' },
});

const vscodeChrome = EditorView.theme({
  '.cm-sql-fn, .cm-sql-fn > span': { color: 'var(--vsc-function)' },
});

/** Typography and spacing on top of codeTheme (EditorView.theme, added
 *  after it, so these win). */
function textExtension(a: EditorAppearance): Extension {
  const pad = PADDING[a.padding];
  const smoothing = a.smoothing === 'thin'
    ? { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }
    : { WebkitFontSmoothing: 'auto', MozOsxFontSmoothing: 'auto' };
  return EditorView.theme({
    '&': {
      lineHeight: String(a.lineHeight),
      fontWeight: String(a.weight),
      // Exact glyph outlines, no hinting tweaks between sizes.
      textRendering: 'geometricPrecision',
      // JetBrains Mono ships ligatures (=>, !=); IntelliJ leaves them off.
      ...(a.font === 'jetbrains-mono' ? { fontVariantLigatures: 'none' } : {}),
      ...smoothing,
    },
    '.cm-content': {
      letterSpacing: `${a.letterSpacing}px`,
      padding: `${pad.y}px ${pad.x}px ${pad.y}px ${pad.x}px`,
    },
    '.cm-gutters': { paddingTop: '0' },
    '.cm-lineNumbers .cm-gutterElement': { padding: `0 ${pad.gutter}px 0 ${Math.max(6, pad.gutter - 2)}px` },
  });
}

/** Everything the appearance controls, for the editor's theme compartment. */
export function appearanceExtension(dark: boolean, a: EditorAppearance): Extension {
  const pad = PADDING[a.padding];
  return [
    codeTheme(dark, { gutter: 'flush', paddingX: pad.x, paddingY: pad.y, fontSize: `${a.fontSize}px`, fontFamily: fontFamilyFor(a.font) }),
    textExtension(a),
    // Like IntelliJ / VS Code: the last line can scroll up to the middle.
    scrollPastEnd(),
    syntaxHighlighting(a.theme === 'intellij' ? intellijHighlight : vscodeHighlight),
    a.theme === 'intellij' ? intellijChrome : vscodeChrome,
    sqlAssist({ hints: a.hints }),
  ];
}
