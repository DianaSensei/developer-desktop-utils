import { useCallback, useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Compartment } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useQuickPaste } from '@/hooks/useQuickPaste';

// ─── SQL formatter ───────────────────────────────────────────────────────────

interface SqlFormatOptions {
  indentSize: number;
  uppercaseKeywords: boolean;
  collapseSpaces: boolean;
  lineBreaks: boolean;
}

const SQL_KEYWORD_RE =
  /\b(SELECT|DISTINCT|TOP|FROM|WHERE|AND|OR|NOT|IN|LIKE|ILIKE|BETWEEN|IS|NULL|EXISTS|UNION|ALL|INTERSECT|EXCEPT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|VIEW|IF|ELSE|CASE|WHEN|THEN|END|WITH|OVER|PARTITION|BY|GROUP|ORDER|HAVING|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FULL|ON|AS|ASC|DESC|NATURAL|USING|FETCH|NEXT|ONLY|RETURNING|NULLS|FIRST|LAST|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|DEFAULT|UNIQUE|CHECK|ROWS|RANGE|UNBOUNDED|PRECEDING|FOLLOWING|CURRENT|ROW|CAST|COALESCE|NULLIF|COUNT|SUM|AVG|MIN|MAX|TRUE|FALSE|FILTER|WINDOW|ARRAY|SERIAL|UUID|SHOW|EXPLAIN)\b/gi;

const SQL_BREAK_PATTERNS: Array<{ re: RegExp; indent: boolean }> = [
  { re: /^SELECT\s+DISTINCT\b/i, indent: false },
  { re: /^SELECT\b/i,            indent: false },
  { re: /^FROM\b/i,              indent: false },
  { re: /^WHERE\b/i,             indent: false },
  { re: /^GROUP\s+BY\b/i,        indent: false },
  { re: /^ORDER\s+BY\b/i,        indent: false },
  { re: /^HAVING\b/i,            indent: false },
  { re: /^LIMIT\b/i,             indent: false },
  { re: /^OFFSET\b/i,            indent: false },
  { re: /^UNION\s+ALL\b/i,       indent: false },
  { re: /^UNION\b/i,             indent: false },
  { re: /^INTERSECT\b/i,         indent: false },
  { re: /^EXCEPT\b/i,            indent: false },
  { re: /^INSERT\s+INTO\b/i,     indent: false },
  { re: /^DELETE\s+FROM\b/i,     indent: false },
  { re: /^UPDATE\b/i,            indent: false },
  { re: /^LEFT\s+OUTER\s+JOIN\b/i,  indent: false },
  { re: /^RIGHT\s+OUTER\s+JOIN\b/i, indent: false },
  { re: /^FULL\s+OUTER\s+JOIN\b/i,  indent: false },
  { re: /^LEFT\s+JOIN\b/i,       indent: false },
  { re: /^RIGHT\s+JOIN\b/i,      indent: false },
  { re: /^INNER\s+JOIN\b/i,      indent: false },
  { re: /^CROSS\s+JOIN\b/i,      indent: false },
  { re: /^FULL\s+JOIN\b/i,       indent: false },
  { re: /^NATURAL\s+JOIN\b/i,    indent: false },
  { re: /^JOIN\b/i,              indent: false },
  { re: /^ON\b/i,                indent: true  },
  { re: /^AND\b/i,               indent: true  },
  { re: /^OR\b/i,                indent: true  },
];

function applyClauseBreaks(text: string, ind: string): string {
  text = text.replace(/\s+/g, ' ').trim();
  let result = '';
  let i = 0;
  let depth = 0;

  while (i < text.length) {
    if (text[i] === '\x00') {
      const end = text.indexOf('\x00', i + 1);
      if (end !== -1) { result += text.slice(i, end + 1); i = end + 1; continue; }
    }
    const ch = text[i];
    if (ch === '(') { depth++; result += ch; i++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); result += ch; i++; continue; }
    if (depth === 0 && /[a-zA-Z]/i.test(ch)) {
      const rest = text.slice(i);
      let matched = false;
      for (const { re, indent } of SQL_BREAK_PATTERNS) {
        const m = rest.match(re);
        if (m) {
          if (result.trimEnd()) result = result.trimEnd() + '\n' + (indent ? ind : '');
          result += m[0]; i += m[0].length; matched = true; break;
        }
      }
      if (!matched) { result += ch; i++; }
      continue;
    }
    result += ch; i++;
  }
  return result;
}

function protect(code: string, re: RegExp): [string, string[]] {
  const store: string[] = [];
  return [
    code.replace(re, (m) => { const i = store.length; store.push(m); return `\x00${i}\x00`; }),
    store,
  ];
}

function restore(text: string, store: string[]): string {
  return text.replace(/\x00(\d+)\x00/g, (_, i) => store[Number(i)]);
}

function formatSQL(input: string, opts: SqlFormatOptions): string {
  const ind = ' '.repeat(opts.indentSize);
  const [text1, store] = protect(
    input,
    /('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|`[^`]*`|--[^\r\n]*|\/\*[\s\S]*?\*\/)/g
  );
  let text = text1;
  if (opts.collapseSpaces) text = text.replace(/[ \t]+/g, ' ');
  if (opts.uppercaseKeywords) text = text.replace(SQL_KEYWORD_RE, (m) => m.toUpperCase());
  if (opts.lineBreaks) text = applyClauseBreaks(text, ind);
  return restore(text, store).trim();
}

// ─── MongoDB / JS formatter ───────────────────────────────────────────────────

function formatMongo(input: string, indentSize: number): string {
  const ind = ' '.repeat(indentSize);
  const [text1, store] = protect(
    input,
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g
  );
  let text = text1.replace(/\s+/g, ' ').trim();

  let result = '';
  let depth = 0;
  const getInd = () => ind.repeat(depth);
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\x00') {
      const end = text.indexOf('\x00', i + 1);
      if (end !== -1) { result += text.slice(i, end + 1); i = end + 1; continue; }
    }

    const ch = text[i];

    if (ch === '{' || ch === '[') {
      let j = i + 1;
      while (j < text.length && text[j] === ' ') j++;
      const closer = ch === '{' ? '}' : ']';
      if (j < text.length && text[j] === closer) {
        result += ch + closer; i = j + 1; continue;
      }
      result += ch + '\n';
      depth++;
      result += getInd();
      i++;
      while (i < text.length && text[i] === ' ') i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      result = result.trimEnd() + '\n' + getInd() + ch;
      i++;
      continue;
    }

    if (ch === ',') {
      result += ',\n' + getInd();
      i++;
      while (i < text.length && text[i] === ' ') i++;
      continue;
    }

    if (ch === ':') {
      result = result.trimEnd() + ': ';
      i++;
      while (i < text.length && text[i] === ' ') i++;
      continue;
    }

    result += ch;
    i++;
  }

  return restore(result, store).trim();
}

// ─── MongoDB completions ──────────────────────────────────────────────────────

const MONGO_COMPLETIONS: Completion[] = [
  // Aggregation stages
  { label: '$addFields',   type: 'keyword', detail: 'agg stage — add/overwrite fields' },
  { label: '$bucket',      type: 'keyword', detail: 'agg stage — categorize into ranges' },
  { label: '$count',       type: 'keyword', detail: 'agg stage — count documents' },
  { label: '$facet',       type: 'keyword', detail: 'agg stage — multi-facet aggregation' },
  { label: '$fill',        type: 'keyword', detail: 'agg stage — fill missing values' },
  { label: '$geoNear',     type: 'keyword', detail: 'agg stage — geospatial proximity sort' },
  { label: '$graphLookup', type: 'keyword', detail: 'agg stage — recursive graph lookup' },
  { label: '$group',       type: 'keyword', detail: 'agg stage — group and accumulate' },
  { label: '$limit',       type: 'keyword', detail: 'agg stage — limit document count' },
  { label: '$lookup',      type: 'keyword', detail: 'agg stage — left outer join' },
  { label: '$match',       type: 'keyword', detail: 'agg stage — filter documents' },
  { label: '$merge',       type: 'keyword', detail: 'agg stage — merge into collection' },
  { label: '$out',         type: 'keyword', detail: 'agg stage — write to collection' },
  { label: '$project',     type: 'keyword', detail: 'agg stage — reshape documents' },
  { label: '$redact',      type: 'keyword', detail: 'agg stage — restrict document content' },
  { label: '$replaceRoot', type: 'keyword', detail: 'agg stage — promote subdocument to root' },
  { label: '$replaceWith', type: 'keyword', detail: 'agg stage — replace root document' },
  { label: '$sample',      type: 'keyword', detail: 'agg stage — random sample' },
  { label: '$set',         type: 'keyword', detail: 'agg stage — alias for $addFields' },
  { label: '$skip',        type: 'keyword', detail: 'agg stage — skip N documents' },
  { label: '$sort',        type: 'keyword', detail: 'agg stage — sort documents' },
  { label: '$sortByCount', type: 'keyword', detail: 'agg stage — group and sort by count' },
  { label: '$unionWith',   type: 'keyword', detail: 'agg stage — union with another collection' },
  { label: '$unset',       type: 'keyword', detail: 'agg stage — remove fields' },
  { label: '$unwind',      type: 'keyword', detail: 'agg stage — deconstruct array field' },
  // Comparison operators
  { label: '$eq',  type: 'function', detail: 'comparison — equal' },
  { label: '$ne',  type: 'function', detail: 'comparison — not equal' },
  { label: '$gt',  type: 'function', detail: 'comparison — greater than' },
  { label: '$gte', type: 'function', detail: 'comparison — greater than or equal' },
  { label: '$lt',  type: 'function', detail: 'comparison — less than' },
  { label: '$lte', type: 'function', detail: 'comparison — less than or equal' },
  { label: '$in',  type: 'function', detail: 'comparison — value in array' },
  { label: '$nin', type: 'function', detail: 'comparison — value not in array' },
  // Logical operators
  { label: '$and', type: 'function', detail: 'logical — all conditions true' },
  { label: '$or',  type: 'function', detail: 'logical — any condition true' },
  { label: '$not', type: 'function', detail: 'logical — negates condition' },
  { label: '$nor', type: 'function', detail: 'logical — no conditions true' },
  // Element operators
  { label: '$exists', type: 'function', detail: 'element — field exists check' },
  { label: '$type',   type: 'function', detail: 'element — match by BSON type' },
  { label: '$expr',   type: 'function', detail: 'element — use aggregation expression' },
  { label: '$regex',  type: 'function', detail: 'element — regex match' },
  { label: '$text',   type: 'function', detail: 'element — full-text search' },
  // Array operators
  { label: '$all',       type: 'function', detail: 'array — matches all elements' },
  { label: '$elemMatch', type: 'function', detail: 'array — element matches condition' },
  { label: '$size',      type: 'function', detail: 'array — array length equals' },
  // Update operators
  { label: '$inc',         type: 'function', detail: 'update — increment numeric field' },
  { label: '$mul',         type: 'function', detail: 'update — multiply numeric field' },
  { label: '$rename',      type: 'function', detail: 'update — rename field' },
  { label: '$currentDate', type: 'function', detail: 'update — set to current date/time' },
  { label: '$push',        type: 'function', detail: 'update — append to array' },
  { label: '$pull',        type: 'function', detail: 'update — remove matching from array' },
  { label: '$pullAll',     type: 'function', detail: 'update — remove all listed values' },
  { label: '$addToSet',    type: 'function', detail: 'update — add if not present in array' },
  { label: '$pop',         type: 'function', detail: 'update — remove first (-1) or last (1)' },
  { label: '$each',        type: 'function', detail: 'update modifier — apply to each value' },
  { label: '$position',    type: 'function', detail: 'update modifier — insert at position' },
  { label: '$slice',       type: 'function', detail: 'update modifier — truncate array' },
  { label: '$bit',         type: 'function', detail: 'update — bitwise AND/OR/XOR' },
  // Accumulator operators
  { label: '$sum',          type: 'function', detail: 'accumulator — sum values' },
  { label: '$avg',          type: 'function', detail: 'accumulator — average values' },
  { label: '$min',          type: 'function', detail: 'accumulator — minimum value' },
  { label: '$max',          type: 'function', detail: 'accumulator — maximum value' },
  { label: '$first',        type: 'function', detail: 'accumulator — first value in group' },
  { label: '$last',         type: 'function', detail: 'accumulator — last value in group' },
  { label: '$mergeObjects', type: 'function', detail: 'accumulator — merge into one object' },
  { label: '$stdDevPop',    type: 'function', detail: 'accumulator — std deviation (population)' },
  { label: '$stdDevSamp',   type: 'function', detail: 'accumulator — std deviation (sample)' },
  // Expression operators
  { label: '$cond',          type: 'function', detail: 'expression — if/then/else' },
  { label: '$ifNull',        type: 'function', detail: 'expression — null coalesce' },
  { label: '$switch',        type: 'function', detail: 'expression — switch/case' },
  { label: '$concat',        type: 'function', detail: 'expression — concatenate strings' },
  { label: '$toLower',       type: 'function', detail: 'expression — lowercase string' },
  { label: '$toUpper',       type: 'function', detail: 'expression — uppercase string' },
  { label: '$trim',          type: 'function', detail: 'expression — trim whitespace' },
  { label: '$ltrim',         type: 'function', detail: 'expression — left trim' },
  { label: '$rtrim',         type: 'function', detail: 'expression — right trim' },
  { label: '$substr',        type: 'function', detail: 'expression — substring (bytes)' },
  { label: '$substrCP',      type: 'function', detail: 'expression — substring (code points)' },
  { label: '$split',         type: 'function', detail: 'expression — split string into array' },
  { label: '$strLenCP',      type: 'function', detail: 'expression — string length' },
  { label: '$indexOfCP',     type: 'function', detail: 'expression — index of substring' },
  { label: '$dateToString',  type: 'function', detail: 'expression — format date as string' },
  { label: '$toDate',        type: 'function', detail: 'expression — convert to Date' },
  { label: '$dateDiff',      type: 'function', detail: 'expression — difference between dates' },
  { label: '$dateAdd',       type: 'function', detail: 'expression — add to date' },
  { label: '$year',          type: 'function', detail: 'expression — extract year' },
  { label: '$month',         type: 'function', detail: 'expression — extract month' },
  { label: '$dayOfMonth',    type: 'function', detail: 'expression — extract day of month' },
  { label: '$hour',          type: 'function', detail: 'expression — extract hour' },
  { label: '$minute',        type: 'function', detail: 'expression — extract minute' },
  { label: '$second',        type: 'function', detail: 'expression — extract second' },
  { label: '$convert',       type: 'function', detail: 'expression — type conversion with onError' },
  { label: '$toString',      type: 'function', detail: 'expression — convert to string' },
  { label: '$toInt',         type: 'function', detail: 'expression — convert to integer' },
  { label: '$toLong',        type: 'function', detail: 'expression — convert to long' },
  { label: '$toDouble',      type: 'function', detail: 'expression — convert to double' },
  { label: '$toDecimal',     type: 'function', detail: 'expression — convert to Decimal128' },
  { label: '$toBool',        type: 'function', detail: 'expression — convert to boolean' },
  { label: '$toObjectId',    type: 'function', detail: 'expression — convert to ObjectId' },
  { label: '$literal',       type: 'function', detail: 'expression — return value as-is' },
  { label: '$arrayElemAt',   type: 'function', detail: 'expression — element at index' },
  { label: '$arrayToObject', type: 'function', detail: 'expression — array to object' },
  { label: '$objectToArray', type: 'function', detail: 'expression — object to k/v array' },
  { label: '$concatArrays',  type: 'function', detail: 'expression — concatenate arrays' },
  { label: '$filter',        type: 'function', detail: 'expression — filter array elements' },
  { label: '$map',           type: 'function', detail: 'expression — transform array elements' },
  { label: '$reduce',        type: 'function', detail: 'expression — reduce array to value' },
  { label: '$indexOfArray',  type: 'function', detail: 'expression — index in array' },
  { label: '$isArray',       type: 'function', detail: 'expression — check if array' },
  { label: '$reverseArray',  type: 'function', detail: 'expression — reverse array' },
  { label: '$zip',           type: 'function', detail: 'expression — zip arrays together' },
  { label: '$add',           type: 'function', detail: 'expression — add numbers or dates' },
  { label: '$subtract',      type: 'function', detail: 'expression — subtract' },
  { label: '$multiply',      type: 'function', detail: 'expression — multiply' },
  { label: '$divide',        type: 'function', detail: 'expression — divide' },
  { label: '$mod',           type: 'function', detail: 'expression — modulo' },
  { label: '$abs',           type: 'function', detail: 'expression — absolute value' },
  { label: '$ceil',          type: 'function', detail: 'expression — ceiling' },
  { label: '$floor',         type: 'function', detail: 'expression — floor' },
  { label: '$round',         type: 'function', detail: 'expression — round to N decimals' },
  { label: '$sqrt',          type: 'function', detail: 'expression — square root' },
  { label: '$pow',           type: 'function', detail: 'expression — power' },
  { label: '$log',           type: 'function', detail: 'expression — logarithm' },
  { label: '$log10',         type: 'function', detail: 'expression — base-10 logarithm' },
  { label: '$exp',           type: 'function', detail: 'expression — e raised to power' },
  { label: '$trunc',         type: 'function', detail: 'expression — truncate decimal' },
];

function mongoCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\$\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: MONGO_COMPLETIONS, validFor: /^\$\w*/ };
}

// ─── CodeMirror setup (module-level — created once) ──────────────────────────

const sqlLang = sql();
const jsLang  = javascript();
// Adds MongoDB $operator completions to the JS language via its data facet.
// The data facet is scoped to this language, so completions only fire in mongo mode.
const jsLangWithMongo = [
  jsLang,
  jsLang.language.data.of({ autocomplete: mongoCompletionSource }),
];

const editorTheme = EditorView.theme({
  '&': {
    flex: '1 1 0',
    minHeight: '0',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', minHeight: '0' },
  '.cm-content': { caretColor: 'hsl(var(--foreground))', padding: '10px 0' },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--muted) / 0.4)',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRight: '1px solid hsl(var(--border))',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 8px' },
  '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--primary) / 0.08)' },
  '.cm-activeLine':       { backgroundColor: 'hsl(var(--primary) / 0.05)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--primary) / 0.2)',
  },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
  '.cm-matchingBracket': {
    backgroundColor: 'hsl(var(--primary) / 0.15)',
    outline: '1px solid hsl(var(--primary) / 0.35)',
  },
  '.cm-tooltip': {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.12)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'hsl(var(--accent))',
    color: 'hsl(var(--accent-foreground))',
  },
  '.cm-completionLabel': { color: 'hsl(var(--foreground))' },
  '.cm-completionDetail': { color: 'hsl(var(--muted-foreground))' },
});

// CSS vars auto-switch with .dark — no JS re-init needed for theme changes.
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword,               color: 'var(--sql-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.regexp], color: 'var(--sql-string)' },
  { tag: tags.comment,               color: 'var(--sql-comment)', fontStyle: 'italic' },
  { tag: tags.number,                color: 'var(--sql-number)' },
  { tag: tags.operator,              color: 'var(--sql-operator)' },
  { tag: tags.punctuation,           color: 'var(--sql-operator)' },
  // JS/MongoDB: method calls (.aggregate, .find) — purple
  { tag: tags.function(tags.name),   color: 'var(--js-method)' },
  { tag: tags.typeName,              color: 'var(--sql-type)' },
  { tag: [tags.bool, tags.null],     color: 'var(--sql-keyword)', fontWeight: '600' },
  // JS/MongoDB: object keys (field names, $operators) — amber
  { tag: tags.propertyName,          color: 'var(--js-property)' },
  // JS: variable names (db, collection) — plain foreground
  { tag: tags.variableName,          color: 'hsl(var(--foreground))' },
  // JS: defined variables (const db = ...) — teal, distinct from plain vars
  { tag: tags.definition(tags.variableName), color: 'var(--sql-function)' },
]);

// ─── UI helpers ──────────────────────────────────────────────────────────────

type Mode = 'sql' | 'mongo';

function ToggleChip({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors select-none',
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-input bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SqlFormatter() {
  const [mode, setMode]               = usePersistentState<Mode>('devtool:sql:mode', 'sql');
  const [sqlInput, setSqlInput]       = usePersistentState('devtool:sql:input', '');
  const [mongoInput, setMongoInput]   = usePersistentState('devtool:mongo:input', '');
  const [indentSize, setIndentSize]   = usePersistentState<'2' | '4'>('devtool:sql:indentSize', '2');
  const [uppercaseKw, setUppercaseKw] = usePersistentState('devtool:sql:uppercaseKw', true);
  const [collapseSpaces, setCollapseSpaces] = usePersistentState('devtool:sql:collapseSpaces', true);
  const [lineBreaks, setLineBreaks]   = usePersistentState('devtool:sql:lineBreaks', true);

  const containerRef      = useRef<HTMLDivElement>(null);
  const viewRef           = useRef<EditorView | null>(null);
  const langConfRef       = useRef(new Compartment());
  const lastDispatchedRef = useRef<string | null>(null);

  // Stable refs to avoid stale closures inside editor callbacks
  const modeRef       = useRef(mode);       modeRef.current       = mode;
  const sqlInputRef   = useRef(sqlInput);   sqlInputRef.current   = sqlInput;
  const mongoInputRef = useRef(mongoInput); mongoInputRef.current = mongoInput;
  const setSqlRef     = useRef(setSqlInput);   setSqlRef.current   = setSqlInput;
  const setMongoRef   = useRef(setMongoInput); setMongoRef.current = setMongoInput;

  // Initialise editor once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: modeRef.current === 'sql' ? sqlInputRef.current : mongoInputRef.current,
        extensions: [
          basicSetup,
          langConfRef.current.of(modeRef.current === 'sql' ? sqlLang : jsLangWithMongo),
          syntaxHighlighting(codeHighlight),
          editorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((upd) => {
            if (!upd.docChanged) return;
            const val = upd.state.doc.toString();
            if (val === lastDispatchedRef.current) return;
            if (modeRef.current === 'sql') setSqlRef.current(val);
            else setMongoRef.current(val);
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Force a layout re-measure on the next frame. In the production build the
    // editor can mount before its (lazy-loaded) flex container has a resolved
    // height; without this CodeMirror caches a 0-height viewport and renders its
    // gutter/content collapsed. In dev StrictMode's double-mount hides this.
    const raf = requestAnimationFrame(() => view.requestMeasure());

    return () => { cancelAnimationFrame(raf); view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconfigure language + swap content when mode changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langConfRef.current.reconfigure(mode === 'sql' ? sqlLang : jsLangWithMongo),
    });
    const newContent = mode === 'sql' ? sqlInputRef.current : mongoInputRef.current;
    const current = view.state.doc.toString();
    if (current === newContent) return;
    lastDispatchedRef.current = newContent;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newContent } });
    lastDispatchedRef.current = null;
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push a new string into the editor and sync persistent state
  const setEditorContent = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === text) return;
    lastDispatchedRef.current = text;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    lastDispatchedRef.current = null;
    if (modeRef.current === 'sql') setSqlRef.current(text);
    else setMongoRef.current(text);
  }, []);

  // ⌘V / Ctrl+V replaces the editor content when the editor isn't focused.
  // (When it is focused, useQuickPaste defers to CodeMirror's native paste.)
  useQuickPaste(setEditorContent);

  const handleFormat = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString().trim();
    if (!current) return;
    const formatted =
      modeRef.current === 'sql'
        ? formatSQL(current, {
            indentSize: Number(indentSize),
            uppercaseKeywords: uppercaseKw,
            collapseSpaces,
            lineBreaks,
          })
        : formatMongo(current, Number(indentSize));
    setEditorContent(formatted);
  }, [indentSize, uppercaseKw, collapseSpaces, lineBreaks, setEditorContent]);

  const handleClear = useCallback(() => setEditorContent(''), [setEditorContent]);

  const handleModeChange = useCallback((next: Mode) => {
    // Save current editor content before switching
    const view = viewRef.current;
    if (view) {
      const val = view.state.doc.toString();
      if (modeRef.current === 'sql') setSqlRef.current(val);
      else setMongoRef.current(val);
    }
    setMode(next);
  }, [setMode]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 header-premium px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Mode switcher */}
          <Segmented
            value={mode}
            onValueChange={handleModeChange}
            options={[
              { value: 'sql', label: 'SQL' },
              { value: 'mongo', label: 'MongoDB' },
            ]}
            aria-label="Formatter mode"
            className="shrink-0"
          />

          <div className="h-4 w-px bg-border shrink-0" />

          {/* Indent size */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Indent</span>
            <Select value={indentSize} onValueChange={(v) => setIndentSize(v as '2' | '4')}>
              <SelectTrigger className="h-8 w-[88px] text-xs rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 spaces</SelectItem>
                <SelectItem value="4">4 spaces</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* SQL-only options */}
          {mode === 'sql' && (
            <>
              <ToggleChip active={uppercaseKw} onClick={() => setUppercaseKw(!uppercaseKw)}>
                Uppercase keywords
              </ToggleChip>
              <ToggleChip active={collapseSpaces} onClick={() => setCollapseSpaces(!collapseSpaces)}>
                Collapse spaces
              </ToggleChip>
              <ToggleChip active={lineBreaks} onClick={() => setLineBreaks(!lineBreaks)}>
                Line breaks
              </ToggleChip>
            </>
          )}
        </div>
      </div>

      {/* Editor — fills remaining height. The mount node is absolutely positioned
          (inset-0) inside a `relative` parent so it always has a *definite*
          resolved height. A pure flex/`h-full` chain resolves to 0 height on the
          production WebKitGTK (Linux) / WebView2 (Windows) builds — it only
          appears to work in dev because React StrictMode double-mounts the editor
          after layout settles. Absolute positioning removes that dependency.
          See docs/ai/CLAUDE.md "CodeMirror 6 in flex layouts". */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          ref={containerRef}
          className="absolute inset-0 flex flex-col overflow-hidden [&_.cm-editor]:bg-background [&_.cm-editor.cm-focused]:outline-none"
        />
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t border-border bg-muted/10 px-4 py-2.5 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground rounded-lg"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </Button>
        <div className="flex items-center gap-2">
          <CopyButton
            value={() => viewRef.current?.state.doc.toString() ?? ''}
            label="Copy"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs rounded-lg"
            iconClassName="h-3 w-3"
          />
          <Button size="sm" onClick={handleFormat} className="h-8 gap-1.5 text-xs rounded-lg">
            <Wand2 className="h-3 w-3" />
            Format
          </Button>
        </div>
      </div>
    </div>
  );
}
