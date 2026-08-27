// Read-only CodeMirror viewer — response bodies, converted/generated output,
// stub previews. Line numbers, code folding, and syntax highlighting, matching
// Bruno's response pane. Themed via the same CSS variables as the rest of the
// app. The design system's one read-only code surface: unlike the editable
// JsonEditor/JavaScriptEditor/SqlEditor/TextEditor split, there's no
// language-specific *behavior* to gate here (nothing to lint in output you
// can't edit), so a single component with a `language` prop covers every
// tool that needs to display code.

import { useEffect, useMemo, useRef } from 'react';
import { EditorView, basicSetup, minimalSetup } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { useCodeTheme } from '@/components/ui/code-theme';
import { jsonFoldCount } from '@/components/ui/json-fold-count';

const jsonLang = json();
const sqlLang = sql();
const jsLang = javascript();

export interface CodeViewerProps {
  value: string;
  language: 'json' | 'sql' | 'javascript' | 'text';
  // Large bodies: skip line-wrapping, folding and highlighting (the parts that
  // bog down on multi-MB docs) for a plain, fast, scrollable view.
  plain?: boolean;
  // Shown in place of the empty state when `value` is empty (e.g. "Converted
  // output appears here…"). Omit where an empty value is never expected.
  placeholder?: string;
}

export function CodeViewer({ value, language, plain, placeholder }: CodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read-only: no active-line tint, and the gutter sits flush on the pane
  // rather than in its own tinted column.
  const theme = useCodeTheme(viewRef, { gutter: 'flush', activeLine: false, contentPadding: '6px 0' });

  const langExt = language === 'json' ? jsonLang : language === 'sql' ? sqlLang : language === 'javascript' ? jsLang : null;

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
        ...(langExt ? [langExt] : []),
        // Folding a key/item shows how many it holds instead of a bare "…" —
        // only meaningful for JSON's Object/Array nodes (see json-fold-count.ts).
        ...(language === 'json' ? [jsonFoldCount] : []),
        theme.extension,
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ]), [langExt, language, plain, theme.extension]);

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

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      <div ref={containerRef} className="flex flex-col flex-1 min-h-0 overflow-hidden" />
      {!value && placeholder && (
        <div className="pointer-events-none absolute left-9 top-2 font-mono text-[11px] text-fg-mute/50">
          {placeholder}
        </div>
      )}
    </div>
  );
}
