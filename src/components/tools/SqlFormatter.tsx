import { useCallback, useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Compartment } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { Database, Copy, Trash2, Wand2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { copyToClipboard } from '@/lib/clipboard';

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

    // Opening brace/bracket — expand unless empty
    if (ch === '{' || ch === '[') {
      let j = i + 1;
      while (j < text.length && text[j] === ' ') j++;
      const closer = ch === '{' ? '}' : ']';
      if (j < text.length && text[j] === closer) {
        result += ch + closer; i = j + 1; continue;   // keep {} or [] inline
      }
      result += ch + '\n';
      depth++;
      result += getInd();
      i++;
      while (i < text.length && text[i] === ' ') i++;
      continue;
    }

    // Closing brace/bracket
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      result = result.trimEnd() + '\n' + getInd() + ch;
      i++;
      continue;
    }

    // Comma → newline at current depth
    if (ch === ',') {
      result += ',\n' + getInd();
      i++;
      while (i < text.length && text[i] === ' ') i++;
      continue;
    }

    // Colon → ensure space after
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

// ─── CodeMirror setup ────────────────────────────────────────────────────────

// Language instances (created once, reused via Compartment)
const sqlLang = sql();
const jsLang  = javascript();

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
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

// Shared highlight style — CSS vars auto-switch with .dark
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword,               color: 'var(--sql-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.regexp], color: 'var(--sql-string)' },
  { tag: tags.comment,               color: 'var(--sql-comment)', fontStyle: 'italic' },
  { tag: tags.number,                color: 'var(--sql-number)' },
  { tag: tags.operator,              color: 'var(--sql-operator)' },
  { tag: tags.punctuation,           color: 'var(--sql-operator)' },
  { tag: tags.function(tags.name),   color: 'var(--sql-function)' },
  { tag: tags.typeName,              color: 'var(--sql-type)' },
  { tag: [tags.bool, tags.null],     color: 'var(--sql-keyword)', fontWeight: '600' },
  { tag: tags.propertyName,          color: 'var(--sql-function)' },
  { tag: tags.variableName,          color: 'hsl(var(--foreground))' },
  { tag: tags.definition(tags.variableName), color: 'var(--sql-type)' },
]);

// ─── UI helpers ──────────────────────────────────────────────────────────────

type Mode = 'sql' | 'mongo';

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors select-none',
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

  // Stable refs to avoid stale closures
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
          langConfRef.current.of(modeRef.current === 'sql' ? sqlLang : jsLang),
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
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch language + content when mode changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: langConfRef.current.reconfigure(mode === 'sql' ? sqlLang : jsLang) });
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

  const handleCopy = useCallback(() => {
    const view = viewRef.current;
    if (view) copyToClipboard(view.state.doc.toString());
  }, []);

  const handleModeChange = useCallback((next: Mode) => {
    setMode(next);
    // Save current editor content before switching
    const view = viewRef.current;
    if (!view) return;
    const val = view.state.doc.toString();
    if (modeRef.current === 'sql') setSqlRef.current(val);
    else setMongoRef.current(val);
  }, [setMode]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          SQL Formatter
        </CardTitle>
        <CardDescription>
          Format SQL queries and MongoDB pipelines with live syntax highlighting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Mode tabs + options in one row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Mode switcher */}
          <div className="flex gap-0.5 rounded-md bg-muted p-0.5 shrink-0">
            <ModeTab active={mode === 'sql'}   onClick={() => handleModeChange('sql')}>SQL</ModeTab>
            <ModeTab active={mode === 'mongo'} onClick={() => handleModeChange('mongo')}>MongoDB</ModeTab>
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-border shrink-0" />

          {/* Indent size */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Indent</span>
            <Select value={indentSize} onValueChange={(v) => setIndentSize(v as '2' | '4')}>
              <SelectTrigger className="h-7 w-[88px] text-xs">
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

        {/* Editor */}
        <div className="rounded-lg border overflow-hidden h-[380px]">
          <div
            ref={containerRef}
            className="h-full [&_.cm-editor]:h-full [&_.cm-editor]:bg-background [&_.cm-editor.cm-focused]:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 gap-1.5 text-xs">
              <Copy className="h-3 w-3" />
              Copy
            </Button>
            <Button size="sm" onClick={handleFormat} className="h-7 gap-1.5 text-xs">
              <Wand2 className="h-3 w-3" />
              Format
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
