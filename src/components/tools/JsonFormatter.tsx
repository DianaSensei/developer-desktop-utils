import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
import { PaneHeader, ToolToolbar } from '@/components/ui/tool-layout';
import { CodeViewer, JsonSyntaxEditor } from '@/design-system';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  FileJson,
  FoldVertical,
  UnfoldVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchInput } from '@/components/ui/search-input';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';
import MESSAGES from '@/components/tools/JsonFormatter.messages';
import { useInputHistory } from '@/hooks/useInputHistory';
import { SplitPane } from '@/components/ui/split-pane';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Mode = 'beautify' | 'string' | 'minify';

export const INDENT_OPTIONS: Record<string, { unit: string; size: number }> = {
  '2': { unit: '  ', size: 2 },
  '4': { unit: '    ', size: 4 },
  tab: { unit: '\t', size: 4 },
};

// --- Quote normalization & lenient parsing ---------------------------------
function normalizeSmartQuotes(text: string) {
  return text
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛‹›]/g, "'");
}

// Tolerant JSON parser: accepts standard JSON plus single quotes, unquoted
// object keys, trailing commas, and // and /* */ comments.
function parseLenient(text: string): JsonValue {
  const src = normalizeSmartQuotes(text);
  const n = src.length;
  let i = 0;

  const fail = (message: string): never => {
    throw new Error(`${message} (position ${i})`);
  };

  const skipWs = () => {
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
        i++;
      } else if (c === '/' && src[i + 1] === '/') {
        i += 2;
        while (i < n && src[i] !== '\n') i++;
      } else if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
      } else {
        break;
      }
    }
  };

  // A quote only really closes a string when followed by a delimiter or the
  // end of input; otherwise it's an unescaped quote inside the value.
  const isStringEnd = (): boolean => {
    const saved = i;
    skipWs();
    const c = src[i];
    i = saved;
    return c === undefined || c === ',' || c === '}' || c === ']' || c === ':';
  };

  const parseString = (): string => {
    const quote = src[i++];
    let result = '';
    while (i < n) {
      const c = src[i++];
      if (c === quote) {
        if (isStringEnd()) return result;
        result += c;
        continue;
      }
      if (c === '\\') {
        const e = src[i++];
        switch (e) {
          case '"': result += '"'; break;
          case "'": result += "'"; break;
          case '\\': result += '\\'; break;
          case '/': result += '/'; break;
          case 'b': result += '\b'; break;
          case 'f': result += '\f'; break;
          case 'n': result += '\n'; break;
          case 'r': result += '\r'; break;
          case 't': result += '\t'; break;
          case 'u': {
            result += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
            i += 4;
            break;
          }
          default: result += e ?? '';
        }
      } else {
        result += c;
      }
    }
    return fail('Unterminated string');
  };

  const parseUnquotedKey = (): string => {
    const start = i;
    while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
    if (i === start) fail('Expected property name');
    return src.slice(start, i);
  };

  const parseNumber = (): number => {
    const start = i;
    if (src[i] === '-' || src[i] === '+') i++;
    while (i < n && /[0-9]/.test(src[i])) i++;
    if (src[i] === '.') {
      i++;
      while (i < n && /[0-9]/.test(src[i])) i++;
    }
    if (src[i] === 'e' || src[i] === 'E') {
      i++;
      if (src[i] === '+' || src[i] === '-') i++;
      while (i < n && /[0-9]/.test(src[i])) i++;
    }
    const value = Number(src.slice(start, i));
    if (Number.isNaN(value)) fail('Invalid number');
    return value;
  };

  const parseValue = (): JsonValue => {
    skipWs();
    const c = src[i];
    if (c === undefined) return fail('Unexpected end of input');
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"' || c === "'") return parseString();
    if (c === '-' || c === '+' || (c >= '0' && c <= '9')) return parseNumber();
    if (src.startsWith('true', i)) { i += 4; return true; }
    if (src.startsWith('false', i)) { i += 5; return false; }
    if (src.startsWith('null', i)) { i += 4; return null; }
    return fail(`Unexpected token "${c}"`);
  };

  const parseObject = (): JsonValue => {
    i++;
    const obj: { [key: string]: JsonValue } = {};
    skipWs();
    if (src[i] === '}') { i++; return obj; }
    for (;;) {
      skipWs();
      const c = src[i];
      const key = c === '"' || c === "'" ? parseString() : parseUnquotedKey();
      skipWs();
      if (src[i] !== ':') fail('Expected ":"');
      i++;
      obj[key] = parseValue();
      skipWs();
      if (src[i] === ',') {
        i++;
        skipWs();
        if (src[i] === '}') { i++; return obj; }
        continue;
      }
      if (src[i] === '}') { i++; return obj; }
      return fail('Expected "," or "}"');
    }
  };

  const parseArray = (): JsonValue => {
    i++;
    const arr: JsonValue[] = [];
    skipWs();
    if (src[i] === ']') { i++; return arr; }
    for (;;) {
      arr.push(parseValue());
      skipWs();
      if (src[i] === ',') {
        i++;
        skipWs();
        if (src[i] === ']') { i++; return arr; }
        continue;
      }
      if (src[i] === ']') { i++; return arr; }
      return fail('Expected "," or "]"');
    }
  };

  skipWs();
  const value = parseValue();
  skipWs();
  if (i < n) fail('Unexpected trailing characters');
  return value;
}

function tryParseStructured(text: string): JsonValue | undefined {
  try {
    const value = parseLenient(text);
    if (value !== null && typeof value === 'object') return value;
  } catch {
    // not structured JSON
  }
  return undefined;
}

// Repeatedly unwrap a string whose contents are themselves JSON (handles a
// value that was stringified one or more times).
function unwrapStructured(value: JsonValue): JsonValue {
  let current = value;
  for (let depth = 0; typeof current === 'string' && depth < 5; depth++) {
    const inner = tryParseStructured(current);
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}

// Unescape a JSON string value (handle \" and other escapes)
function unescapeJsonString(str: string): string {
  let result = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const next = str[i + 1];
      switch (next) {
        case '"': result += '"'; i += 2; break;
        case "'": result += "'"; i += 2; break;
        case '\\': result += '\\'; i += 2; break;
        case '/': result += '/'; i += 2; break;
        case 'b': result += '\b'; i += 2; break;
        case 'f': result += '\f'; i += 2; break;
        case 'n': result += '\n'; i += 2; break;
        case 'r': result += '\r'; i += 2; break;
        case 't': result += '\t'; i += 2; break;
        case 'u': {
          result += String.fromCharCode(parseInt(str.slice(i + 2, i + 6), 16));
          i += 6;
          break;
        }
        default: result += next; i += 2;
      }
    } else {
      result += str[i];
      i++;
    }
  }
  return result;
}

// Parse, also accepting JSON that arrives as an escaped string — both the
// quoted form ("{\"a\":1}") and the naked form ({\"a\":1} without surrounding
// quotes), including multi-line payloads.
export function parseInput(text: string): JsonValue {
  const trimmed = text.trim();
  try {
    return unwrapStructured(parseLenient(trimmed));
  } catch (error) {
    // Treat the input as the body of a JSON string literal: strip optional
    // outer quotes, unescape, and parse.
    let body = trimmed;
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      body = trimmed.slice(1, -1);
    }

    // Try unescaping the body (handles \" and other escapes)
    const unescaped = unescapeJsonString(body);
    try {
      const inner = tryParseStructured(unescaped);
      if (inner !== undefined) return inner;
    } catch {
      // fall through to original error
    }
    throw error;
  }
}

// --- Serialization ---------------------------------------------------------
export function quoteText(value: string, quote: string) {
  let out = quote;
  for (const ch of value) {
    if (ch === quote) out += '\\' + quote;
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch < ' ') out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + quote;
}

export function serialize(value: JsonValue, indentUnit: string, quote: string): string {
  const nl = indentUnit ? '\n' : '';
  const sep = indentUnit ? ': ' : ':';

  const rec = (val: JsonValue, depth: number): string => {
    const pad = indentUnit ? indentUnit.repeat(depth + 1) : '';
    const padEnd = indentUnit ? indentUnit.repeat(depth) : '';

    if (val === null) return 'null';
    if (typeof val === 'string') return quoteText(val, quote);
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);

    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      const items = val.map((item) => pad + rec(item, depth + 1));
      return '[' + nl + items.join(',' + nl) + nl + padEnd + ']';
    }

    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const items = keys.map((key) => pad + quoteText(key, quote) + sep + rec(val[key], depth + 1));
    return '{' + nl + items.join(',' + nl) + nl + padEnd + '}';
  };

  return rec(value, 0);
}

// --- Tree helpers ----------------------------------------------------------
type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

function valueType(value: JsonValue): ValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as ValueType;
}

function buildChildPath(parentPath: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${quoteText(key, '"')}]`;
}

function collectContainerPaths(value: JsonValue, path = '$', acc: string[] = []): string[] {
  if (value !== null && typeof value === 'object') {
    acc.push(path);
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectContainerPaths(item, `${path}[${index}]`, acc));
    } else {
      for (const key of Object.keys(value)) collectContainerPaths(value[key], buildChildPath(path, key), acc);
    }
  }
  return acc;
}

// JSON syntax colors reuse the SQL hues for the same concepts
// (strings, numbers, types); see tokens.css.
const TYPE_CLASS: Record<string, string> = {
  string: 'text-[var(--sql-string)]',
  number: 'text-[var(--sql-number)]',
  boolean: 'text-[var(--sql-type)]',
  null: 'text-[var(--json-null)]',
};

// --- Flattened line model for the beautify view ----------------------------
type LineKind = 'primitive' | 'open' | 'close' | 'collapsed' | 'empty';

interface FlatLine {
  no: number;
  depth: number;
  path: string;
  containerPath: string;
  kind: LineKind;
  name?: string;
  valueType?: ValueType;
  display?: string;
  bracketOpen?: string;
  bracketClose?: string;
  count?: number;
  isArray?: boolean;
  isLast: boolean;
}

function flattenJson(root: JsonValue, quote: string, collapsed: Set<string>, forceExpand: boolean): FlatLine[] {
  const lines: FlatLine[] = [];
  let counter = 0;

  const primitiveDisplay = (value: JsonValue, type: ValueType) => {
    if (type === 'string') return quoteText(value as string, quote);
    if (value === null) return 'null';
    return String(value);
  };

  const walk = (name: string | undefined, value: JsonValue, path: string, parentPath: string, depth: number, isLast: boolean) => {
    const type = valueType(value);

    if (type !== 'object' && type !== 'array') {
      lines.push({ no: ++counter, depth, path, containerPath: parentPath, kind: 'primitive', name, valueType: type, display: primitiveDisplay(value, type), isLast });
      return;
    }

    const isArray = type === 'array';
    const bracketOpen = isArray ? '[' : '{';
    const bracketClose = isArray ? ']' : '}';
    const entries = isArray
      ? (value as JsonValue[]).map((child, index) => ({ key: String(index), label: undefined as string | undefined, child }))
      : Object.keys(value as object).map((key) => ({ key, label: key, child: (value as { [k: string]: JsonValue })[key] }));
    const count = entries.length;

    if (count === 0) {
      lines.push({ no: ++counter, depth, path, containerPath: parentPath, kind: 'empty', name, bracketOpen, bracketClose, count, isArray, isLast });
      return;
    }

    if (!forceExpand && collapsed.has(path)) {
      lines.push({ no: ++counter, depth, path, containerPath: path, kind: 'collapsed', name, bracketOpen, bracketClose, count, isArray, isLast });
      return;
    }

    lines.push({ no: ++counter, depth, path, containerPath: path, kind: 'open', name, bracketOpen, count, isArray, isLast: false });
    entries.forEach((entry, index) => {
      const childPath = isArray ? `${path}[${entry.key}]` : buildChildPath(path, entry.key);
      walk(entry.label, entry.child, childPath, path, depth + 1, index === entries.length - 1);
    });
    lines.push({ no: ++counter, depth, path, containerPath: path, kind: 'close', bracketClose, isLast });
  };

  walk(undefined, root, '$', '', 0, true);
  return lines;
}

/** Fixed tree row height (px), matching `h-5 leading-5`. Rows never wrap
 *  (`whitespace-pre`), so windowing is a single division. */
const ROW_H = 20;
/** Non-`Error` failure (rare); translated for display. */
const INVALID = '\u0000invalid';
/** Extra rows rendered above and below the viewport for fast scrolling. */
const OVERSCAN = 30;

function lineMatches(line: FlatLine, lowerQuery: string) {
  if (!lowerQuery) return false;
  if (line.name && line.name.toLowerCase().includes(lowerQuery)) return true;
  if (line.kind === 'primitive' && line.display && line.display.toLowerCase().includes(lowerQuery)) return true;
  return line.path.toLowerCase().includes(lowerQuery);
}

export function JsonFormatter() {
  const sdk = usePluginSdkFor('json');
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  const quickPasteHint = useQuickPasteHint();
  const [input, setInput] = usePluginState(sdk, 'json:input', '', { legacyKey: 'devtool:json:input' });
  const [mode, setMode] = usePluginState<Mode>(sdk, 'json:mode', 'beautify', { legacyKey: 'devtool:json:mode' });
  const [indentKey, setIndentKey] = usePluginState(sdk, 'json:indent', '2', { legacyKey: 'devtool:json:indent' });
  const [quote, setQuote] = usePluginState(sdk, 'json:quote', '"', { legacyKey: 'devtool:json:quote' });
  const [showInput, setShowInput] = usePluginState(sdk, 'json:showInput', true, { legacyKey: 'devtool:json:showInput' });

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState('');
  const [hoveredContainer, setHoveredContainer] = useState('');

  useQuickPaste((text) => setInput(normalizeSmartQuotes(text)));
  useInputHistory(input, setInput);

  const indent = INDENT_OPTIONS[indentKey] ?? INDENT_OPTIONS['2'];
  const forceExpand = query.trim().length > 0;
  const lowerQuery = query.trim().toLowerCase();

  // Parsing + flattening + serialization all key off the raw input and run on
  // every keystroke. Defer the input so the editor stays responsive while
  // parsing a large document; the derived views update at low priority.
  const deferredInput = useDeferredValue(input);
  const parsed = useMemo<{ value: JsonValue | undefined; error: string; strict: boolean }>(() => {
    if (!deferredInput.trim()) return { value: undefined, error: '', strict: true };
    try {
      const value = parseInput(deferredInput);
      // The lenient parser also reads trailing commas, unquoted keys,
      // comments and single quotes. People open a formatter to check JSON,
      // so "valid" is only claimed when the input itself is strict JSON.
      let strict = true;
      try { JSON.parse(deferredInput); } catch { strict = false; }
      return { value, error: '', strict };
    } catch (err) {
      return { value: undefined, error: err instanceof Error ? err.message : INVALID, strict: false };
    }
  }, [deferredInput]);

  const containerPaths = useMemo(
    () => (parsed.value !== undefined ? collectContainerPaths(parsed.value) : []),
    [parsed.value]
  );

  const lines = useMemo(
    () => (parsed.value !== undefined ? flattenJson(parsed.value, quote, collapsed, forceExpand) : []),
    [parsed.value, quote, collapsed, forceExpand]
  );

  const beautified = useMemo(
    () => (parsed.value !== undefined ? serialize(parsed.value, indent.unit, quote) : ''),
    [parsed.value, indent.unit, quote]
  );
  const minified = useMemo(
    () => (parsed.value !== undefined ? serialize(parsed.value, '', quote) : ''),
    [parsed.value, quote]
  );
  const jsonString = useMemo(
    () => (parsed.value !== undefined ? quoteText(serialize(parsed.value, '', '"'), quote) : ''),
    [parsed.value, quote]
  );

  // ── Windowing: only visible rows (plus overscan) are rendered ─────────
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, [parsed.value, mode]);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);

  const scrollToIndex = (i: number) => {
    const el = treeRef.current;
    if (!el || i < 0) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  // ── Search: count and jump to matches ──────────────────────────────────
  const matchIndexes = useMemo(
    () => (lowerQuery ? lines.flatMap((line, i) => (line.kind !== 'close' && lineMatches(line, lowerQuery) ? [i] : [])) : []),
    [lines, lowerQuery],
  );
  const [matchCursor, setMatchCursor] = useState(0);
  useEffect(() => setMatchCursor(0), [lowerQuery]);
  const jumpToMatch = (dir: 1 | -1) => {
    if (!matchIndexes.length) return;
    const next = (matchCursor + dir + matchIndexes.length) % matchIndexes.length;
    setMatchCursor(next);
    const i = matchIndexes[next];
    setSelectedPath(lines[i].path);
    scrollToIndex(i);
  };

  // ── Keyboard (ARIA tree pattern) ──────────────────────────────────────
  //   ↑/↓ move · → expand / to child · ← collapse / to parent · Enter toggles
  const selectable = (i: number) => lines[i] && lines[i].kind !== 'close';
  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = lines.findIndex((l) => l.kind !== 'close' && l.path === selectedPath);
    const go = (i: number) => {
      if (i < 0 || i >= lines.length) return;
      e.preventDefault();
      setSelectedPath(lines[i].path);
      scrollToIndex(i);
    };
    const line = lines[cur];
    switch (e.key) {
      case 'ArrowDown': {
        let i = cur + 1;
        while (i < lines.length && !selectable(i)) i++;
        go(i);
        break;
      }
      case 'ArrowUp': {
        let i = cur < 0 ? lines.length - 1 : cur - 1;
        while (i >= 0 && !selectable(i)) i--;
        go(i);
        break;
      }
      case 'ArrowRight':
        if (line?.kind === 'collapsed' && !forceExpand) { e.preventDefault(); toggle(line.path); }
        else if (line?.kind === 'open') go(cur + 1);
        break;
      case 'ArrowLeft':
        if (line?.kind === 'open' && line.path !== '$' && !forceExpand) { e.preventDefault(); toggle(line.path); }
        else if (line) go(lines.findIndex((l) => l.kind !== 'close' && l.path === line.containerPath));
        break;
      case 'Enter':
      case ' ':
        if (line && (line.kind === 'open' || line.kind === 'collapsed') && !forceExpand) { e.preventDefault(); toggle(line.path); }
        break;
      case 'Home': go(0); break;
      case 'End': go(lines.length - 1); break;
    }
  };

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const outputText = mode === 'minify' ? minified : mode === 'string' ? jsonString : beautified;

  const renderValue = (line: FlatLine, bracketClass: string) => {
    const comma = !line.isLast && <span className="text-fg-mute">,</span>;
    const badge = (
      <span className="ml-2 text-xs text-fg-mute/70">
        {m(line.isArray ? (line.count === 1 ? 'item' : 'items') : (line.count === 1 ? 'field' : 'fields'), { n: line.count ?? 0 })}
      </span>
    );

    switch (line.kind) {
      case 'primitive':
        return (
          <>
            <span className={TYPE_CLASS[line.valueType ?? 'null']}>{line.display}</span>
            {comma}
          </>
        );
      case 'open':
        return (
          <>
            <span className={bracketClass}>{line.bracketOpen}</span>
            {badge}
          </>
        );
      case 'collapsed':
        return (
          <>
            <span className={bracketClass}>{line.bracketOpen}</span>
            <span className="text-fg-mute"> … </span>
            <span className={bracketClass}>{line.bracketClose}</span>
            {comma}
            {badge}
          </>
        );
      case 'empty':
        return (
          <>
            <span className={bracketClass}>{line.bracketOpen}{line.bracketClose}</span>
            {comma}
          </>
        );
      case 'close':
        return (
          <>
            <span className={bracketClass}>{line.bracketClose}</span>
            {comma}
          </>
        );
    }
  };

  const inputPanel = (
    <div className="h-full border-b border-line flex flex-col">
      <PaneHeader label={c('input')} hint={quickPasteHint} />
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2">
        <JsonSyntaxEditor
          value={input}
          onChange={setInput}
          placeholder={'{"key": "value"}  or  "{\\"key\\": \\"value\\"}"'}
          ariaLabel={c('input')}
        />
      </div>
    </div>
  );

  const resultPanel = (
    <div className="h-full min-h-0 flex flex-col">
      {/* Status bar */}
      {(parsed.error || parsed.value !== undefined) && (
        <div className="shrink-0 border-b border-line px-4 py-2">
          {parsed.error ? (
            <div className="flex items-center gap-2 text-sm text-bad">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-mono text-xs">{parsed.error === INVALID ? m('invalidJson') : parsed.error}</span>
            </div>
          ) : parsed.strict ? (
            <div className="flex items-center gap-2 text-sm text-fg-mute">
              <CheckCircle2 className="h-4 w-4 text-ok" />
              <span className="text-xs">{m('validJson')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-fg-mute">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
              <span className="text-xs">{m('lenientJson')}</span>
            </div>
          )}
        </div>
      )}

      {/* Beautify: search + action bar */}
      {parsed.value !== undefined && mode === 'beautify' && (
        <div className="shrink-0 border-b border-line px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); jumpToMatch(e.shiftKey ? -1 : 1); }
              }}
              placeholder={m('searchPlaceholder')}
              className="h-ctl text-xs rounded-sm"
              containerClassName="flex-1 min-w-[160px]"
            />
            {lowerQuery && (
              <div className="flex items-center gap-0.5">
                <span className="min-w-[3.5rem] text-center font-mono text-xs tabular-nums text-fg-mute" aria-live="polite">
                  {matchIndexes.length ? `${matchCursor + 1}/${matchIndexes.length}` : '0/0'}
                </span>
                <Button variant="ghost" size="icon" className="h-ctl w-ctl" disabled={!matchIndexes.length}
                  onClick={() => jumpToMatch(-1)} title={m('prevMatch')} aria-label={m('prevMatch')}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-ctl w-ctl" disabled={!matchIndexes.length}
                  onClick={() => jumpToMatch(1)} title={m('nextMatch')} aria-label={m('nextMatch')}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <Button variant="outline" size="sm" className="h-ctl rounded-sm" onClick={() => setCollapsed(new Set())} title={m('expandAll')} aria-label={m('expandAll')}>
              <UnfoldVertical className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline" size="sm" className="h-ctl rounded-sm"
              onClick={() => setCollapsed(new Set(containerPaths.filter((path) => path !== '$')))}
              title={m('collapseAll')}
              aria-label={m('collapseAll')}
            >
              <FoldVertical className="h-3.5 w-3.5" />
            </Button>
            <CopyButton value={() => beautified} label={c('copy')} variant="outline" size="sm" className="h-ctl text-xs rounded-sm" iconClassName="h-3.5 w-3.5" />
          </div>
        </div>
      )}

      {/* Main content — flex-1 */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {parsed.value !== undefined && mode === 'beautify' && (
          <div
            ref={treeRef}
            role="tree"
            aria-label={m('tree')}
            tabIndex={0}
            aria-activedescendant={selectedPath ? `json-node-${lines.findIndex((l) => l.kind !== 'close' && l.path === selectedPath)}` : undefined}
            onKeyDown={onTreeKeyDown}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus"
            onMouseLeave={() => setHoveredContainer('')}
          >
            <div style={{ height: lines.length * ROW_H, position: 'relative' }}>
            <div style={{ transform: `translateY(${first * ROW_H}px)` }}>
            {lines.slice(first, last).map((line, offset) => {
              const index = first + offset;
              const bracketHighlighted = line.kind !== 'primitive' && line.path === hoveredContainer;
              const bracketClass = cn('text-fg-mute transition-colors duration-fast ease-out-soft', bracketHighlighted && 'text-fg font-semibold');
              const isMatch = lineMatches(line, lowerQuery);
              const isSelected = line.kind !== 'close' && selectedPath === line.path;
              const isToggle = line.kind === 'open' || line.kind === 'collapsed';
              return (
                <div
                  key={`${line.path}:${line.kind}`}
                  id={line.kind !== 'close' ? `json-node-${index}` : undefined}
                  role={line.kind !== 'close' ? 'treeitem' : 'none'}
                  aria-level={line.depth + 1}
                  aria-selected={line.kind !== 'close' ? isSelected : undefined}
                  aria-expanded={isToggle ? line.kind === 'open' : undefined}
                  className="flex h-5 items-start hover:bg-bg-2/30 transition-colors duration-fast ease-out-soft"
                  onMouseEnter={() => setHoveredContainer(line.containerPath)}
                  onClick={() => { setSelectedPath(line.path); if (isToggle && !forceExpand) toggle(line.path); }}
                >
                  <span className="w-12 shrink-0 select-none pr-3 text-right text-xs leading-5 text-fg-mute/45 tabular-nums">
                    {line.no}
                  </span>
                  <div className="flex min-w-0 flex-1 items-start pr-3" style={{ paddingLeft: `${line.depth * indent.size}ch` }}>
                    <span className="mr-0.5 mt-[3px] w-3.5 shrink-0 text-fg-mute" aria-hidden>
                      {/* One chevron rotated 90° with `--ease-spring` (as in
                          CollapsibleSection), not two swapped icons, so it can animate. */}
                      {isToggle && (
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 transition-transform duration-base ease-spring',
                            line.kind === 'open' && 'rotate-90',
                          )}
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        'whitespace-pre rounded-sm px-0.5 transition-colors duration-fast ease-out-soft',
                        isSelected && 'bg-fg/10',
                        isMatch && 'bg-warn/25',
                      )}
                    >
                      {line.name !== undefined && (
                        <>
                          <span className="text-[var(--json-key)]">{quoteText(line.name, quote)}</span>
                          <span className="text-fg-mute">: </span>
                        </>
                      )}
                      {renderValue(line, bracketClass)}
                    </span>
                  </div>
                </div>
              );
            })}
            </div>
            </div>
          </div>
        )}

        {parsed.value !== undefined && mode !== 'beautify' && (
          <>
            <PaneHeader
              label={mode === 'string' ? m('jsonString') : m('minified')}
              action={<CopyButton value={() => outputText} label={c('copy')} variant="ghost" size="sm" className="h-6 px-2 text-xs rounded-lg" iconClassName="h-3 w-3" />}
            />
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2">
              <CodeViewer value={outputText} language="json" />
            </div>
          </>
        )}

        {/* Empty state */}
        {parsed.value === undefined && !parsed.error && (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-fg-mute px-8 gap-3">
            <FileJson className="h-12 w-12 text-fg-mute/30" />
            <p className="text-sm">{m('getStarted')}</p>
            {!showInput && (
              <Button variant="outline" size="sm" className="h-ctl text-xs rounded-sm" onClick={() => setShowInput(true)}>
                <Eye className="h-3 w-3 mr-1.5" />{m('showInput')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Beautify: path breadcrumb */}
      {parsed.value !== undefined && mode === 'beautify' && (
        <div className="shrink-0 border-t border-line flex items-center gap-2 px-4 py-2 bg-bg-2/10 text-xs">
          <span className="text-fg-mute">{m('path')}</span>
          <code className="flex-1 truncate font-mono text-fg">{selectedPath || m('pathHint')}</code>
          {selectedPath && (
            <CopyButton value={selectedPath} variant="ghost" size="sm" className="h-6 px-2" iconClassName="h-3.5 w-3.5" />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <ToolToolbar>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'beautify', label: m('beautify') },
              { value: 'string', label: m('jsonString') },
              { value: 'minify', label: m('minify') },
            ]}
            aria-label={m('modeLabel')}
          />

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-fg-mute">{c('indent')}</span>
            <Select value={indentKey} onValueChange={setIndentKey}>
              <SelectTrigger className="h-ctl w-[108px] text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">{c('spaces', { n: 2 })}</SelectItem>
                <SelectItem value="4">{c('spaces', { n: 4 })}</SelectItem>
                <SelectItem value="tab">{c('tab')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-fg-mute">{m('quotes')}</span>
            <Select value={quote} onValueChange={setQuote}>
              <SelectTrigger className="h-ctl w-[112px] text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={'"'}>{m('doubleQuote')}</SelectItem>
                <SelectItem value={"'"}>{m('singleQuote')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" className="ml-auto h-ctl text-xs rounded-sm" onClick={() => setShowInput((v) => !v)}>
            {showInput ? <EyeOff className="h-3 w-3 mr-1.5" /> : <Eye className="h-3 w-3 mr-1.5" />}
            {showInput ? m('hideInput') : m('showInput')}
          </Button>
        </div>
      </ToolToolbar>

      {/* Input panel (collapsible, resizable) + result view */}
      <div className="flex-1 min-h-0 flex flex-col">
        {showInput ? (
          <SplitPane
            direction="vertical"
            initialPercent={28}
            minPercent={12}
            maxPercent={70}
            minPanePx={64}
            first={inputPanel}
            second={resultPanel}
          />
        ) : (
          resultPanel
        )}
      </div>
    </div>
  );
}
