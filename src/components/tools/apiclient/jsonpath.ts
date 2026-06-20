// A small JSONPath subset for filtering JSON responses (Bruno's funnel filter).
// Supports: $ root, .key / ['key'], [index] (incl. negative), [*] wildcard,
// and .. recursive descent. Returns the single match or an array of matches.

type Token =
  | { type: 'key'; value: string }
  | { type: 'index'; value: number }
  | { type: 'wild' }
  | { type: 'recurse' };

function parsePath(expr: string): Token[] {
  let e = expr.trim();
  if (e[0] === '$') e = e.slice(1);
  const tokens: Token[] = [];
  let i = 0;
  while (i < e.length) {
    if (e.startsWith('..', i)) { tokens.push({ type: 'recurse' }); i += 2; continue; }
    if (e[i] === '.') { i++; continue; }
    if (e[i] === '*') { tokens.push({ type: 'wild' }); i++; continue; }
    if (e[i] === '[') {
      const end = e.indexOf(']', i);
      if (end === -1) break;
      const inner = e.slice(i + 1, end).trim();
      if (inner === '*') tokens.push({ type: 'wild' });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: 'index', value: Number(inner) });
      else tokens.push({ type: 'key', value: inner.replace(/^['"]|['"]$/g, '') });
      i = end + 1;
      continue;
    }
    const m = /^[\w$-]+/.exec(e.slice(i));
    if (m) { tokens.push({ type: 'key', value: m[0] }); i += m[0].length; continue; }
    i++;
  }
  return tokens;
}

function collectAll(item: unknown, out: unknown[]): void {
  out.push(item);
  if (Array.isArray(item)) item.forEach((v) => collectAll(v, out));
  else if (item && typeof item === 'object') Object.values(item as object).forEach((v) => collectAll(v, out));
}

export function queryJson(data: unknown, expr: string): unknown {
  const tokens = parsePath(expr);
  if (tokens.length === 0) return data;
  let current: unknown[] = [data];
  for (const tok of tokens) {
    const next: unknown[] = [];
    for (const item of current) {
      if (tok.type === 'recurse') collectAll(item, next);
      else if (tok.type === 'wild') {
        if (Array.isArray(item)) next.push(...item);
        else if (item && typeof item === 'object') next.push(...Object.values(item as object));
      } else if (tok.type === 'index') {
        if (Array.isArray(item)) {
          const idx = tok.value < 0 ? item.length + tok.value : tok.value;
          if (idx >= 0 && idx < item.length) next.push(item[idx]);
        }
      } else if (item && typeof item === 'object' && tok.value in (item as object)) {
        next.push((item as Record<string, unknown>)[tok.value]);
      }
    }
    current = next;
  }
  return current.length === 1 ? current[0] : current;
}
