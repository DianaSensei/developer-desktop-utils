// Search (⌘⇧F) helpers shared by the in-memory workspace, the unsaved-buffer
// overlay and Replace. The desktop app searches files on disk in Rust
// (editor_search.rs); these mirror its rules — the same glob semantics and
// result shape — so the browser demo and dirty tabs behave the same way.

export interface TextSearchQuery {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Comma-separated globs; empty = every file. */
  include: string;
  /** Comma-separated globs. */
  exclude: string;
  /** Skip what each folder's `.gitignore` lists. */
  useIgnoreFiles: boolean;
  maxResults?: number;
  /** Opened folders to search; empty = all. */
  roots?: string[];
}

export interface LineMatch {
  /** 1-based. */
  line: number;
  /** Offset in the line (JS string index). */
  column: number;
  length: number;
  preview: string;
  previewColumn: number;
}

export interface FileMatches {
  path: string;
  root: string;
  /** Root-relative, `/`-separated. */
  rel: string;
  matches: LineMatch[];
}

export interface TextSearchResult {
  files: FileMatches[];
  matchCount: number;
  filesSearched: number;
  truncated: boolean;
  cancelled: boolean;
  elapsedMs: number;
}

export const DEFAULT_MAX_RESULTS = 10_000;
const PREVIEW_BEFORE = 40;
const PREVIEW_AFTER = 220;

export function emptyResult(): TextSearchResult {
  return { files: [], matchCount: 0, filesSearched: 0, truncated: false, cancelled: false, elapsedMs: 0 };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The pattern source and flags for a query (`g` included), or null when empty.
 *  Throws SyntaxError for an invalid regex. */
export function buildRegExp(q: Pick<TextSearchQuery, 'query' | 'regex' | 'caseSensitive' | 'wholeWord'>): RegExp | null {
  if (!q.query) return null;
  let source = q.regex ? q.query : escapeRe(q.query);
  if (q.wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, `g${q.caseSensitive ? '' : 'i'}`);
}

// ── Globs (same rules as editor_search.rs `glob_to_regex`) ──────────────

function splitGlobs(spec: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of spec) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth <= 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** `*.ts` and `docs` match at any depth, `/docs` only at the root, and a
 *  pattern matching a folder also matches everything inside it. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/\\/g, '/');
  if (g.startsWith('./')) g = g.slice(2);
  const anchored = g.startsWith('/');
  g = g.replace(/^\/+/, '');
  if (g.endsWith('/')) g += '**';
  let re = '^';
  if (!anchored && !g.startsWith('**')) re += '(?:.*/)?';
  let brace = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { brace++; re += '(?:'; }
    else if (c === '}' && brace > 0) { brace--; re += ')'; }
    else if (c === ',' && brace > 0) re += '|';
    else if (c === '[') {
      const end = g.indexOf(']', i + 1);
      if (end < 0) { re += '\\['; continue; }
      let body = g.slice(i + 1, end);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      re += `[${body.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else re += escapeRe(c);
  }
  return new RegExp(`${re}(?:/.*)?$`, 'i');
}

export class GlobSet {
  private readonly res: RegExp[];
  constructor(spec: string | string[]) {
    const globs = Array.isArray(spec) ? spec : splitGlobs(spec);
    this.res = globs.map(globToRegExp);
  }
  get empty() { return this.res.length === 0; }
  matches(rel: string) { return this.res.some((r) => r.test(rel)); }
}

/** A `.gitignore` as globs (no negation or nested files), like the Rust side. */
export function gitignoreGlobs(text: string): GlobSet {
  const globs = text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => (l.replace(/\/$/, '').includes('/') && !l.startsWith('/') && !l.startsWith('**') ? `/${l}` : l));
  return new GlobSet(globs);
}

/** Whether a file passes include / exclude (and ignore) filters. */
export function fileIncluded(rel: string, include: GlobSet, exclude: GlobSet, ignore?: GlobSet): boolean {
  if (exclude.matches(rel) || (ignore && !ignore.empty && ignore.matches(rel))) return false;
  return include.empty || include.matches(rel);
}

// ── Matching ────────────────────────────────────────────────────────────

/** Every match in `text`, line by line, up to `limit`. */
export function searchText(text: string, re: RegExp, limit = DEFAULT_MAX_RESULTS): LineMatch[] {
  const out: LineMatch[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push(lineMatch(line, i, m.index, m.index + m[0].length));
      if (out.length >= limit) break;
    }
  }
  return out;
}

function lineMatch(line: string, idx: number, start: number, end: number): LineMatch {
  const indent = line.length - line.trimStart().length;
  let from = Math.min(indent, start);
  const chars = Array.from(line.slice(from, start));
  if (chars.length > PREVIEW_BEFORE) from = start - chars.slice(-PREVIEW_BEFORE).join('').length;
  const after = Array.from(line.slice(start)).slice(0, PREVIEW_AFTER).join('');
  const to = Math.max(end, start + after.length);
  const cut = from > indent;
  return {
    line: idx + 1,
    column: start,
    length: end - start,
    preview: `${cut ? '…' : ''}${line.slice(from, to)}`,
    previewColumn: (cut ? 1 : 0) + (start - from),
  };
}

// ── Replace ─────────────────────────────────────────────────────────────

/** `replacement` as String.replace expects it: literal text has `$` escaped;
 *  in regex mode `$1`, `$&` and `\n` / `\t` work. */
export function replacementFor(q: Pick<TextSearchQuery, 'regex'>, replacement: string): string {
  if (!q.regex) return replacement.replace(/\$/g, '$$$$');
  return replacement.replace(/\\(n|t|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));
}

/** What one match becomes (for the preview next to it). */
export function replacedMatch(q: TextSearchQuery, matched: string, replacement: string): string {
  const re = buildRegExp(q);
  if (!re) return replacement;
  return matched.replace(new RegExp(re.source, re.flags.replace('g', '')), replacementFor(q, replacement));
}

/** Replaces every match in `text`; returns the new text and the count. */
export function replaceAll(text: string, q: TextSearchQuery, replacement: string): { text: string; count: number } {
  const re = buildRegExp(q);
  if (!re) return { text, count: 0 };
  let count = 0;
  const rep = replacementFor(q, replacement);
  // Per line, like the search, so `^`/`$` and `.` behave the same.
  const out = text.split('\n').map((line) => {
    const cr = line.endsWith('\r');
    const body = cr ? line.slice(0, -1) : line;
    const n = (body.match(re) ?? []).filter(Boolean).length;
    if (!n) return line;
    count += n;
    const next = body.replace(re, rep);
    return cr ? `${next}\r` : next;
  }).join('\n');
  return { text: out, count };
}
