// A single-line input (CodeMirror) for fields that accept {{variables}}. It
// highlights every {{name}} token — green when the variable is known, red when
// it isn't — and pops an autocomplete list of known variables while the caret is
// inside a {{ }}. Used by the URL bar; reusable for any var-aware field.

import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { cn } from '@/lib/utils';
import { varExtensions, varTheme } from './varSupport';

interface Props {
  value: string;
  onChange: (v: string) => void;
  vars: Record<string, string>;   // known variable name → current value
  placeholder?: string;
  onEnter?: () => void;
  className?: string;
}

const theme = EditorView.theme({
  '&': { fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'hidden', fontFamily: 'inherit' },
  '.cm-content': { padding: '0', caretColor: 'hsl(var(--foreground))' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
  '.cm-placeholder': { color: 'hsl(var(--muted-foreground) / 0.6)' },
  '.cm-var, .cm-var-unknown': { fontSize: '11px' },
});

export function VarInput({ value, onChange, vars, placeholder, onEnter, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Live refs so the editor (created once) always sees fresh callbacks/vars.
  const varsRef = useRef(vars);
  varsRef.current = vars;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onEnterRef = useRef(onEnter); onEnterRef.current = onEnter;
  const lastValue = useRef(value);

  useEffect(() => {
    if (!ref.current) return;

    // Keep it to one line: flatten any inserted newlines.
    const singleLine = EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      let multiline = false;
      tr.changes.iterChanges((_a, _b, _c, _d, ins) => { if (ins.lines > 1) multiline = true; });
      if (!multiline) return tr;
      const changes: { from: number; to: number; insert: string }[] = [];
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString().replace(/[\r\n]+/g, ' ') });
      });
      return [{ changes }];
    });

    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...varExtensions(() => varsRef.current),
          singleLine,
          cmPlaceholder(placeholder ?? ''),
          theme,
          varTheme,
          keymap.of([{ key: 'Enter', run: () => { onEnterRef.current?.(); return true; } }]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const v = u.state.doc.toString();
            lastValue.current = v;
            onChangeRef.current(v);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external value changes (switching requests/tabs) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValue.current) return;
    lastValue.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // Refresh highlighting when the set of known variables changes (e.g. env swap).
  useEffect(() => {
    viewRef.current?.dispatch({});
  }, [vars]);

  return <div ref={ref} className={cn('min-w-0 flex-1', className)} />;
}
