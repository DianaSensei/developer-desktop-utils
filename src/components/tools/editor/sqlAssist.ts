// SQL niceties for the Text Editor, the way IntelliJ shows SQL:
//
// - function calls (`SUM(`, `CONCAT_WS(`, `IF(`) and data types (`CHAR`,
//   `DECIMAL`) are marked, because the SQL grammar tags them as plain
//   identifiers — the theme colors them (`.cm-sql-fn`, `.cm-sql-type`);
// - column-name inlay hints: in `INSERT INTO t (a, b, c) SELECT x, y, z` or
//   `… VALUES (x, y, z)`, each value gets a small `a` / `b` / `c` chip in front,
//   so a long column list can be matched to its values at a glance. A value
//   that already ends in the column's name (`t.balance` for `balance`,
//   `@wallet_id` for `wallet_id`) gets none, as in IntelliJ.
//
// Only active when the document's language is SQL.

import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { language, syntaxTree } from '@codemirror/language';

/** Above this the hints are skipped: they scan the whole document on edit. */
const MAX_HINT_DOC = 2_000_000;

export interface ColumnHint {
  /** Document offset of the value's first character. */
  pos: number;
  column: string;
}

// ── Tokenizer ───────────────────────────────────────────────────────────

type TokKind = 'word' | 'ident' | 'open' | 'close' | 'comma' | 'semi' | 'other';
interface Tok { kind: TokKind; from: number; to: number; text: string }

/** SQL tokens without whitespace, comments or string contents' structure.
 *  Strings ('…', "…") are `other`; `quoted` identifiers are `ident`. */
export function tokenizeSql(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    // -- line comment (MySQL wants a space after, but be lenient), # comment.
    if ((c === '-' && src[i + 1] === '-') || c === '#') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = i;
      i++;
      while (i < n) {
        if (src[i] === '\\' && c !== '`') { i += 2; continue; }
        if (src[i] === c) {
          if (src[i + 1] === c) { i += 2; continue; } // doubled quote
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: c === '`' ? 'ident' : 'other', from: start, to: i, text: src.slice(start, i) });
      continue;
    }
    if (/[A-Za-z_@$\u0080-￿]/.test(c)) {
      const start = i;
      i++;
      while (i < n && /[\w@$\u0080-￿]/.test(src[i])) i++;
      out.push({ kind: 'word', from: start, to: i, text: src.slice(start, i) });
      continue;
    }
    const kind: TokKind = c === '(' ? 'open' : c === ')' ? 'close' : c === ',' ? 'comma' : c === ';' ? 'semi' : 'other';
    out.push({ kind, from: i, to: i + 1, text: c });
    i++;
  }
  return out;
}

// ── Column hints ────────────────────────────────────────────────────────

const SELECT_END = new Set([
  'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT',
  'WINDOW', 'INTO', 'ON', 'RETURNING', 'FOR', 'LOCK', 'OFFSET', 'FETCH',
]);
const SELECT_MODIFIERS = new Set(['DISTINCT', 'ALL', 'DISTINCTROW', 'HIGH_PRIORITY', 'STRAIGHT_JOIN', 'SQL_NO_CACHE', 'SQL_CALC_FOUND_ROWS']);

const INSERT_MODIFIERS = new Set([
  'INTO', 'IGNORE', 'LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'OR', 'REPLACE', 'ABORT', 'FAIL', 'ROLLBACK', 'OVERWRITE', 'TABLE',
]);

const isName = (t: Tok | undefined) => !!t && (t.kind === 'ident' || (t.kind === 'word' && !/^@/.test(t.text)));
const upper = (t: Tok | undefined) => (t && t.kind === 'word' ? t.text.toUpperCase() : '');
const bare = (s: string) => s.replace(/^[@`"[]+|[`"\]]+$/g, '').toLowerCase();

/** Value items between `start` (inclusive) and the first top-level token for
 *  which `stop` is true: each item's tokens, split on top-level commas. */
function splitItems(toks: Tok[], start: number, stop: (t: Tok, depth: number) => boolean): { items: Tok[][]; end: number } {
  const items: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  let i = start;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (stop(t, depth)) break;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') depth--;
    if (depth === 0 && t.kind === 'comma') { items.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) items.push(cur);
  return { items, end: i };
}

/** True when the value already names the column: `x.balance`, `@balance`,
 *  `balance`, `… AS balance`. */
function namesColumn(item: Tok[], column: string): boolean {
  const last = item[item.length - 1];
  if (!last || (last.kind !== 'word' && last.kind !== 'ident')) return false;
  return bare(last.text) === bare(column);
}

function pushHints(out: ColumnHint[], items: Tok[][], columns: string[]) {
  items.forEach((item, k) => {
    const column = columns[k];
    if (!column || !item.length || namesColumn(item, column)) return;
    out.push({ pos: item[0].from, column });
  });
}

/**
 * Inlay hints for every `INSERT … (columns) SELECT/VALUES …` in `src`.
 * Sorted by position. Pure, so it is unit tested directly.
 */
export function insertColumnHints(src: string): ColumnHint[] {
  const toks = tokenizeSql(src);
  const out: ColumnHint[] = [];
  for (let i = 0; i < toks.length; i++) {
    const kw = upper(toks[i]);
    if (kw !== 'INSERT' && kw !== 'REPLACE') continue;
    // INSERT [IGNORE | OR REPLACE | …] [INTO] schema.table (columns)
    let j = i + 1;
    while (INSERT_MODIFIERS.has(upper(toks[j]))) j++;
    if (!isName(toks[j])) continue;
    j++;
    while (toks[j]?.text === '.' && isName(toks[j + 1])) j += 2;
    if (toks[j]?.kind !== 'open') continue;
    const cols = splitItems(toks, j + 1, (t, d) => d === 0 && t.kind === 'close');
    const columns = cols.items.map((it) => (it.length === 1 && (it[0].kind === 'word' || it[0].kind === 'ident') ? it[0].text.replace(/^`|`$/g, '') : ''));
    if (!columns.length || columns.every((c) => !c)) continue;
    let k = cols.end + 1;
    const next = upper(toks[k]);
    if (next === 'VALUES' || next === 'VALUE') {
      k++;
      // ( … ), ( … ), …
      while (toks[k]?.kind === 'open') {
        const row = splitItems(toks, k + 1, (t, d) => d === 0 && t.kind === 'close');
        pushHints(out, row.items, columns);
        k = row.end + 1;
        if (toks[k]?.kind !== 'comma') break;
        k++;
      }
      i = k - 1;
    } else if (next === 'SELECT') {
      k++;
      while (SELECT_MODIFIERS.has(upper(toks[k]))) k++;
      const sel = splitItems(toks, k, (t, d) => d === 0 && (t.kind === 'semi' || t.kind === 'close' || SELECT_END.has(upper(t))));
      pushHints(out, sel.items, columns);
      i = sel.end - 1;
    }
  }
  return out;
}

// ── CodeMirror ──────────────────────────────────────────────────────────

class HintWidget extends WidgetType {
  constructor(readonly column: string) { super(); }
  eq(other: HintWidget) { return other.column === this.column; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-inlay-hint';
    el.textContent = this.column;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

/** Keywords that may touch a `(` without being a function call. */
const NOT_FUNCTIONS = new Set([
  'IN', 'VALUES', 'VALUE', 'USING', 'ON', 'AS', 'INTO', 'FROM', 'JOIN', 'WHERE', 'AND', 'OR', 'NOT', 'ANY', 'ALL', 'SOME',
  'OVER', 'TABLE', 'KEY', 'PRIMARY', 'UNIQUE', 'INDEX', 'REFERENCES', 'CHECK', 'DEFAULT', 'WITH', 'SELECT', 'UNION',
  'LIMIT', 'BY', 'THEN', 'ELSE', 'WHEN', 'CASE', 'RETURNS', 'RETURN', 'SET', 'IS', 'BETWEEN', 'LIKE', 'HAVING',
]);

const fnMark = Decoration.mark({ class: 'cm-sql-fn' });
const typeMark = Decoration.mark({ class: 'cm-sql-type' });

const isSql = (state: EditorState) => state.facet(language)?.name === 'sql';

/** Function-call and type marks for the visible ranges. */
export function sqlMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!isSql(view.state)) return builder.finish();
  const { doc } = view.state;
  const tree = syntaxTree(view.state);
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from, to,
      enter: (node) => {
        if (node.from < last) return;
        const name = node.type.name;
        if (name === 'Type') {
          last = node.to;
          builder.add(node.from, node.to, typeMark);
        } else if ((name === 'Identifier' || name === 'Builtin' || name === 'Keyword') && doc.sliceString(node.to, node.to + 1) === '(') {
          // Dialects list many functions as keywords (MySQL: SUM, IF, CAST);
          // a word right before `(` is a call unless it is clause syntax.
          if (name === 'Keyword' && NOT_FUNCTIONS.has(doc.sliceString(node.from, node.to).toUpperCase())) return;
          last = node.to;
          builder.add(node.from, node.to, fnMark);
        }
      },
    });
  }
  return builder.finish();
}

function hintDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!isSql(state) || state.doc.length > MAX_HINT_DOC) return builder.finish();
  for (const h of insertColumnHints(state.doc.toString())) {
    builder.add(h.pos, h.pos, Decoration.widget({ widget: new HintWidget(h.column), side: -1 }));
  }
  return builder.finish();
}

const marksPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = sqlMarks(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)
      || u.startState.facet(language) !== u.state.facet(language)) {
      this.decorations = sqlMarks(u.view);
    }
  }
}, { decorations: (v) => v.decorations });

const hintsPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(view: EditorView) { this.decorations = hintDecorations(view.state); }
  update(u: ViewUpdate) {
    if (u.startState.facet(language) !== u.state.facet(language)) {
      this.decorations = hintDecorations(u.state);
    } else if (u.docChanged) {
      // Keep the chips in place while typing; re-scan once the user pauses.
      this.decorations = this.decorations.map(u.changes);
      if (this.timer) clearTimeout(this.timer);
      const view = u.view;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.decorations = hintDecorations(view.state);
        view.dispatch({});
      }, 300);
    }
  }
  destroy() { if (this.timer) clearTimeout(this.timer); }
}, { decorations: (v) => v.decorations });

const assistTheme = EditorView.baseTheme({
  '.cm-inlay-hint': {
    display: 'inline-block',
    margin: '0 0.35em 0 0',
    padding: '0 0.4em',
    borderRadius: '4px',
    fontFamily: 'var(--sans)',
    fontSize: '0.82em',
    lineHeight: '1.45',
    verticalAlign: '0.06em',
    fontStyle: 'normal',
    fontWeight: '400',
    userSelect: 'none',
    pointerEvents: 'none',
    color: 'hsl(var(--fg-mute-c))',
    backgroundColor: 'hsl(var(--bg-2-c))',
  },
});

/** SQL marks, plus column hints when `hints` is on. */
export function sqlAssist({ hints }: { hints: boolean }): Extension {
  return [marksPlugin, assistTheme, hints ? hintsPlugin : []];
}
