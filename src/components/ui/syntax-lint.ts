// Generic "parser noticed a syntax error" linter — for languages that don't
// have (and don't need) a real semantic linter, but whose lezer grammar
// already marks unparseable spans as error nodes while parsing. JSON has its
// own dedicated `jsonParseLinter` (precise, whole-document parse); this is
// the equivalent for JS and SQL, which only have grammars, not a linter
// package of their own.
//
// Cheap and approximate by nature: mid-typing incomplete input can produce
// transient error nodes the parser would resolve a keystroke later. `linter()`
// already debounces before running, which covers the common case.

import { linter, type Diagnostic } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

export function syntaxErrorLinter(): Extension {
  return linter((view) => {
    const diagnostics: Diagnostic[] = [];
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.type.isError) {
          diagnostics.push({
            from: node.from,
            to: Math.max(node.to, node.from + 1),
            severity: 'error',
            message: 'Syntax error',
          });
        }
      },
    });
    return diagnostics;
  });
}
