// How the Text Editor draws code: color theme, font, size and SQL column
// hints. Persisted with the editor's other settings (store.ts) and changed
// from the status bar's "Aa" menu.
//
// The default is the "IntelliJ" look: JetBrains Mono without ligatures, the
// New UI Light/Dark palette (grey comments, plain identifiers, italic
// function names), no bracket rainbow. "VS Code" keeps Light+/Dark+ with
// bracket pair colors.

import { EditorView } from '@codemirror/view';
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
}

export const EDITOR_THEMES: EditorColorTheme[] = ['intellij', 'vscode'];
export const EDITOR_FONTS: EditorFont[] = ['jetbrains-mono', 'ibm-plex-mono', 'fira-code', 'app'];
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;

export const DEFAULT_APPEARANCE: EditorAppearance = {
  theme: 'intellij',
  font: 'jetbrains-mono',
  fontSize: 13,
  hints: true,
};

const FALLBACK = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const FONT_FAMILY: Record<EditorFont, string> = {
  'jetbrains-mono': `"JetBrains Mono", ${FALLBACK}`,
  'ibm-plex-mono': `"IBM Plex Mono", ${FALLBACK}`,
  'fira-code': `"Fira Code", ${FALLBACK}`,
  app: CODE_FONT,
};

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

/** Everything the appearance controls, for the editor's theme compartment. */
export function appearanceExtension(dark: boolean, a: EditorAppearance): Extension {
  return [
    codeTheme(dark, { gutter: 'flush', paddingX: 8, fontSize: `${a.fontSize}px`, fontFamily: fontFamilyFor(a.font) }),
    // JetBrains Mono ships ligatures (=>, !=); IntelliJ leaves them off.
    a.font === 'jetbrains-mono' ? EditorView.theme({ '&': { fontVariantLigatures: 'none' } }) : [],
    syntaxHighlighting(a.theme === 'intellij' ? intellijHighlight : vscodeHighlight),
    a.theme === 'intellij' ? intellijChrome : vscodeChrome,
    sqlAssist({ hints: a.hints }),
  ];
}
