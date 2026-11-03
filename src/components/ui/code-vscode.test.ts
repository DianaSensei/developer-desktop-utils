import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { bracketDecorations, detectIndent } from './code-vscode';

function classesOf(doc: string) {
  const state = EditorState.create({ doc, extensions: [javascript()] });
  ensureSyntaxTree(state, doc.length, 5000);
  const out: string[] = [];
  const set = bracketDecorations(state, 0, doc.length);
  for (let it = set.iter(); it.value; it.next()) {
    out.push(`${doc[it.from]}${(it.value.spec as { class: string }).class.replace('cm-bracket-', '')}`);
  }
  return out.join(' ');
}

describe('bracket pair colorization', () => {
  it('cycles three colors by depth', () => {
    expect(classesOf('f(a[b{c}])')).toBe('(0 [1 {2 }2 ]1 )0');
    expect(classesOf('[[[[x]]]]')).toBe('[0 [1 [2 [0 ]0 ]2 ]1 ]0');
  });

  it('skips brackets in strings and comments, flags an unmatched closer', () => {
    expect(classesOf('f("(", /* [ */ x)')).toBe('(0 )0');
    expect(classesOf('a)')).toBe(')unmatched');
  });
});

describe('detectIndent', () => {
  it('finds 2 or 4 spaces from the common step', () => {
    expect(detectIndent('a {\n  b {\n    c\n  }\n}')).toEqual({ useTabs: false, size: 2 });
    expect(detectIndent('def f():\n    if x:\n        y\n    return 1')).toEqual({ useTabs: false, size: 4 });
  });

  it('prefers tabs when most lines are tab-indented, and falls back when flat', () => {
    expect(detectIndent('a\n\tb\n\t\tc\n\td').useTabs).toBe(true);
    expect(detectIndent('a\nb\nc', { useTabs: false, size: 2 })).toEqual({ useTabs: false, size: 2 });
  });

  it('ignores the one-space JSDoc continuation', () => {
    expect(detectIndent('/**\n * doc\n */\nfunction f() {\n  return 1;\n}')).toEqual({ useTabs: false, size: 2 });
  });
});
