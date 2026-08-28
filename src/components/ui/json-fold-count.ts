// CodeMirror fold-placeholder for JSON: collapsing an object/array shows how
// many keys/items it holds ("⋯ 3 keys" / "⋯ 12 items") instead of the generic
// "…" every other language falls back to. Folding is exactly the moment you
// trade away visibility into what's inside a node — a count is the cheapest
// way to get some of that back without unfolding.
//
// Shared by every JSON surface (JsonEditor for request/GraphQL-variables
// bodies, CodeViewer for response bodies) rather than duplicated per call
// site — see code-editor.tsx / code-viewer.tsx.

import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { codeFolding, syntaxTree } from '@codemirror/language';

// The @lezer/json grammar's `value` rule (an Array's children, alongside the
// "[" "," "]" punctuation) expands to exactly this set of named node types —
// see node_modules/@lezer/json/src/json.grammar.
const ARRAY_ELEMENT = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null']);

interface Prepared {
  count: number;
  noun: string;
}

// codeFolding's `range` is the *inside* of the brackets (the grammar's own
// foldInside trims them: `{from: firstChild.to, to: lastChild.from}`, i.e.
// the `{`/`}` or `[`/`]` tokens themselves), so the Object/Array node sits
// just outside that range rather than containing it — walk up from the first
// token inside instead of resolving `range.from` directly, which lands on
// that first child, not the container.
function containerAt(state: EditorState, from: number, to: number) {
  // `SyntaxNode` itself comes from `@lezer/common`, a transitive-only
  // dependency here — this indexed-access alias gets the same type via
  // inference instead of importing a package that isn't declared directly.
  type Node = ReturnType<typeof syntaxTree>['topNode'];
  let node: Node | null = syntaxTree(state).resolveInner(from, 1);
  while (node) {
    if ((node.type.name === 'Object' || node.type.name === 'Array') && node.from + 1 === from && node.to - 1 === to) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

// Exported (only) for json-fold-count.test.ts — the tree-walking assumptions
// here are what a future CodeMirror/@lezer/json upgrade is most likely to
// quietly break, so they're worth locking down directly rather than only
// through the full fold/render cycle.
export function prepareJsonPlaceholder(state: EditorState, range: { from: number; to: number }): Prepared | null {
  const node = containerAt(state, range.from, range.to);
  if (!node) return null;
  let count = 0;
  if (node.type.name === 'Object') {
    for (let child = node.firstChild; child; child = child.nextSibling) if (child.type.name === 'Property') count++;
    return { count, noun: count === 1 ? 'key' : 'keys' };
  }
  for (let child = node.firstChild; child; child = child.nextSibling) if (ARRAY_ELEMENT.has(child.type.name)) count++;
  return { count, noun: count === 1 ? 'item' : 'items' };
}

// `prepared` is null for a fold this can't explain (shouldn't happen for a
// JSON-only extension, but codeFolding's type allows it) — fall back to the
// plain ellipsis rather than showing nothing.
function jsonPlaceholderDOM(_view: EditorView, onclick: (event: Event) => void, prepared: Prepared | null): HTMLElement {
  const el = document.createElement('span');
  el.className = 'cm-foldPlaceholder';
  el.textContent = prepared ? `⋯ ${prepared.count} ${prepared.noun}` : '…';
  el.addEventListener('click', onclick);
  return el;
}

/** Layers onto whatever `codeFolding()` `basicSetup` already installs —
 *  `preparePlaceholder`/`placeholderDOM` are a config facet, and a later
 *  `codeFolding()` instance's explicit options win over an earlier one's. */
export const jsonFoldCount = codeFolding({
  preparePlaceholder: prepareJsonPlaceholder,
  placeholderDOM: jsonPlaceholderDOM,
});
