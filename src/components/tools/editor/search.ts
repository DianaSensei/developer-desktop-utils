// The Search view's state (⌘⇧F), kept for the app session next to the
// EditorStore so switching tools keeps the query and results. Searching
// runs on disk through `fs.searchText` (Rust in the desktop app); open tabs
// with unsaved edits are searched in memory instead, as VS Code does.
// Replace edits open tabs in place (undoable, left unsaved) and writes other
// files directly.

import type { EditorStore, StorageLike } from './store';
import { toFsError } from './fs';
import {
  GlobSet, buildRegExp, fileIncluded, replaceAll, searchText,
  type FileMatches, type TextSearchQuery, type TextSearchResult,
} from './textSearch';
import { relativeTo } from './paths';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
  useIgnoreFiles: boolean;
  /** The include/exclude fields are showing. */
  details: boolean;
  /** The Replace field is showing. */
  replaceOpen: boolean;
}

export type SearchStatus = 'idle' | 'running' | 'done' | 'error';

export interface SearchSnapshot {
  query: string;
  replace: string;
  options: SearchOptions;
  status: SearchStatus;
  error: string | null;
  result: TextSearchResult | null;
  /** File paths whose matches are folded. */
  collapsed: Record<string, true>;
  /** Bumped to ask the view to focus (and select) the query field. */
  focusTick: number;
}

const DEFAULT_OPTIONS: SearchOptions = {
  caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '', useIgnoreFiles: true,
  details: false, replaceOpen: false,
};
const OPTIONS_KEY = 'searchOptions';
const DEBOUNCE_MS = 300;

export interface ReplaceSummary {
  occurrences: number;
  files: number;
  failed: string[];
}

export class SearchSession {
  private snap: SearchSnapshot;
  private listeners = new Set<() => void>();
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly store: EditorStore, private readonly storage: StorageLike) {
    let saved: Partial<SearchOptions> = {};
    try { saved = JSON.parse(storage.get(OPTIONS_KEY) ?? '{}') as Partial<SearchOptions>; } catch { /* default */ }
    this.snap = {
      query: '', replace: '', options: { ...DEFAULT_OPTIONS, ...pick(saved) }, status: 'idle', error: null, result: null,
      collapsed: {}, focusTick: 0,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<SearchSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** The query as the backend takes it. */
  query(): TextSearchQuery {
    const o = this.snap.options;
    return {
      query: this.snap.query, regex: o.regex, caseSensitive: o.caseSensitive, wholeWord: o.wholeWord,
      include: o.details ? o.include : '', exclude: o.details ? o.exclude : '', useIgnoreFiles: o.useIgnoreFiles,
    };
  }

  /** ⌘⇧F: focus the field, starting from `seed` (the editor's selection) if given. */
  focus(seed?: string) {
    if (seed && seed !== this.snap.query) {
      this.set({ query: seed, focusTick: this.snap.focusTick + 1 });
      void this.run();
    } else {
      this.set({ focusTick: this.snap.focusTick + 1 });
    }
  }

  /** Typing: searches after a short pause. */
  setQuery(query: string) {
    this.set({ query });
    this.schedule();
  }

  setReplace(replace: string) {
    this.set({ replace });
  }

  setOptions(patch: Partial<SearchOptions>) {
    const options = { ...this.snap.options, ...patch };
    this.set({ options });
    try { this.storage.set(OPTIONS_KEY, JSON.stringify(options)); } catch { /* not critical */ }
    const affects = (['caseSensitive', 'wholeWord', 'regex', 'useIgnoreFiles', 'details'] as const).some((k) => k in patch);
    if (affects && this.snap.query) void this.run();
    else if (('include' in patch || 'exclude' in patch) && this.snap.query) this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, DEBOUNCE_MS);
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.token++;
    void this.store.fs.cancelSearch().catch(() => {});
    this.set({ query: '', replace: '', status: 'idle', error: null, result: null, collapsed: {}, focusTick: this.snap.focusTick + 1 });
  }

  /** Runs the search now (Enter, Refresh, options). */
  async run(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const q = this.query();
    const token = ++this.token;
    if (!q.query) {
      this.set({ status: 'idle', error: null, result: null });
      return;
    }
    let re: RegExp | null;
    try {
      re = buildRegExp(q);
      new GlobSet(q.include);
      new GlobSet(q.exclude);
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e), result: null });
      return;
    }
    if (this.store.getSnapshot().folders.length === 0) {
      this.set({ status: 'done', error: null, result: { files: [], matchCount: 0, filesSearched: 0, truncated: false, cancelled: false, elapsedMs: 0 } });
      return;
    }
    this.set({ status: 'running', error: null });
    try {
      const res = await this.store.fs.searchText(q);
      if (token !== this.token || res.cancelled) return;
      this.set({ status: 'done', result: this.withOpenBuffers(res, q, re!) });
    } catch (e) {
      if (token !== this.token) return;
      this.set({ status: 'error', error: toFsError(e).message, result: null });
    }
  }

  /** Unsaved tabs are searched as they are on screen, not as on disk. */
  private withOpenBuffers(res: TextSearchResult, q: TextSearchQuery, re: RegExp): TextSearchResult {
    const dirty = this.store.dirtyBuffers();
    if (!dirty.length) return res;
    const include = new GlobSet(q.include);
    const exclude = new GlobSet(q.exclude);
    const files = [...res.files];
    for (const { path, text } of dirty) {
      const root = this.store.rootOf(path);
      if (!root) continue;
      const rel = relativeTo(path, root);
      const at = files.findIndex((f) => f.path === path);
      if (at < 0 && !fileIncluded(rel, include, exclude)) continue;
      const matches = searchText(text, re);
      const entry: FileMatches = { path, root, rel, matches };
      if (at >= 0) {
        if (matches.length) files[at] = entry; else files.splice(at, 1);
      } else if (matches.length) {
        files.push(entry);
      }
    }
    return { ...res, files, matchCount: files.reduce((n, f) => n + f.matches.length, 0) };
  }

  toggleCollapsed(path: string) {
    const collapsed = { ...this.snap.collapsed };
    if (collapsed[path]) delete collapsed[path]; else collapsed[path] = true;
    this.set({ collapsed });
  }

  setAllCollapsed(on: boolean) {
    const files = this.snap.result?.files ?? [];
    this.set({ collapsed: on ? Object.fromEntries(files.map((f) => [f.path, true as const])) : {} });
  }

  /** Drops a file from the results (VS Code's "Dismiss"). */
  dismiss(path: string, line?: number, column?: number) {
    const res = this.snap.result;
    if (!res) return;
    const files = res.files
      .map((f) => (f.path !== path ? f : line === undefined ? null : { ...f, matches: f.matches.filter((m) => !(m.line === line && m.column === column)) }))
      .filter((f): f is FileMatches => !!f && f.matches.length > 0);
    this.set({ result: { ...res, files, matchCount: files.reduce((n, f) => n + f.matches.length, 0) } });
  }

  /** Replaces every match in `paths` (default: every file in the results). */
  async replace(paths?: string[]): Promise<ReplaceSummary> {
    const q = this.query();
    const targets = (this.snap.result?.files ?? []).filter((f) => !paths || paths.includes(f.path));
    const summary: ReplaceSummary = { occurrences: 0, files: 0, failed: [] };
    for (const f of targets) {
      let n = 0;
      try {
        const where = await this.store.replaceFileText(f.path, (text) => {
          const out = replaceAll(text, q, this.snap.replace);
          n = out.count;
          return out.text;
        });
        if (where !== 'unchanged') { summary.occurrences += n; summary.files++; }
      } catch {
        summary.failed.push(f.path);
      }
    }
    await this.run();
    return summary;
  }
}

function pick(o: Partial<SearchOptions>): Partial<SearchOptions> {
  const out: Partial<SearchOptions> = {};
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof SearchOptions)[]) {
    if (typeof o[k] === typeof DEFAULT_OPTIONS[k]) (out as Record<string, unknown>)[k] = o[k];
  }
  return out;
}
