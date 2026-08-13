// Read-only CodeMirror viewer for response bodies — line numbers, code folding,
// and syntax highlighting (JSON when applicable, else plain), matching Bruno's
// response pane. Themed via the same CSS variables as the rest of the app.

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, basicSetup, minimalSetup } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { useCodeTheme } from '@/components/ui/code-theme';

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
  // Read-only: no active-line tint, and the gutter sits flush on the pane
  // rather than in its own tinted column.
  const theme = useCodeTheme(viewRef, { gutter: 'flush', activeLine: false, contentPadding: '6px 0' });

  const extensions = useMemo(() => (plain
    ? [
        minimalSetup,
        lineNumbers(),
        theme.extension,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]
    : [
        basicSetup,
        ...(language === 'json' ? [json()] : []),
        theme.extension,
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]), [language, plain, theme.extension]);

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

  return <div ref={containerRef} className="flex flex-col flex-1 min-h-0 overflow-hidden" />;
}
