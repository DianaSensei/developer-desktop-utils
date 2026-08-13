// A single-line input (CodeMirror) for fields that accept {{variables}}. It
// highlights every {{name}} token — green when the variable is known, red when
// it isn't — and pops an autocomplete list of known variables while the caret is
// inside a {{ }}. Used by the URL bar; reusable for any var-aware field. Not a
// "code editor" in the JsonEditor/JavaScriptEditor/etc. sense — no grammar, no
// multi-line — so it stays a separate, narrower component rather than a mode
// of the others.

import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { cn } from '@/lib/utils';
import { useCodeTheme } from '@/components/ui/code-theme';
import { varExtensions, varTheme } from '@/components/ui/var-support';

export interface InlineCodeFieldProps {
  value: string;
  onChange: (v: string) => void;
  vars: Record<string, string>;   // known variable name → current value
  placeholder?: string;
  onEnter?: () => void;
  className?: string;
}

// Single-line specifics on top of the shared code theme: no flex fill, no
// padding, and the scroller must not scroll (the field is one line).
const singleLineTheme = EditorView.theme({
  '.cm-scroller': { overflow: 'hidden' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'hsl(var(--muted-foreground) / 0.6)' },
  '.cm-var, .cm-var-unknown': { fontSize: '11px' },
});

export function InlineCodeField({ value, onChange, vars, placeholder, onEnter, className }: InlineCodeFieldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Live refs so the editor (created once) always sees fresh callbacks/vars.
  const varsRef = useRef(vars);
  varsRef.current = vars;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onEnterRef = useRef(onEnter); onEnterRef.current = onEnter;
  const lastValue = useRef(value);
  const theme = useCodeTheme(viewRef, { fontSize: '12px', contentPadding: '0', fill: false, activeLine: false });

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
          theme.extension,
          singleLineTheme,
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
