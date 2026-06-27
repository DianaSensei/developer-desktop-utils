// Shared CodeMirror extensions that make a field "{{variable}}-aware": every
// {{name}} token is highlighted (green when the variable is known, red when not),
// an autocomplete list of known variables pops while the caret is inside {{ }},
// and hovering a token shows its current value. Used by the URL bar, the
// key/value tables, and the request body editor so the experience is identical.

import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate,
  hoverTooltip, tooltips,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export const varTheme = EditorView.theme({
  // Known variables get a green pill, unknown ones a red pill (Postman-style),
  // so what will resolve at send time is obvious at a glance.
  '.cm-var': {
    color: 'hsl(152 62% 40%)',
    backgroundColor: 'hsl(152 62% 45% / 0.13)',
    borderRadius: '3px',
    padding: '0 1px',
  },
  '.cm-var-unknown': {
    color: 'hsl(0 72% 58%)',
    backgroundColor: 'hsl(0 72% 60% / 0.11)',
    borderRadius: '3px',
    padding: '0 1px',
  },
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

// Build the highlight + autocomplete + hover extensions. `getVars` is called
// lazily so the latest variable set is always used. Tooltips are parented to the
// document body so they're never clipped inside overflow-hidden containers (e.g.
// the bordered key/value tables).
export function varExtensions(getVars: () => Record<string, string>) {
  const highlighter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
      build(view: EditorView): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        const vars = getVars();
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          TOKEN.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = TOKEN.exec(text))) {
            const cls = m[1] in vars ? 'cm-var' : 'cm-var-unknown';
            b.add(from + m.index, from + m.index + m[0].length, Decoration.mark({ class: cls }));
          }
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
    const options = Object.keys(getVars()).sort().map((name) => ({
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

  const tooltip = hoverTooltip((view, pos) => {
    const text = view.state.doc.toString();
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (pos < start || pos > end) continue;
      const name = m[1];
      const vars = getVars();
      const known = name in vars;
      return {
        pos: start, end, above: true,
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
            valEl.textContent = vars[name] !== '' ? vars[name] : '(empty)';
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

  return [
    highlighter,
    autocompletion({ override: [complete], icons: false }),
    tooltip,
    tooltips({ parent: document.body }),
  ];
}
