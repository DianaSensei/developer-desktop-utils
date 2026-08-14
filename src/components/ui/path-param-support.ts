// CodeMirror extensions that highlight `:name` path-param placeholders in a
// URL — the counterpart to var-support.ts's `{{var}}` highlighting, kept as a
// separate mechanism (different syntax, different source of truth: a path
// param's value lives in the request's own `pathParams` table, not the
// {{}}-substitution variable map) so the two can never be visually confused
// with each other. Used only by the address bar (see InlineCodeField's
// `pathParamValues` prop) — the Params tab's own Path table already shows
// path params directly, so it doesn't need this.

import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, hoverTooltip,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Mirrors the regex request.ts's buildUrl() and RequestPanel's PathParamsEditor
// use to detect path params: a `:name` segment right after a `/`, so a port
// number like `:8080` is never mistaken for one.
const PATH_PARAM = /\/:([A-Za-z_]\w*)/g;

export const pathParamTheme = EditorView.theme({
  // A distinct hue from `.cm-var`/`.cm-var-unknown` (green/red) so a path
  // param never reads as a resolved-or-not {{variable}} token.
  '.cm-pathparam': {
    color: 'hsl(262 60% 58%)',
    backgroundColor: 'hsl(262 60% 58% / 0.13)',
    borderRadius: '3px',
    padding: '0 1px',
  },
  '.cm-pathparamtip': { display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px 8px', maxWidth: '340px' },
  '.cm-pathparamtip-name': { fontSize: '10px', color: 'hsl(var(--muted-foreground))', fontFamily: 'ui-monospace, monospace' },
  '.cm-pathparamtip-val': { fontSize: '12px', color: 'hsl(var(--foreground))', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', whiteSpace: 'pre-wrap' },
  '.cm-pathparamtip-missing': { fontSize: '12px', color: 'hsl(var(--muted-foreground))' },
});

// `getValues` returns the current pathParams table as a name → value map
// (only enabled, named rows); called lazily so it always reflects the latest
// table. Missing from the map = no row for that name yet.
export function pathParamExtensions(getValues: () => Record<string, string>) {
  const highlighter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
      build(view: EditorView): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          PATH_PARAM.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = PATH_PARAM.exec(text))) {
            // Decorate only the `:name` part, not the leading `/`.
            const start = from + m.index + 1;
            const end = start + m[0].length - 1;
            b.add(start, end, Decoration.mark({ class: 'cm-pathparam' }));
          }
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );

  const tooltip = hoverTooltip((view, pos) => {
    const text = view.state.doc.toString();
    PATH_PARAM.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_PARAM.exec(text))) {
      const start = m.index + 1;
      const end = start + m[0].length - 1;
      if (pos < start || pos > end) continue;
      const name = m[1];
      const values = getValues();
      const has = name in values;
      return {
        pos: start, end, above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-pathparamtip';
          const nameEl = document.createElement('span');
          nameEl.className = 'cm-pathparamtip-name';
          nameEl.textContent = `:${name}`;
          dom.appendChild(nameEl);
          const valEl = document.createElement('span');
          if (has && values[name] !== '') {
            valEl.className = 'cm-pathparamtip-val';
            valEl.textContent = values[name];
          } else {
            valEl.className = 'cm-pathparamtip-missing';
            valEl.textContent = has ? '(empty)' : 'no value set — see the Path table on the Params tab';
          }
          dom.appendChild(valEl);
          return { dom };
        },
      };
    }
    return null;
  }, { hoverTime: 150 });

  return [highlighter, tooltip];
}
