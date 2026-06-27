// Lightweight CodeMirror 6 JavaScript editor, themed to match the app (reuses
// the same CSS-variable theme approach as SqlFormatter). Used for the pre/post
// request scripts and the tests editor — Bruno also uses CodeMirror here.

import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/utils';
import { varExtensions, varTheme } from './varSupport';

const jsLang = javascript();
const jsonLang = json();
const sqlLang = sql();

const editorTheme = EditorView.theme({
  // flex:1 (not height:100%) fills the parent in flex chains without an explicit pixel height.
  '&': {
    flex: '1 1 0',
    minHeight: '0',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  '&.cm-focused': { outline: 'none' },
  // minHeight:0 lets the scroller shrink inside a constrained flex container.
  '.cm-scroller': { overflow: 'auto', minHeight: '0' },
  '.cm-content': { caretColor: 'hsl(var(--foreground))', padding: '8px 0' },
  '.cm-gutters': {
    backgroundColor: 'hsl(var(--muted) / 0.4)',
    color: 'hsl(var(--muted-foreground))',
    border: 'none',
    borderRight: '1px solid hsl(var(--border))',
  },
  '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--primary) / 0.08)' },
  '.cm-activeLine': { backgroundColor: 'hsl(var(--primary) / 0.05)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--primary) / 0.2)',
  },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
});

const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sql-keyword, hsl(265 80% 60%))', fontWeight: '600' },
  { tag: [tags.string, tags.regexp], color: 'var(--sql-string, hsl(140 50% 45%))' },
  { tag: tags.comment, color: 'var(--sql-comment, hsl(var(--muted-foreground)))', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--sql-number, hsl(25 80% 55%))' },
  { tag: tags.function(tags.name), color: 'var(--js-method, hsl(265 70% 60%))' },
  { tag: tags.propertyName, color: 'var(--js-property, hsl(35 90% 50%))' },
  { tag: [tags.bool, tags.null], color: 'var(--sql-keyword, hsl(265 80% 60%))', fontWeight: '600' },
  { tag: tags.definition(tags.variableName), color: 'var(--sql-function, hsl(180 50% 45%))' },
]);

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  // When provided, {{variables}} are highlighted/autocompleted in the editor
  // (used for the request body; omitted for scripts/tests).
  vars?: Record<string, string>;
  // Grammar used for syntax highlighting. Defaults to JavaScript (scripts).
  // 'text' applies no grammar (plain). Language is fixed at mount — change the
  // component `key` to switch it.
  language?: 'javascript' | 'json' | 'sql' | 'text';
  // When true the document can't be edited (read-only output view). Fixed at mount.
  readOnly?: boolean;
  // Fired when the editor loses focus, with the current value (e.g. to reformat).
  onBlur?: (value: string) => void;
}

export function CodeEditor({ value, onChange, placeholder, className, vars, language = 'javascript', readOnly = false, onBlur }: Props) {
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
  const lang = useRef<LanguageSupport | null>(
    language === 'json' ? jsonLang : language === 'sql' ? sqlLang : language === 'text' ? null : jsLang,
  ).current;

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          // Stop macOS/WebKit from substituting smart quotes / autocorrecting
          // code — a typed " must stay a straight ASCII quote (curly quotes
          // break JSON). No-op on Windows/Linux WebViews.
          EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
          ...(lang ? [lang] : []),
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          syntaxHighlighting(codeHighlight),
          editorTheme,
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
    <div className={cn('relative flex flex-col flex-1 min-h-[180px] overflow-hidden rounded-md border', className)}>
      <div ref={containerRef} className="flex flex-col flex-1 min-h-0" />
      {!value && placeholder && (
        <div className="pointer-events-none absolute left-9 top-2 font-mono text-[11px] text-muted-foreground/50">
          {placeholder}
        </div>
      )}
    </div>
  );
}
