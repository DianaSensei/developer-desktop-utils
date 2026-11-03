// Path helpers for paths the backend handed us. Paths are treated as opaque
// strings that Rust produced (canonical, absolute), so the only question is
// which separator they use: `\` for Windows drive/UNC paths, `/` otherwise.

export function sepOf(path: string): '/' | '\\' {
  return !path.startsWith('/') && path.includes('\\') ? '\\' : '/';
}

function trimTrailing(path: string): string {
  const sep = sepOf(path);
  // Keep a bare root ("/", "C:\") intact.
  if (path.length > 1 && path.endsWith(sep) && !/^[A-Za-z]:\\$/.test(path)) return path.slice(0, -1);
  return path;
}

export function basename(path: string): string {
  const p = trimTrailing(path);
  const i = p.lastIndexOf(sepOf(p));
  return i < 0 ? p : p.slice(i + 1) || p;
}

export function dirname(path: string): string {
  const p = trimTrailing(path);
  const sep = sepOf(p);
  const i = p.lastIndexOf(sep);
  if (i < 0) return p;
  if (i === 0) return sep;
  const head = p.slice(0, i);
  return /^[A-Za-z]:$/.test(head) ? `${head}\\` : head;
}

export function join(dir: string, name: string): string {
  const sep = sepOf(dir);
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** `child` is `parent` or somewhere below it. */
export function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  const sep = sepOf(parent);
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
}

/** Re-roots `path` from `from` to `to` (for a rename/move of `from`). */
export function rebase(path: string, from: string, to: string): string {
  if (path === from) return to;
  return isUnder(path, from) ? to + path.slice(from.length) : path;
}

/** `path` relative to `root`, `/`-separated; the path itself if outside. */
export function relativeTo(path: string, root: string): string {
  if (!isUnder(path, root) || path === root) return path === root ? '' : path;
  const sep = sepOf(root);
  const rest = path.slice(root.endsWith(sep) ? root.length : root.length + 1);
  return sep === '\\' ? rest.split('\\').join('/') : rest;
}

/** Extension in lower case without the dot ("" when none; ".env" → "env"). */
export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  return i < 0 || i === name.length - 1 ? '' : name.slice(i + 1).toLowerCase();
}
