// Read-only CodeMirror viewer for response bodies — line numbers, code folding,
// and syntax highlighting (JSON when applicable, else plain), matching Bruno's
// response pane. Themed via the same CSS variables as the rest of the app.

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, basicSetup, minimalSetup } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { tags } from '@lezer/highlight';

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12.5px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { padding: '6px 0' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'hsl(var(--muted-foreground) / 0.5)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-foldGutter span': { color: 'hsl(var(--muted-foreground) / 0.7)' },
});

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--js-property, hsl(35 90% 55%))' },
  { tag: [tags.string], color: 'var(--sql-string, hsl(140 45% 55%))' },
  { tag: tags.number, color: 'var(--sql-number, hsl(210 90% 65%))' },
  { tag: [tags.bool, tags.null], color: 'var(--sql-keyword, hsl(265 80% 65%))', fontWeight: '600' },
  { tag: tags.punctuation, color: 'hsl(var(--muted-foreground))' },
]);

interface Props {
  value: string;
  language: 'json' | 'text';
  // Large bodies: skip line-wrapping, folding and highlighting (the parts that
  // bog down on multi-MB docs) for a plain, fast, scrollable view.
  plain?: boolean;
}

export function ResponseViewer({ value, language, plain }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const extensions = useMemo(() => (plain
    ? [
        minimalSetup,
        lineNumbers(),
        editorTheme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]
    : [
        basicSetup,
        ...(language === 'json' ? [json()] : []),
        syntaxHighlighting(highlight),
        editorTheme,
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]), [language, plain]);

  // Recreate the view when the language changes so the parser swaps cleanly.
  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  // Push new response text without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={containerRef} className="h-full" />;
}
