import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { SearchQuery, getSearchQuery, openSearchPanel } from '@codemirror/search';
import { codeTheme } from './code-theme';
import { countMatches, openReplace } from './code-find';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function make(doc: string, readOnly = false) {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [codeTheme(false), EditorState.readOnly.of(readOnly)] }),
    parent: document.body.appendChild(document.createElement('div')),
  });
  return view;
}

const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

describe('countMatches', () => {
  it('counts matches and finds the selected one', () => {
    const state = EditorState.create({ doc: 'id x id y id', selection: { anchor: 5, head: 7 } });
    expect(countMatches(state, new SearchQuery({ search: 'id' }))).toEqual({ total: 3, current: 2, capped: false });
    expect(countMatches(state, new SearchQuery({ search: '(', regexp: true })).total).toBe(0);
  });
});

describe('find widget', () => {
  it('replaces the default panel and drives the search query', () => {
    const v = make('alpha beta alpha');
    openSearchPanel(v);
    const root = v.dom.querySelector('.cm-find')!;
    expect(root).not.toBeNull();
    expect(v.dom.querySelector('.cm-search')).toBeNull();
    const field = root.querySelector<HTMLInputElement>('input[main-field]')!;
    type(field, 'alpha');
    expect(getSearchQuery(v.state).search).toBe('alpha');

    key(field, { key: 'Enter' });
    const sel = v.state.selection.main;
    expect(v.state.sliceDoc(sel.from, sel.to)).toBe('alpha');

    // Toggles flip the query options.
    root.querySelector<HTMLButtonElement>('.cm-find-toggle')!.click();
    expect(getSearchQuery(v.state).caseSensitive).toBe(true);
    key(field, { key: 'w', code: 'KeyW', altKey: true });
    expect(getSearchQuery(v.state).wholeWord).toBe(true);
  });

  it('replaces from the Replace row (Enter = next, Mod+Enter = all)', () => {
    const v = make('a1 a2 a3');
    openReplace(v);
    const [field, replace] = [...v.dom.querySelectorAll<HTMLInputElement>('.cm-find-input')];
    expect(v.dom.querySelector<HTMLElement>('.cm-find-replace')!.hidden).toBe(false);
    type(field, 'a');
    type(replace, 'b');
    key(replace, { key: 'Enter', ctrlKey: true, metaKey: true });
    expect(v.state.doc.toString()).toBe('b1 b2 b3');
  });

  it('hides Replace in a read-only editor and closes on Escape', () => {
    const v = make('text', true);
    openReplace(v);
    expect(v.dom.querySelector<HTMLElement>('.cm-find-replace')!.hidden).toBe(true);
    key(v.dom.querySelector('.cm-find-input')!, { key: 'Escape' });
    expect(v.dom.querySelector('.cm-find')).toBeNull();
  });
});
