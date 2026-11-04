// The Find / Replace widget for every CodeMirror editor in the app (⌘F,
// ⌘⌥F / Ctrl+H for replace where the editor binds it), replacing
// CodeMirror's default panel of plain inputs, text buttons and checkboxes.
//
// Laid out like VS Code's find widget: a compact card floating at the
// editor's top-right — query field with Match Case / Whole Word / Regex
// toggles inside it, "3 of 12", previous / next, select all, close; the
// chevron on the left reveals the Replace row. It floats over the text
// instead of pushing it down, and matches are scrolled to the middle so
// the card never hides the current one.
//
// Keys: Enter / ⇧Enter next / previous, ⌥Enter select all matches,
// ⌥C ⌥W ⌥R toggle the options, Esc closes; in Replace, Enter replaces
// the next match and ⌘/Ctrl+Enter replaces all.
//
// Included by `codeTheme()` (code-theme.ts), so every editor gets it. The
// config object is a single constant: CodeMirror merges search configs and
// would throw on two different `createPanel` functions.

import { EditorView, keymap, type Command, type Panel, type ViewUpdate } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import {
  SearchQuery, closeSearchPanel, findNext, openSearchPanel, findPrevious, getSearchQuery, replaceAll, replaceNext, search,
  selectMatches, setSearchQuery,
} from '@codemirror/search';
import { IS_MAC } from '@/lib/platform';

/** Counting stops here ("9999+"). */
const MAX_COUNT = 9999;
/** …or after this long on a huge document. */
const COUNT_BUDGET_MS = 25;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// Lucide icon paths (ISC), inlined: the panel is plain DOM, not React.
const ICON = {
  chevron: svg('<path d="m9 18 6-6-6-6"/>'),
  up: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'),
  down: svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  selectAll: svg('<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/>'),
  replace: svg('<path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
  replaceAll: svg('<path d="M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/><path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
};

const ALT = IS_MAC ? '⌥' : 'Alt+';
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** Number of matches and which one is selected (1-based, 0 = none). */
export function countMatches(state: EditorState, query: SearchQuery, budgetMs = COUNT_BUDGET_MS): { total: number; current: number; capped: boolean } {
  if (!query.valid) return { total: 0, current: 0, capped: false };
  const sel = state.selection.main;
  const started = performance.now();
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    if (total >= MAX_COUNT || (total % 256 === 0 && performance.now() - started > budgetMs)) {
      return { total, current, capped: true };
    }
  }
  return { total, current, capped: false };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'cm-find-btn', { type: 'button', title: label, 'aria-label': label });
  b.innerHTML = icon;
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field
  b.addEventListener('click', onClick);
  return b;
}

function toggle(text: string, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `cm-find-toggle ${cls}`.trim(), { type: 'button', title: label, 'aria-label': label, 'aria-pressed': 'false' });
  b.textContent = text;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

/** The open widget of each editor (CodeMirror's getPanel can't see it: the
 *  search extension wraps `createPanel`). */
const panels = new WeakMap<EditorView, FindPanel>();

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private query: SearchQuery;
  private readonly field: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly replaceRow: HTMLElement;
  private readonly expand: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly toggles: { caseSensitive: HTMLButtonElement; wholeWord: HTMLButtonElement; regexp: HTMLButtonElement };
  private readonly navButtons: HTMLButtonElement[];
  private readonly replaceButtons: HTMLButtonElement[];
  private replaceOpen: boolean;
  private countFrame = 0;

  constructor(private readonly view: EditorView) {
    panels.set(view, this);
    this.query = getSearchQuery(view.state);
    // Open on Replace when the editor is editable and the query already has
    // replace text (re-opened panel), as VS Code remembers it.
    const editable = !view.state.readOnly;
    this.replaceOpen = editable && this.query.replace !== '';

    this.dom = el('div', 'cm-find', { role: 'search', 'aria-label': 'Find' });
    this.dom.addEventListener('keydown', (e) => this.onKey(e));

    this.expand = iconButton(ICON.chevron, 'Toggle Replace', () => this.setReplaceOpen(!this.replaceOpen));
    this.expand.classList.add('cm-find-expand');
    this.expand.setAttribute('aria-expanded', String(this.replaceOpen));
    if (!editable) this.expand.style.visibility = 'hidden';

    this.field = el('input', 'cm-find-input', {
      type: 'text', placeholder: 'Find', 'aria-label': 'Find', 'main-field': 'true',
      spellcheck: 'false', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    });
    this.field.value = this.query.search;
    this.field.addEventListener('input', () => this.commit());

    this.toggles = {
      caseSensitive: toggle('Aa', `Match Case (${ALT}C)`, () => this.flip('caseSensitive')),
      wholeWord: toggle('ab', `Match Whole Word (${ALT}W)`, () => this.flip('wholeWord'), 'cm-find-word'),
      regexp: toggle('.*', `Use Regular Expression (${ALT}R)`, () => this.flip('regexp')),
    };
    const box = el('div', 'cm-find-box');
    const toggleWrap = el('div', 'cm-find-toggles');
    toggleWrap.append(this.toggles.caseSensitive, this.toggles.wholeWord, this.toggles.regexp);
    box.append(this.field, toggleWrap);

    this.count = el('span', 'cm-find-count', { 'aria-live': 'polite' });
    this.navButtons = [
      iconButton(ICON.up, 'Previous Match (⇧Enter)', () => { findPrevious(this.view); }),
      iconButton(ICON.down, 'Next Match (Enter)', () => { findNext(this.view); }),
      iconButton(ICON.selectAll, `Select All Matches (${ALT}Enter)`, () => { selectMatches(this.view); }),
    ];
    const close = iconButton(ICON.close, 'Close (Esc)', () => { closeSearchPanel(this.view); });

    const findRow = el('div', 'cm-find-row');
    findRow.append(box, this.count, ...this.navButtons, close);

    this.replaceField = el('input', 'cm-find-input', {
      type: 'text', placeholder: 'Replace', 'aria-label': 'Replace',
      spellcheck: 'false', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
    });
    this.replaceField.value = this.query.replace;
    this.replaceField.addEventListener('input', () => this.commit());
    const replaceBox = el('div', 'cm-find-box');
    replaceBox.append(this.replaceField);
    this.replaceButtons = [
      iconButton(ICON.replace, 'Replace (Enter)', () => { replaceNext(this.view); }),
      iconButton(ICON.replaceAll, `Replace All (${MOD}Enter)`, () => { replaceAll(this.view); }),
    ];
    this.replaceRow = el('div', 'cm-find-row cm-find-replace');
    this.replaceRow.append(replaceBox, ...this.replaceButtons);

    const rows = el('div', 'cm-find-rows');
    rows.append(findRow, this.replaceRow);
    this.dom.append(this.expand, rows);
    this.render();
  }

  mount() {
    this.field.focus();
    this.field.select();
  }

  update(u: ViewUpdate) {
    for (const tr of u.transactions) {
      for (const e of tr.effects) {
        if (e.is(setSearchQuery) && !e.value.eq(this.query)) {
          this.query = e.value;
          this.field.value = this.query.search;
          this.replaceField.value = this.query.replace;
        }
      }
    }
    if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) {
      this.scheduleCount();
    }
    // Read-only can flip (e.g. a viewer switching modes).
    if (u.state.readOnly !== u.startState.readOnly) this.render();
  }

  destroy() {
    if (panels.get(this.view) === this) panels.delete(this.view);
    cancelAnimationFrame(this.countFrame);
  }

  private commit() {
    const q = new SearchQuery({
      search: this.field.value,
      caseSensitive: this.query.caseSensitive,
      regexp: this.query.regexp,
      wholeWord: this.query.wholeWord,
      replace: this.replaceField.value,
      literal: this.query.literal,
    });
    if (q.eq(this.query)) return;
    this.query = q;
    this.view.dispatch({ effects: setSearchQuery.of(q) });
    this.render();
  }

  private flip(key: 'caseSensitive' | 'wholeWord' | 'regexp') {
    const q = new SearchQuery({
      search: this.query.search, caseSensitive: this.query.caseSensitive, regexp: this.query.regexp,
      wholeWord: this.query.wholeWord, replace: this.query.replace, literal: this.query.literal,
      [key]: !this.query[key],
    });
    this.query = q;
    this.view.dispatch({ effects: setSearchQuery.of(q) });
    this.render();
  }

  setReplaceOpen(open: boolean) {
    if (this.view.state.readOnly) open = false;
    this.replaceOpen = open;
    this.render();
    (open ? this.replaceField : this.field).focus();
  }

  private render() {
    const editable = !this.view.state.readOnly;
    if (!editable) this.replaceOpen = false;
    this.expand.style.visibility = editable ? '' : 'hidden';
    this.expand.setAttribute('aria-expanded', String(this.replaceOpen));
    this.dom.classList.toggle('cm-find-open', this.replaceOpen);
    this.replaceRow.hidden = !this.replaceOpen;
    for (const key of ['caseSensitive', 'wholeWord', 'regexp'] as const) {
      this.toggles[key].setAttribute('aria-pressed', String(this.query[key]));
    }
    const invalid = this.query.search !== '' && !this.query.valid;
    this.field.classList.toggle('cm-find-invalid', invalid);
    this.field.setAttribute('aria-invalid', String(invalid));
    this.scheduleCount();
  }

  /** Counting walks the document, so it runs once per frame at most. */
  private scheduleCount() {
    cancelAnimationFrame(this.countFrame);
    this.countFrame = requestAnimationFrame(() => this.renderCount());
  }

  private renderCount() {
    const q = this.query;
    let text = '';
    let none = false;
    if (q.search && !q.valid) text = 'Invalid regex';
    else if (q.search) {
      const { total, current, capped } = countMatches(this.view.state, q);
      none = total === 0;
      const of = `${total}${capped ? '+' : ''}`;
      text = none ? 'No results' : current ? `${current} of ${of}` : `${of} found`;
    }
    this.count.textContent = text;
    this.count.classList.toggle('cm-find-none', none || (q.search !== '' && !q.valid));
    for (const b of this.navButtons) b.disabled = !q.valid || none;
    for (const b of this.replaceButtons) b.disabled = !q.valid || none;
  }

  private onKey(e: KeyboardEvent) {
    const inReplace = e.target === this.replaceField;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    // The editor keymap doesn't see keys typed in the widget: handle the
    // Replace shortcut here too.
    if ((mod && e.altKey && e.code === 'KeyF') || (!IS_MAC && e.ctrlKey && !e.altKey && e.code === 'KeyH')) {
      e.preventDefault();
      this.setReplaceOpen(!this.replaceOpen || e.target !== this.replaceField);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(this.view);
      this.view.focus();
    } else if (e.key === 'Enter' && inReplace) {
      e.preventDefault();
      if (mod) replaceAll(this.view); else replaceNext(this.view);
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      selectMatches(this.view);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) findPrevious(this.view); else findNext(this.view);
    } else if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      // e.code: ⌥ changes e.key on macOS (⌥C → ç).
      const key = ({ KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyR: 'regexp' } as const)[e.code as 'KeyC'];
      if (key) { e.preventDefault(); this.flip(key); }
    }
  }
}

const FIND_CONFIG = {
  top: true,
  createPanel: (view: EditorView) => new FindPanel(view),
  // The card floats over the top-right of the text: keep the match clear of it.
  scrollToMatch: (range: { from: number; to: number }) => EditorView.scrollIntoView(range.from, { y: 'center' }),
};

/** ⌘⌥F (and Ctrl+H off macOS, where ⌘H hides the app): Find with Replace open. */
export const openReplace: Command = (view) => {
  openSearchPanel(view);
  panels.get(view)?.setReplaceOpen(true);
  return true;
};

/** Find colors and the widget's look; tokens in tokens.css (`--find-*`). */
const findTheme = EditorView.theme({
  // Matches: an amber wash for every match, a solid amber block with an
  // outline for the current one — readable over any syntax color, and
  // distinct from the (blue) selection and same-word highlights.
  '.cm-searchMatch': {
    backgroundColor: 'var(--find-match-bg)',
    outline: '1px solid var(--find-match-edge)',
    outlineOffset: '-1px',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected, .cm-searchMatch-selected .cm-searchMatch': {
    backgroundColor: 'var(--find-current-bg)',
    outline: '2px solid var(--find-current-edge)',
    outlineOffset: '-1px',
  },

  // The panel container: no bar, the card floats.
  '.cm-panels.cm-panels-top': { backgroundColor: 'transparent', borderBottom: 'none', zIndex: '5' },
  '.cm-find': {
    position: 'absolute',
    top: '6px',
    right: '14px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '2px',
    maxWidth: 'calc(100% - 20px)',
    padding: '4px',
    borderRadius: '8px',
    border: '1px solid hsl(var(--line-c))',
    backgroundColor: 'hsl(var(--card-c))',
    boxShadow: '0 6px 20px rgb(0 0 0 / 0.22), 0 1px 2px rgb(0 0 0 / 0.12)',
    fontFamily: 'var(--sans)',
    fontSize: '12px',
    lineHeight: '1',
    color: 'hsl(var(--fg-c))',
    letterSpacing: 'normal',
    fontWeight: '400',
  },
  '.cm-find-rows': { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '0', flex: '1 1 auto' },
  '.cm-find-row': { display: 'flex', alignItems: 'center', gap: '2px', minWidth: '0' },
  '.cm-find-row[hidden]': { display: 'none' },
  '.cm-find-box': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    // Shrinks in a narrow editor (a split pane, a small field).
    flex: '0 1 240px',
    minWidth: '96px',
    marginRight: '4px',
  },
  '.cm-find-input': {
    width: '100%',
    minWidth: '0',
    height: '26px',
    padding: '0 8px',
    border: '1px solid hsl(var(--line-c))',
    borderRadius: '5px',
    backgroundColor: 'hsl(var(--bg-c))',
    color: 'hsl(var(--fg-c))',
    fontFamily: 'var(--mono)',
    fontSize: '12.5px',
    outline: 'none',
    transition: 'border-color var(--dur-fast) var(--ease-out-soft), box-shadow var(--dur-fast) var(--ease-out-soft)',
  },
  '.cm-find-box:has(.cm-find-toggles) .cm-find-input': { paddingRight: '76px' },
  '.cm-find-input::placeholder': { color: 'hsl(var(--fg-mute-c) / 0.8)', fontFamily: 'var(--sans)' },
  '.cm-find-input:focus': { borderColor: 'hsl(var(--acc-c) / 0.7)', boxShadow: '0 0 0 3px hsl(var(--acc-c) / 0.2)' },
  '.cm-find-input.cm-find-invalid': { borderColor: 'hsl(var(--bad-c))', boxShadow: '0 0 0 3px hsl(var(--bad-c) / 0.18)' },
  '.cm-find-toggles': { position: 'absolute', right: '3px', display: 'flex', gap: '1px' },
  '.cm-find-toggle': {
    height: '20px',
    minWidth: '22px',
    padding: '0 3px',
    border: '1px solid transparent',
    borderRadius: '4px',
    background: 'none',
    color: 'hsl(var(--fg-mute-c))',
    fontFamily: 'var(--mono)',
    fontSize: '11.5px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  '.cm-find-word': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.cm-find-toggle:hover': { backgroundColor: 'hsl(var(--bg-2-c))', color: 'hsl(var(--fg-c))' },
  '.cm-find-toggle[aria-pressed="true"]': {
    backgroundColor: 'hsl(var(--acc-c) / 0.18)',
    borderColor: 'hsl(var(--acc-c) / 0.6)',
    color: 'hsl(var(--acc-ink-c))',
  },
  '.cm-find-count': {
    minWidth: '0',
    flex: '0 0 auto',
    padding: '0 6px',
    color: 'hsl(var(--fg-mute-c))',
    fontSize: '11.5px',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-find-count.cm-find-none': { color: 'hsl(var(--bad-c))' },
  '.cm-find-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    width: '26px',
    height: '26px',
    border: 'none',
    borderRadius: '5px',
    background: 'none',
    color: 'hsl(var(--fg-mute-c))',
    cursor: 'pointer',
  },
  '.cm-find-btn:hover:not(:disabled)': { backgroundColor: 'hsl(var(--bg-2-c))', color: 'hsl(var(--fg-c))' },
  '.cm-find-btn:disabled': { opacity: '0.35', cursor: 'default' },
  '.cm-find-btn:focus-visible, .cm-find-toggle:focus-visible': { outline: '2px solid hsl(var(--acc-c) / 0.6)', outlineOffset: '1px' },
  '.cm-find-expand': { width: '18px', height: '26px' },
  '.cm-find-expand svg': { transition: 'transform var(--dur-fast) var(--ease-out-soft)' },
  '.cm-find.cm-find-open .cm-find-expand svg': { transform: 'rotate(90deg)' },
  // The replace row lines up with the find field (the count/nav column is
  // left empty, as in VS Code).
  '.cm-find-replace .cm-find-box': { marginRight: '4px' },
});

/** The find widget plus its theme. One instance: include it as is. */
export const findWidget = [
  search(FIND_CONFIG),
  findTheme,
  keymap.of([{ key: 'Mod-Alt-f', run: openReplace }, ...(IS_MAC ? [] : [{ key: 'Ctrl-h', run: openReplace }])]),
];
