// Internal engine shared by every editable code surface (JsonEditor,
// JavaScriptEditor, SqlEditor, TextEditor). Not exported from the design
// system — tool code should never import this directly or reach into
// CodeMirror itself. Each language-specific wrapper picks its own `lang` and
// `extraExtensions` (e.g. JSON's linter) and otherwise gets an identical,
// consistently-themed editing surface for free: Tab/Shift-Tab indent, smart
// bracket skip-over, {{variable}} support, read-only handling, blur/change
// wiring. Adding a feature here (or swapping the underlying engine entirely)
// changes every tool at once instead of a dozen copies.

import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { type LanguageSupport } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { cn } from '@/lib/utils';
import { smartBracketSkip, useCodeTheme } from '@/components/ui/code-theme';
import { varExtensions, varTheme } from '@/components/ui/var-support';

export interface CodeSurfaceProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  // When provided, {{variables}} are highlighted/autocompleted in the editor
  // (used for the request body; omitted for scripts/tests).
  vars?: Record<string, string>;
  // When true the document can't be edited (read-only output view). Fixed at mount.
  readOnly?: boolean;
  // Fired when the editor loses focus, with the current value (e.g. to reformat).
  onBlur?: (value: string) => void;
}

interface Props extends CodeSurfaceProps {
  // Grammar for syntax highlighting; `null` applies none (plain text). Fixed
  // at mount — the wrapper component identity (JsonEditor vs TextEditor, …)
  // is what changes it, which already remounts.
  lang: LanguageSupport | null;
  // Language-specific extras layered on top of the shared engine — e.g. the
  // JSON editor's inline linter. Fixed at mount, same as `lang`.
  extraExtensions?: Extension[];
}

export function CodeSurface({
  value, onChange, placeholder, className, vars, lang, extraExtensions = [], readOnly = false, onBlur,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const lastValueRef = useRef(value);
  const varsRef = useRef(vars);
  varsRef.current = vars;
  const hasVars = useRef(!!vars).current;
  const theme = useCodeTheme(viewRef, { activeLine: !readOnly });

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          // Tab/Shift-Tab indent and dedent instead of leaving the editor to
          // move focus to the next element — must precede `basicSetup` to
          // take precedence over its keymaps. Read-only editors fall through
          // to the browser default (indentMore/Less no-op when readOnly), so
          // Tab still moves focus away from an output-only viewer.
          keymap.of([indentWithTab]),
          basicSetup,
          smartBracketSkip,
          // Stop macOS/WebKit from substituting smart quotes / autocorrecting
          // code — a typed " must stay a straight ASCII quote (curly quotes
          // break JSON). No-op on Windows/Linux WebViews.
          EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
          ...(lang ? [lang] : []),
          ...extraExtensions,
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          // Fixed at mount, same as `lang`/`extraExtensions` — no call site needs
          // this to change without also remounting (e.g. RawEditor swaps
          // component identity when body.mode changes). CodeMirror's own
          // placeholder decoration (not a hand-rolled overlay) is what
          // InlineCodeField already uses — it renders inline in the real
          // document flow, so multi-line text wraps correctly and it's never
          // out of step with the actual caret position.
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          theme.extension,
          EditorView.lineWrapping,
          ...(hasVars ? [...varExtensions(() => varsRef.current ?? {}), varTheme] : []),
          EditorView.updateListener.of((upd) => {
            if (!upd.docChanged) return;
            const val = upd.state.doc.toString();
            lastValueRef.current = val;
            onChangeRef.current(val);
          }),
          EditorView.domEventHandlers({
            blur: () => { onBlurRef.current?.(viewRef.current?.state.doc.toString() ?? ''); return false; },
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh {{var}} highlighting when the known variable set changes.
  useEffect(() => {
    if (hasVars) viewRef.current?.dispatch({});
  }, [vars, hasVars]);

  // Reflect external value changes (e.g. switching tabs) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValueRef.current) return;
    lastValueRef.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return (
    <div
      className={cn(
        // Công thức vòng focus đã gom về một chỗ trong app: `ring-[3px]` màu
        // `--acc-ring` (bí danh `ring-focus`), không offset. Trước là
        // `ring-2 ring-acc/40` riêng của mỗi editor — không dính lỗi "dính lại
        // sau khi bấm chuột" (đây là `focus-within`, đúng ngữ nghĩa vì
        // CodeMirror không phải input gốc), nhưng khác công thức với input,
        // textarea, select, button trong cùng app.
        'flex flex-col flex-1 min-h-[180px] overflow-hidden rounded-md border border-sunk bg-bg shadow-sm transition-shadow duration-fast ease-out-soft hover:border-line/80 focus-within:shadow-none focus-within:ring-[3px] focus-within:ring-focus',
        className,
      )}
    >
      <div ref={containerRef} className="flex flex-col flex-1 min-h-0" />
    </div>
  );
}
