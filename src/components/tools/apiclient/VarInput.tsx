// A single-line input (CodeMirror) for fields that accept {{variables}}. It
// highlights every {{name}} token — green when the variable is known, red when
// it isn't — and pops an autocomplete list of known variables while the caret is
// inside a {{ }}. Used by the URL bar; reusable for any var-aware field.

import { useEffect, useRef } from 'react';
import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, hoverTooltip, keymap, placeholder as cmPlaceholder,
} from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { cn } from '@/lib/utils';

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

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
  '.cm-var': { color: 'hsl(150 55% 45%)', fontStyle: 'italic', fontSize: '11px' },
  '.cm-var-unknown': { color: 'hsl(0 72% 60%)', fontStyle: 'italic', fontSize: '11px' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: '1px solid hsl(var(--border))', borderRadius: '6px', backgroundColor: 'hsl(var(--popover))',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.2)', overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete ul li': { padding: '3px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: 'hsl(var(--foreground))' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' },
  '.cm-tooltip.cm-tooltip-hover': {
    border: '1px solid hsl(var(--border))', borderRadius: '6px', backgroundColor: 'hsl(var(--popover))',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.2)',
  },
  '.cm-vartip': { display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px 8px', maxWidth: '340px' },
  '.cm-vartip-name': { fontSize: '10px', color: 'hsl(var(--muted-foreground))', fontFamily: 'ui-monospace, monospace' },
  '.cm-vartip-val': { fontSize: '12px', color: 'hsl(var(--foreground))', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', whiteSpace: 'pre-wrap' },
  '.cm-vartip-missing': { fontSize: '12px', color: 'hsl(0 72% 60%)' },
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

    const highlighter = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.build(view); }
        update(u: ViewUpdate) { this.decorations = this.build(u.view); }
        build(view: EditorView): DecorationSet {
          const b = new RangeSetBuilder<Decoration>();
          const text = view.state.doc.toString();
          TOKEN.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = TOKEN.exec(text))) {
            const cls = m[1] in varsRef.current ? 'cm-var' : 'cm-var-unknown';
            b.add(m.index, m.index + m[0].length, Decoration.mark({ class: cls }));
          }
          return b.finish();
        }
      },
      { decorations: (v) => v.decorations },
    );

    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const before = ctx.state.sliceDoc(0, ctx.pos);
      const open = before.lastIndexOf('{{');
      if (open === -1 || before.slice(open + 2).includes('}}')) return null; // not inside an open {{
      const word = /([\w.-]*)$/.exec(before.slice(open + 2))?.[1] ?? '';
      const from = ctx.pos - word.length;
      if (!ctx.explicit && word === '' && before.slice(-2) !== '{{') return null;
      const options = Object.keys(varsRef.current).sort().map((name) => ({
        label: name,
        type: 'variable',
        apply: (view: EditorView, _c: unknown, f: number, t: number) => {
          const hasClose = view.state.sliceDoc(t, t + 2) === '}}';
          view.dispatch({
            changes: { from: f, to: t, insert: name + (hasClose ? '' : '}}') },
            selection: { anchor: f + name.length + 2 },
          });
        },
      }));
      return { from, options, validFor: /[\w.-]*/ };
    };

    // Hovering a {{token}} shows the variable's current value (or "not defined").
    const tooltip = hoverTooltip((view, pos) => {
      const text = view.state.doc.toString();
      TOKEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN.exec(text))) {
        const start = m.index;
        const end = start + m[0].length;
        if (pos < start || pos > end) continue;
        const name = m[1];
        const known = name in varsRef.current;
        return {
          pos: start,
          end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-vartip';
            const nameEl = document.createElement('span');
            nameEl.className = 'cm-vartip-name';
            nameEl.textContent = name;
            dom.appendChild(nameEl);
            const valEl = document.createElement('span');
            if (known) {
              valEl.className = 'cm-vartip-val';
              valEl.textContent = varsRef.current[name] !== '' ? varsRef.current[name] : '(empty)';
            } else {
              valEl.className = 'cm-vartip-missing';
              valEl.textContent = 'not defined';
            }
            dom.appendChild(valEl);
            return { dom };
          },
        };
      }
      return null;
    }, { hoverTime: 150 });

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
          highlighter,
          autocompletion({ override: [complete], icons: false }),
          tooltip,
          singleLine,
          cmPlaceholder(placeholder ?? ''),
          theme,
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
