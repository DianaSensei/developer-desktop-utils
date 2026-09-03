// Read-only CodeMirror viewer — response bodies, converted/generated output,
// stub previews. Line numbers, code folding, and syntax highlighting, matching
// Bruno's response pane. Themed via the same CSS variables as the rest of the
// app. The design system's one read-only code surface: unlike the editable
// JsonEditor/JavaScriptEditor/SqlEditor/TextEditor split, there's no
// language-specific *behavior* to gate here (nothing to lint in output you
// can't edit), so a single component with a `language` prop covers every
// tool that needs to display code.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorView, basicSetup, minimalSetup } from 'codemirror';
import { keymap, lineNumbers } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
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

export interface CodeViewerHandle {
  /** Focuses the editor and opens CodeMirror's own find/replace panel — the
   *  same one Ctrl+F/Cmd+F already triggers while the editor has focus, for a
   *  caller that wants a visible "Search" button to do the same thing without
   *  requiring the user to click into the text first. */
  openSearch: () => void;
}

export const CodeViewer = forwardRef<CodeViewerHandle, CodeViewerProps>(function CodeViewer(
  { value, language, plain, placeholder }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read-only: no active-line tint, and the gutter sits flush on the pane
  // rather than in its own tinted column.
  const theme = useCodeTheme(viewRef, { gutter: 'flush', activeLine: false, paddingY: 6 });

  const langExt = language === 'json' ? jsonLang : language === 'sql' ? sqlLang : language === 'javascript' ? jsLang : null;

  const extensions = useMemo(() => (plain
    ? [
        minimalSetup,
        lineNumbers(),
        // basicSetup (below) already carries searchKeymap — minimalSetup
        // doesn't, so a large/plain body would otherwise have no way to
        // trigger search at all, the case it's arguably most useful for.
        keymap.of(searchKeymap),
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

  useImperativeHandle(ref, () => ({
    openSearch: () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      openSearchPanel(view);
    },
  }), []);

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      <div ref={containerRef} className="flex flex-col flex-1 min-h-0 overflow-hidden" />
      {!value && placeholder && (
        // `left-12` (48px), not the old 36px: `.cm-content` now carries a real
        // 12px left padding (see code-theme.ts) that it didn't before, so the
        // actual first character of typed/pasted text sits 12px further right
        // than this overlay used to assume. Both numbers are eyeballed against
        // the gutter's own width rather than computed — CodeMirror doesn't
        // expose it before first layout — so "close enough to read as the
        // same baseline" is the actual bar, not pixel-exact alignment.
        <div className="pointer-events-none absolute left-12 top-2 font-mono text-[11px] text-fg-mute/50">
          {placeholder}
        </div>
      )}
    </div>
  );
});
