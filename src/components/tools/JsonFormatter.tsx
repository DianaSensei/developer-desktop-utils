import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FoldVertical,
  Search,
  UnfoldVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Mode = 'beautify' | 'string' | 'minify';

const INDENT_OPTIONS: Record<string, { unit: string; size: number }> = {
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
function parseInput(text: string): JsonValue {
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
function quoteText(value: string, quote: string) {
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

function serialize(value: JsonValue, indentUnit: string, quote: string): string {
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

const TYPE_CLASS: Record<string, string> = {
  string: 'text-green-600 dark:text-green-400',
  number: 'text-amber-600 dark:text-amber-400',
  boolean: 'text-purple-600 dark:text-purple-400',
  null: 'text-rose-500 dark:text-rose-400',
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

function lineMatches(line: FlatLine, lowerQuery: string) {
  if (!lowerQuery) return false;
  if (line.name && line.name.toLowerCase().includes(lowerQuery)) return true;
  if (line.kind === 'primitive' && line.display && line.display.toLowerCase().includes(lowerQuery)) return true;
  return line.path.toLowerCase().includes(lowerQuery);
}

export function JsonFormatter() {
  const [input, setInput] = usePersistentState('devtool:json:input', '');
  const [mode, setMode] = usePersistentState<Mode>('devtool:json:mode', 'beautify');
  const [indentKey, setIndentKey] = usePersistentState('devtool:json:indent', '2');
  const [quote, setQuote] = usePersistentState('devtool:json:quote', '"');
  const [showInput, setShowInput] = usePersistentState('devtool:json:showInput', true);

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState('');
  const [hoveredContainer, setHoveredContainer] = useState('');

  useQuickPaste((text) => setInput(normalizeSmartQuotes(text)));
  useInputHistory(input, setInput);

  const indent = INDENT_OPTIONS[indentKey] ?? INDENT_OPTIONS['2'];
  const forceExpand = query.trim().length > 0;
  const lowerQuery = query.trim().toLowerCase();

  const parsed = useMemo<{ value: JsonValue | undefined; error: string }>(() => {
    if (!input.trim()) return { value: undefined, error: '' };
    try {
      return { value: parseInput(input), error: '' };
    } catch (err) {
      return { value: undefined, error: err instanceof Error ? err.message : 'Invalid JSON' };
    }
  }, [input]);

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

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);
  const outputText = mode === 'minify' ? minified : mode === 'string' ? jsonString : beautified;

  const renderValue = (line: FlatLine, bracketClass: string) => {
    const comma = !line.isLast && <span className="text-muted-foreground">,</span>;
    const badge = (
      <span className="ml-2 text-xs text-muted-foreground/70">
        {line.isArray ? `${line.count} ${line.count === 1 ? 'item' : 'items'}` : `${line.count} ${line.count === 1 ? 'field' : 'fields'}`}
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
            <span className="text-muted-foreground"> … </span>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>JSON Formatter</CardTitle>
        <CardDescription>Beautify with a collapsible tree, convert to an escaped string, or minify</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-9 rounded-md border bg-muted/45 p-0.5">
            {([
              { id: 'beautify', label: 'Beautify' },
              { id: 'string', label: 'To JSON String' },
              { id: 'minify', label: 'Minify' },
            ] as Array<{ id: Mode; label: string }>).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={cn(
                  'rounded px-3 text-sm font-medium transition-colors',
                  mode === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Indent</span>
            <Select value={indentKey} onValueChange={setIndentKey}>
              <SelectTrigger className="h-9 w-[108px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 spaces</SelectItem>
                <SelectItem value="4">4 spaces</SelectItem>
                <SelectItem value="tab">Tab</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Quotes</span>
            <Select value={quote} onValueChange={setQuote}>
              <SelectTrigger className="h-9 w-[112px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={'"'}>Double "</SelectItem>
                <SelectItem value={"'"}>Single '</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setShowInput((value) => !value)}>
            {showInput ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showInput ? 'Hide input' : 'Show input'}
          </Button>
        </div>

        {showInput && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Input</Label>
              <span className="text-xs text-muted-foreground">{quickPasteHint}</span>
            </div>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={'{"key": "value"}  or  "{\\"key\\": \\"value\\"}"'}
              className="min-h-[140px] font-mono text-sm"
            />
          </div>
        )}

        {parsed.error ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="font-mono">{parsed.error}</span>
          </div>
        ) : (
          parsed.value !== undefined && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span>Valid JSON</span>
            </div>
          )
        )}

        {parsed.value !== undefined && mode === 'beautify' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find by key, value, or path…"
                  className="h-9 pl-8"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())} title="Expand all">
                <UnfoldVertical className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollapsed(new Set(containerPaths.filter((path) => path !== '$')))}
                title="Collapse all"
              >
                <FoldVertical className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyText(beautified)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>

            <div
              className="overflow-auto rounded-md border bg-muted/20 py-2 font-mono text-sm leading-relaxed min-h-[320px] max-h-[70vh]"
              onMouseLeave={() => setHoveredContainer('')}
            >
              {lines.map((line) => {
                const bracketHighlighted = line.kind !== 'primitive' && line.path === hoveredContainer;
                const bracketClass = cn('text-muted-foreground', bracketHighlighted && 'text-foreground font-semibold');
                const isMatch = lineMatches(line, lowerQuery);
                const isSelected = line.kind !== 'close' && selectedPath === line.path;
                const isToggle = line.kind === 'open' || line.kind === 'collapsed';

                return (
                  <div
                    key={`${line.path}:${line.kind}`}
                    className="flex items-start hover:bg-muted/30"
                    onMouseEnter={() => setHoveredContainer(line.containerPath)}
                    onClick={() => {
                      setSelectedPath(line.path);
                      if (isToggle && !forceExpand) toggle(line.path);
                    }}
                  >
                    <span className="w-12 shrink-0 select-none pr-3 text-right text-xs leading-relaxed text-muted-foreground/45 tabular-nums">
                      {line.no}
                    </span>
                    <div className="flex min-w-0 flex-1 items-start pr-3" style={{ paddingLeft: `${line.depth * indent.size}ch` }}>
                      <span className="mr-0.5 mt-[3px] w-3.5 shrink-0 text-muted-foreground">
                        {isToggle &&
                          (line.kind === 'open' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                      </span>
                      <span
                        className={cn(
                          'whitespace-pre rounded-sm px-0.5',
                          isSelected && 'bg-foreground/10',
                          isMatch && 'bg-yellow-200/70 dark:bg-yellow-500/25'
                        )}
                      >
                        {line.name !== undefined && (
                          <>
                            <span className="text-sky-600 dark:text-sky-400">{quoteText(line.name, quote)}</span>
                            <span className="text-muted-foreground">: </span>
                          </>
                        )}
                        {renderValue(line, bracketClass)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 rounded-md border bg-background/50 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Path</span>
              <code className="flex-1 truncate font-mono text-foreground">{selectedPath || '$ (click a node)'}</code>
              {selectedPath && (
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => copyText(selectedPath)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {parsed.value !== undefined && mode !== 'beautify' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{mode === 'string' ? 'JSON String' : 'Minified'}</Label>
              <Button onClick={() => copyText(outputText)} size="sm" variant="ghost">
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>
            <Textarea value={outputText} readOnly className="min-h-[200px] font-mono text-sm" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
