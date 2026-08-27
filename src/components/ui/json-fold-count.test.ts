import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forceParsing, foldEffect, syntaxTree } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { jsonFoldCount, prepareJsonPlaceholder } from './json-fold-count';

// A headless view (no `parent`) is enough to force the language parser to
// finish synchronously — preparePlaceholder never needs the view mounted.
function stateFor(doc: string): EditorState {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [json()] }) });
  forceParsing(view, doc.length, 5000);
  return view.state;
}

// The fold range codeFolding() would hand `prepareJsonPlaceholder` for the
// Object/Array whose opening bracket sits at `bracketPos` — computed the same
// way the grammar's own `foldInside` does (trim the outer `{`/`}` or `[`/`]`),
// so this exercises exactly the input shape `containerAt` has to reverse,
// without going through CodeMirror's own line-based fold-service query (a
// separate, already-tested concern upstream).
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

function bracketRangeAt(state: EditorState, bracketPos: number) {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(bracketPos, 1);
  while (node && node.type.name !== 'Object' && node.type.name !== 'Array') node = node.parent;
  if (!node) throw new Error(`no Object/Array node at position ${bracketPos}`);
  return { from: node.from + 1, to: node.to - 1 };
}

describe('prepareJsonPlaceholder', () => {
  it('counts top-level keys in an object', () => {
    const state = stateFor('{"a":1,"b":2,"c":3}');
    expect(prepareJsonPlaceholder(state, bracketRangeAt(state, 0))).toEqual({ count: 3, noun: 'keys' });
  });

  it('uses the singular noun for exactly one key', () => {
    const state = stateFor('{"a":1}');
    expect(prepareJsonPlaceholder(state, bracketRangeAt(state, 0))).toEqual({ count: 1, noun: 'key' });
  });

  it('counts top-level items in an array, using the singular noun for one', () => {
    const many = stateFor('[1,2,3,4,5]');
    expect(prepareJsonPlaceholder(many, bracketRangeAt(many, 0))).toEqual({ count: 5, noun: 'items' });

    const one = stateFor('[1]');
    expect(prepareJsonPlaceholder(one, bracketRangeAt(one, 0))).toEqual({ count: 1, noun: 'item' });
  });

  it('counts an empty array/object as zero, not null', () => {
    const state = stateFor('{"a":[],"b":{}}');
    expect(prepareJsonPlaceholder(state, bracketRangeAt(state, 0))).toEqual({ count: 2, noun: 'keys' });
  });

  it("counts only a folded node's own direct children, not nested keys/items", () => {
    const doc = '{"a":{"x":1,"y":2},"b":[1,2,3]}';
    const state = stateFor(doc);

    expect(prepareJsonPlaceholder(state, bracketRangeAt(state, 0))).toEqual({ count: 2, noun: 'keys' });

    const nestedObjPos = doc.indexOf('{"x"');
    expect(prepareJsonPlaceholder(state, bracketRangeAt(state, nestedObjPos))).toEqual({ count: 2, noun: 'keys' });

    const nestedArrPos = doc.indexOf('[1,2,3]');
    expect(prepareJsonPlaceholder(state, bracketRangeAt(state, nestedArrPos))).toEqual({ count: 3, noun: 'items' });
  });

  it('returns null for a range that is not a real JSON Object/Array fold boundary', () => {
    const state = stateFor('{"a":1}');
    expect(prepareJsonPlaceholder(state, { from: 0, to: 1 })).toBeNull();
  });
});

// Exercises the full extension end to end — fold a real node in a mounted
// EditorView and read the rendered `.cm-foldPlaceholder` DOM — rather than
// only the pure `prepareJsonPlaceholder` function above. This is what
// actually proves `jsonFoldCount`'s `codeFolding({...})` config wins over
// basicSetup's own default `codeFolding()` instance (a config facet, merged
// rather than replaced — see the comment on `jsonFoldCount`) instead of the
// two silently coexisting with the default "…" placeholder still showing.
describe('jsonFoldCount (end to end)', () => {
  it('renders the item count in the DOM after folding a real array', () => {
    const doc = '{"users":[{"id":1},{"id":2},{"id":3}],"total":3}';
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [json(), jsonFoldCount] }),
      parent: document.createElement('div'),
    });
    forceParsing(view, doc.length, 5000);

    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(doc.indexOf('['), 1);
    while (node && node.type.name !== 'Array') node = node.parent;
    if (!node) throw new Error('array not found');
    view.dispatch({ effects: foldEffect.of({ from: node.from + 1, to: node.to - 1 }) });

    const placeholder = view.dom.querySelector('.cm-foldPlaceholder');
    expect(placeholder?.textContent).toBe('⋯ 3 items');
  });
});
