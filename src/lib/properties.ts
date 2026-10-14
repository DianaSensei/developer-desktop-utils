// Java/Spring `.properties` parse + stringify, hand-rolled (no dependency).
//
// `.properties` is a flat list of `key=value` lines and has no native nesting.
// The widely-used convention — and what Spring's relaxed binding does — is to
// treat a dotted key as a path into nested objects and `key[0]` as an array
// index. We follow that so the format round-trips meaningfully with JSON/YAML:
//
//   database.host=localhost      ->  { database: { host: "localhost" } }
//   servers[0].port=8080         ->  { servers: [ { port: 8080 } ] }
//
// Values are type-inferred (numbers / booleans) like this tool's CSV handling;
// comments (`#` / `!`) are dropped, and a literal `.` inside a key name is not
// supported (dots are always structural).

// ─── Parse: .properties text → JS value ──────────────────────────────────────

export function parseProperties(text: string): unknown {
  const logical = mergeContinuations(text.split(/\r\n|\r|\n/));
  const holder: { root: unknown } = { root: undefined };

  for (const raw of logical) {
    const line = stripLeadingWs(raw);
    if (line === '' || line[0] === '#' || line[0] === '!') continue;
    const { key, value } = splitKeyValue(line);
    const path = keyPath(unescape(key));
    if (path.length === 0) continue;
    assign(holder, path, inferScalar(unescape(value)));
  }

  return holder.root === undefined ? {} : holder.root;
}

// Merge physical lines that end with an odd number of backslashes into one
// logical line (the continuation's leading whitespace is stripped, per spec).
function mergeContinuations(lines: string[]): string[] {
  const out: string[] = [];
  let buf: string | null = null;
  for (const physical of lines) {
    const line: string = buf !== null ? buf + stripLeadingWs(physical) : physical;
    const trailing = (line.match(/\\*$/)?.[0].length) ?? 0;
    if (trailing % 2 === 1) buf = line.slice(0, -1); // keep accumulating
    else { out.push(line); buf = null; }
  }
  if (buf !== null) out.push(buf);
  return out;
}

function stripLeadingWs(s: string): string {
  return s.replace(/^[ \t\f]+/, '');
}

// Split a logical line into raw (still-escaped) key and value. The key ends at
// the first unescaped whitespace, `=`, or `:`; one such separator (plus
// surrounding whitespace) is then consumed.
function splitKeyValue(line: string): { key: string; value: string } {
  let i = 0;
  let key = '';
  while (i < line.length) {
    const c = line[i];
    if (c === '\\') { key += c + (line[i + 1] ?? ''); i += 2; continue; }
    if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break;
    key += c; i++;
  }
  while (i < line.length && (line[i] === ' ' || line[i] === '\t' || line[i] === '\f')) i++;
  if (line[i] === '=' || line[i] === ':') {
    i++;
    while (i < line.length && (line[i] === ' ' || line[i] === '\t' || line[i] === '\f')) i++;
  }
  return { key, value: line.slice(i) };
}

// Turn a dotted/bracketed key into a path of object keys (string) and array
// indices (number). e.g. `servers[0].host` -> ['servers', 0, 'host'].
function keyPath(key: string): (string | number)[] {
  const path: (string | number)[] = [];
  for (const seg of key.split('.')) {
    if (seg === '') continue;
    const base = seg.replace(/\[\d+\]/g, '');
    if (base) path.push(base);
    const idx = seg.match(/\[(\d+)\]/g);
    if (idx) for (const g of idx) path.push(Number(g.slice(1, -1)));
  }
  return path;
}

type Container = Record<string, unknown> | unknown[];

function isContainer(v: unknown): v is Container {
  return typeof v === 'object' && v !== null;
}

function getOwn(node: Container, key: string | number): unknown {
  return Object.hasOwn(node, key) ? (node as Record<string | number, unknown>)[key] : undefined;
}

// defineProperty rather than `node[key] = value`: a `__proto__` key must stay
// ordinary data, never replace the object's prototype (or reach
// Object.prototype, which would leak into every object in the app).
function setOwn(node: Container, key: string | number, value: unknown): void {
  Object.defineProperty(node, key, { value, writable: true, enumerable: true, configurable: true });
}

// Inverse of keyPath, for keys that have to stay flat.
function joinPath(path: (string | number)[]): string {
  return path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg), '');
}

function flatLeaves(value: unknown, prefix: string, out: [string, unknown][]): [string, unknown][] {
  if (!isContainer(value)) {
    out.push([prefix, value]);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    flatLeaves(v, Array.isArray(value) ? `${prefix}[${k}]` : `${prefix}.${k}`, out);
  }
  return out;
}

function assign(holder: { root: unknown }, path: (string | number)[], value: unknown): void {
  if (path.length === 0) return;
  if (holder.root === undefined) holder.root = typeof path[0] === 'number' ? [] : {};
  let node = holder.root as Container;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = getOwn(node, key);
    if (next === undefined) {
      const created: Container = typeof path[i + 1] === 'number' ? [] : {};
      setOwn(node, key, created);
      node = created;
      continue;
    }
    if (!isContainer(next)) {
      // `a=1` then `a.b=2` (Spring: `logging.level.com.example=DEBUG` and
      // `logging.level.com.example.service=TRACE`): `a` already holds a value,
      // so the rest stays one dotted key beside it rather than being lost.
      if (Array.isArray(node)) throw new Error(`"${joinPath(path)}" conflicts with an earlier value`);
      setOwn(node, joinPath(path.slice(i)), value);
      return;
    }
    node = next;
  }
  const leaf = path[path.length - 1];
  const existing = getOwn(node, leaf);
  if (isContainer(existing) && !Array.isArray(node)) {
    // The same conflict the other way round (`a.b=2` then `a=1`): keep the
    // earlier section as dotted keys so both lines survive.
    for (const [k, v] of flatLeaves(existing, String(leaf), [])) setOwn(node, k, v);
  }
  setOwn(node, leaf, value);
}

function unescape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === undefined) { out += '\\'; break; }
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'f': out += '\f'; break;
      case 'u': { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16) || 0); i += 4; break; }
      default: out += n;
    }
  }
  return out;
}

// Strings stay strings, but bare numbers/booleans become typed values so the
// JSON/YAML output is natural (matches the tool's CSV behavior). Numbers that
// would not print back the same (zip codes, ids, versions like 1.10) are left
// as strings.
export function inferScalar(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  // Only when the number prints back exactly as written: `1.10` (a version)
  // or `07000` (a zip code) would otherwise change.
  if (/^-?\d+$/.test(s) || /^-?\d*\.\d+$/.test(s)) {
    const n = Number(s);
    if (String(n) === s && (Number.isSafeInteger(n) || !Number.isInteger(n))) return n;
  }
  return s;
}

// ─── Stringify: JS value → .properties text ──────────────────────────────────

export function stringifyProperties(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    throw new Error('Properties output needs an object or array at the root — your data is a scalar.');
  }
  const lines: string[] = [];
  flatten(value, '', lines);
  return lines.join('\n');
}

function flatten(val: unknown, prefix: string, lines: string[]): void {
  if (Array.isArray(val)) {
    val.forEach((v, i) => flatten(v, `${prefix}[${i}]`, lines));
  } else if (val !== null && typeof val === 'object') {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const key = escapeKey(k);
      flatten(v, prefix ? `${prefix}.${key}` : key, lines);
    }
  } else {
    lines.push(`${prefix}=${escapeVal(val)}`);
  }
}

function escapeKey(k: string): string {
  return String(k).replace(/[=:\s\\#!]/g, (c) => '\\' + c);
}

function escapeVal(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/^ /, '\\ ');
}
