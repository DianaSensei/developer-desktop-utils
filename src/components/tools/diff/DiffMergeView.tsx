// The visual diff surface for the Diff tool. Wraps @codemirror/merge's
// `MergeView` — the same side-by-side, line-aligned, syntax-highlighted diff
// engine CodeMirror itself uses — instead of a plain textarea pair plus a
// separately-rendered word-diff `<pre>`. Both sides stay fully editable, so
// this doubles as a lightweight merge tool: chunk arrows copy a change from
// Original into Modified, long unchanged stretches can collapse, and
// Alt+Up/Down jumps between changes.
//
// Not exported from the design system — this is a Diff-tool-specific surface
// (JSON linting, revert arrows, chunk stats) rather than a general-purpose
// editor. `code-editor-base.tsx`'s `CodeSurface` is the single-editor
// equivalent every other tool should keep using.

import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { json as jsonLang, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { Compartment, type Extension, type Text } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
import { smartBracketSkip, codeThemeWithHighlight } from '@/components/ui/code-theme';
import { useIsDark } from '@/hooks/useIsDark';
import { cn } from '@/lib/utils';

export interface DiffStats {
  added: number;
  removed: number;
  chunks: number;
}

export type DiffSide = 'a' | 'b';

export interface DiffMergeViewProps {
  className?: string;
  original: string;
  modified: string;
  onOriginalChange: (value: string) => void;
  onModifiedChange: (value: string) => void;
  /** Fired when a side loses focus — used to reformat JSON on blur. */
  onOriginalBlur?: (value: string) => void;
  onModifiedBlur?: (value: string) => void;
  /** Fixed for the component's lifetime — swap via `key`, same convention as JsonEditor/TextEditor. */
  language: 'text' | 'json';
  collapseUnchanged: boolean;
  onStatsChange?: (stats: DiffStats) => void;
  onFocusSide?: (side: DiffSide) => void;
  originalPlaceholder?: string;
  modifiedPlaceholder?: string;
}

function lineSpan(doc: Text, from: number, to: number): number {
  if (to <= from) return 0;
  const start = doc.lineAt(from).number;
  const end = doc.lineAt(Math.max(from, to - 1)).number;
  return end - start + 1;
}

function summarize(view: MergeView): DiffStats {
  let added = 0;
  let removed = 0;
  for (const chunk of view.chunks) {
    removed += lineSpan(view.a.state.doc, chunk.fromA, chunk.toA);
    added += lineSpan(view.b.state.doc, chunk.fromB, chunk.toB);
  }
  return { added, removed, chunks: view.chunks.length };
}

// F7 / Shift-F7, matching VS Code's diff editor — not Alt-ArrowDown/Up, which
// `basicSetup`'s `defaultKeymap` already binds to moveLineDown/moveLineUp
// (and would win, since it's listed first in `baseExtensions` below).
const chunkNavKeymap = keymap.of([
  { key: 'F7', run: goToNextChunk },
  { key: 'Shift-F7', run: goToPreviousChunk },
]);

// Reused across both sides and every mount, same as JsonEditor's module-scope
// `jsonLang`/`jsonLint` in code-editor.tsx — extension specs are stateless
// config, safe to share across unrelated EditorStates.
const jsonExtensions = [jsonLang(), linter(jsonParseLinter()), lintGutter()];

/** Same shared engine every editable code surface uses (Tab indent, smart
 *  bracket skip, autocorrect off), minus the parts CodeSurface owns that a
 *  MergeView side can't use (its own onChange/blur wiring, {{var}} support). */
function baseExtensions(language: 'text' | 'json', themeCompartment: Compartment, dark: boolean): Extension[] {
  return [
    keymap.of([indentWithTab]),
    basicSetup,
    chunkNavKeymap,
    smartBracketSkip,
    EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' }),
    ...(language === 'json' ? jsonExtensions : []),
    themeCompartment.of(codeThemeWithHighlight(dark, { fontSize: '12.5px', gutter: 'flush' })),
    EditorView.lineWrapping,
  ];
}

export function DiffMergeView({
  className,
  original,
  modified,
  onOriginalChange,
  onModifiedChange,
  onOriginalBlur,
  onModifiedBlur,
  language,
  collapseUnchanged,
  onStatsChange,
  onFocusSide,
  originalPlaceholder,
  modifiedPlaceholder,
}: DiffMergeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const dark = useIsDark();

  const onOriginalChangeRef = useRef(onOriginalChange);
  onOriginalChangeRef.current = onOriginalChange;
  const onModifiedChangeRef = useRef(onModifiedChange);
  onModifiedChangeRef.current = onModifiedChange;
  const onOriginalBlurRef = useRef(onOriginalBlur);
  onOriginalBlurRef.current = onOriginalBlur;
  const onModifiedBlurRef = useRef(onModifiedBlur);
  onModifiedBlurRef.current = onModifiedBlur;
  const onStatsChangeRef = useRef(onStatsChange);
  onStatsChangeRef.current = onStatsChange;
  const onFocusSideRef = useRef(onFocusSide);
  onFocusSideRef.current = onFocusSide;

  const lastARef = useRef(original);
  const lastBRef = useRef(modified);
  // `new Compartment()` re-evaluates on every render, but useRef only keeps
  // the first call's result — cheap enough that a lazy-init guard isn't worth it.
  const compA = useRef(new Compartment());
  const compB = useRef(new Compartment());

  useEffect(() => {
    if (!containerRef.current) return;

    const reportStats = () => {
      const view = mergeViewRef.current;
      if (view) onStatsChangeRef.current?.(summarize(view));
    };

    const view = new MergeView({
      parent: containerRef.current,
      gutter: true,
      highlightChanges: true,
      revertControls: 'a-to-b',
      collapseUnchanged: collapseUnchanged ? { margin: 3, minSize: 4 } : undefined,
      a: {
        doc: original,
        extensions: [
          ...baseExtensions(language, compA.current, dark),
          ...(originalPlaceholder ? [placeholderExt(originalPlaceholder)] : []),
          EditorView.domEventHandlers({
            focus: () => { onFocusSideRef.current?.('a'); return false; },
            blur: () => { onOriginalBlurRef.current?.(view.a.state.doc.toString()); return false; },
          }),
          EditorView.updateListener.of((upd) => {
            if (upd.docChanged) {
              const val = upd.state.doc.toString();
              lastARef.current = val;
              onOriginalChangeRef.current(val);
            }
            reportStats();
          }),
        ],
      },
      b: {
        doc: modified,
        extensions: [
          ...baseExtensions(language, compB.current, dark),
          ...(modifiedPlaceholder ? [placeholderExt(modifiedPlaceholder)] : []),
          EditorView.domEventHandlers({
            focus: () => { onFocusSideRef.current?.('b'); return false; },
            blur: () => { onModifiedBlurRef.current?.(view.b.state.doc.toString()); return false; },
          }),
          EditorView.updateListener.of((upd) => {
            if (upd.docChanged) {
              const val = upd.state.doc.toString();
              lastBRef.current = val;
              onModifiedChangeRef.current(val);
            }
            reportStats();
          }),
        ],
      },
    });
    mergeViewRef.current = view;
    reportStats();

    return () => { view.destroy(); mergeViewRef.current = null; };
    // Mount-only: `language`/placeholders are fixed for this component's
    // lifetime (swap via `key`), and `original`/`modified` initialize the doc
    // — later prop changes flow through the sync effects below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external value changes (mode-switch reformatting, quick paste,
  // Swap/Clear) into the editors.
  useEffect(() => {
    const view = mergeViewRef.current?.a;
    if (!view || original === lastARef.current) return;
    lastARef.current = original;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: original } });
  }, [original]);
  useEffect(() => {
    const view = mergeViewRef.current?.b;
    if (!view || modified === lastBRef.current) return;
    lastBRef.current = modified;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: modified } });
  }, [modified]);

  // Theme flip: reconfigure both sides' theme compartments in place.
  useEffect(() => {
    const view = mergeViewRef.current;
    if (!view) return;
    const opts = { fontSize: '12.5px', gutter: 'flush' as const };
    view.a.dispatch({ effects: compA.current.reconfigure(codeThemeWithHighlight(dark, opts)) });
    view.b.dispatch({ effects: compB.current.reconfigure(codeThemeWithHighlight(dark, opts)) });
  }, [dark]);

  useEffect(() => {
    mergeViewRef.current?.reconfigure({
      collapseUnchanged: collapseUnchanged ? { margin: 3, minSize: 4 } : undefined,
    });
  }, [collapseUnchanged]);

  return <div ref={containerRef} className={cn('diff-merge-view flex flex-1 min-h-0 flex-col overflow-hidden', className)} />;
}
