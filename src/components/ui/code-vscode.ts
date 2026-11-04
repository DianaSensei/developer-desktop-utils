// VS Code's editor affordances for CodeMirror, used by the Text Editor tool:
//
// - bracket pair colorization: (), [], {} colored by nesting depth with the
//   editorBracketHighlight palette, an unmatched closer in red — brackets
//   inside strings, comments and regexes are left alone;
// - indentation guides (vertical rules per indent level, the current block's
//   rule stronger);
// - indentation detection: spaces vs tabs and the indent size, guessed from
//   the file the way VS Code's `editor.detectIndentation` does.

import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

const OPEN = '([{';
const CLOSE = ')]}';
/** Node types (any grammar, any case) whose text is not code. */
const NOT_CODE = /string|comment|regexp|template|char|heredoc/i;
/** How far before the viewport the depth count starts in a huge document. */
const LOOKBEHIND = 300_000;

const marks = [0, 1, 2].map((i) => Decoration.mark({ class: `cm-bracket-${i}` }));
const unmatched = Decoration.mark({ class: 'cm-bracket-unmatched' });

/** Bracket decorations for [from, to), with depth counted from `start`. */
export function bracketDecorations(state: EditorState, from: number, to: number, start = Math.max(0, from - LOOKBEHIND)): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);
  let depth = 0;
  let pos = start;
  const cursor = state.doc.iterRange(start, to);
  while (!cursor.next().done) {
    const chunk = cursor.value;
    if (!cursor.lineBreak) {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        const open = OPEN.includes(ch);
        if (!open && !CLOSE.includes(ch)) continue;
        const at = pos + i;
        if (NOT_CODE.test(tree.resolveInner(at, 1).type.name)) continue;
        if (open) {
          if (at >= from) builder.add(at, at + 1, marks[depth % 3]);
          depth++;
        } else if (depth === 0) {
          if (at >= from) builder.add(at, at + 1, unmatched);
        } else {
          depth--;
          if (at >= from) builder.add(at, at + 1, marks[depth % 3]);
        }
      }
    }
    pos += chunk.length;
  }
  return builder.finish();
}

const bracketPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.decorations = this.build(u.view);
    }
  }
  build(view: EditorView) {
    const { from, to } = view.viewport;
    return bracketDecorations(view.state, from, to);
  }
}, { decorations: (v) => v.decorations });

const bracketTheme = EditorView.baseTheme({
  '.cm-bracket-0': { color: 'var(--vsc-bracket-1)' },
  '.cm-bracket-1': { color: 'var(--vsc-bracket-2)' },
  '.cm-bracket-2': { color: 'var(--vsc-bracket-3)' },
  '.cm-bracket-unmatched': { color: 'var(--vsc-invalid)' },
});

export function bracketPairColorization(): Extension {
  return [bracketPlugin, bracketTheme];
}

export function indentGuides(): Extension {
  return [
    indentationMarkers({
      highlightActiveBlock: true,
      markerType: 'fullScope',
      thickness: 1,
      // Hairlines that stay in the background (close to IntelliJ's indent
      // guides; VS Code's #404040 / #707070 read as rails on the app's darker
      // pane). Literal values: the extension switches light/dark itself
      // (CodeMirror's dark flag, which codeTheme sets) and splices them into
      // a gradient.
      colors: { light: '#e2e3e6', dark: '#2c2f35', activeLight: '#c3c5ca', activeDark: '#474a51' },
    }),
    // The markers are a `z-index: -1` pseudo-element; without a stacking
    // context on the content they sink below the pane's own background.
    EditorView.baseTheme({ '.cm-content': { isolation: 'isolate' } }),
  ];
}

export interface DetectedIndent {
  useTabs: boolean;
  size: number;
}

/**
 * Spaces vs tabs and the indent size, from the leading whitespace of up to
 * the first 2000 lines: tabs if more lines are tab-indented; otherwise the
 * most common increase in indentation between consecutive lines (2, 4 or 8;
 * anything else rounds to the nearest of those). `fallback` when nothing is
 * indented.
 */
const DEFAULT_INDENT: DetectedIndent = { useTabs: false, size: 4 };

export function detectIndent(text: string, fallback: DetectedIndent = DEFAULT_INDENT): DetectedIndent {
  let tabs = 0;
  let spaces = 0;
  const deltas = new Map<number, number>();
  let prev = 0;
  let n = 0;
  let start = 0;
  while (start <= text.length && n < 2000) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    n++;
    if (!line.trim()) continue;
    if (line[0] === '\t') {
      tabs++;
      prev = 0;
      continue;
    }
    let width = 0;
    while (line[width] === ' ') width++;
    if (width > 0) spaces++;
    const d = width - prev;
    // A single space more is usually alignment (JSDoc ` * `), not indent.
    if (d > 1) deltas.set(d, (deltas.get(d) ?? 0) + 1);
    prev = width;
  }
  if (tabs > spaces) return { useTabs: true, size: fallback.useTabs ? fallback.size : 4 };
  if (spaces === 0 || deltas.size === 0) return fallback;
  let best = 0;
  let bestCount = -1;
  for (const [d, c] of deltas) if (c > bestCount || (c === bestCount && d < best)) { best = d; bestCount = c; }
  const size = [4, 8].reduce((a, b) => (Math.abs(b - best) < Math.abs(a - best) ? b : a), 2);
  return { useTabs: false, size };
}
