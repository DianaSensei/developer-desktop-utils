import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, FoldVertical } from 'lucide-react';
import {
  Segmented, PaneHeader, Badge, CopyButton, IconButton, CollapsibleSection,
  type BadgeTone,
} from '@/design-system';
import { DiffMergeView, type DiffStats, type DiffSide } from './DiffMergeView';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';

type Mode = 'text' | 'json';

// ─── Structural JSON diff ─────────────────────────────────────────────────────
// Line/word diffing (rendered by DiffMergeView below) tells you *where* two
// JSON blobs differ textually. This walks the parsed values instead, so
// reordered keys or reformatted whitespace don't show up as noise — only
// real additions, removals, and value changes, listed by path.

type ChangeKind = 'added' | 'removed' | 'changed';
interface Change { path: string; kind: ChangeKind; before?: unknown; after?: unknown }

function kindOf(v: unknown): 'array' | 'object' | 'null' | 'primitive' {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'object') return 'object';
  return 'primitive';
}

function diffJson(a: unknown, b: unknown, path: string, out: Change[]): void {
  const ka = kindOf(a);
  const kb = kindOf(b);

  if (ka !== kb || (ka !== 'array' && ka !== 'object')) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ path: path || '(root)', kind: 'changed', before: a, after: b });
    }
    return;
  }

  if (ka === 'array') {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    const max = Math.max(arrA.length, arrB.length);
    for (let i = 0; i < max; i++) {
      const p = `${path}[${i}]`;
      if (i >= arrA.length) out.push({ path: p, kind: 'added', after: arrB[i] });
      else if (i >= arrB.length) out.push({ path: p, kind: 'removed', before: arrA[i] });
      else diffJson(arrA[i], arrB[i], p, out);
    }
    return;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(objA), ...Object.keys(objB)])) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in objA)) out.push({ path: p, kind: 'added', after: objB[k] });
    else if (!(k in objB)) out.push({ path: p, kind: 'removed', before: objA[k] });
    else diffJson(objA[k], objB[k], p, out);
  }
}

function preview(v: unknown): string {
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

interface JsonDiffResult { changes: Change[] | null; error: string | null }

// The structural walk above is unbounded recursion over parsed JSON — guard
// against pathological inputs freezing the tab. The visual diff below doesn't
// need this: CodeMirror's own diff algorithm already bounds itself.
const STRUCTURAL_DIFF_CHAR_LIMIT = 300_000;

function computeJsonDiff(a: string, b: string): JsonDiffResult {
  if (!a.trim() || !b.trim()) return { changes: null, error: null };
  if (a.length + b.length > STRUCTURAL_DIFF_CHAR_LIMIT) {
    return { changes: null, error: null };
  }
  let pa: unknown;
  let pb: unknown;
  try { pa = JSON.parse(a); } catch (e) { return { changes: null, error: `Original: ${(e as Error).message}` }; }
  try { pb = JSON.parse(b); } catch (e) { return { changes: null, error: `Modified: ${(e as Error).message}` }; }
  const out: Change[] = [];
  diffJson(pa, pb, '', out);
  return { changes: out, error: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TextDiff() {
  const [mode, setMode] = usePersistentState<Mode>('devtool:diff:mode', 'text');
  const [text1, setText1] = usePersistentState('devtool:diff:text1', '');
  const [text2, setText2] = usePersistentState('devtool:diff:text2', '');
  const [collapseUnchanged, setCollapseUnchanged] = useState(false);
  const [stats, setStats] = useState<DiffStats | null>(null);

  // Pretty-print JSON; returns the input unchanged if it isn't valid JSON yet.
  const fmtJson = (s: string) => {
    const t = s.trim();
    if (!t) return s;
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return s; }
  };
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // With two equal panes, quick-paste fills whichever side was focused last
  // (defaulting to Original). It only fires when no field is focused — while
  // editing a pane, ⌘V pastes normally at the cursor.
  const activeSideRef = useRef<DiffSide>('a');
  const handleFocusSide = useCallback((side: DiffSide) => { activeSideRef.current = side; }, []);
  useQuickPaste((text) => {
    const value = modeRef.current === 'json' ? fmtJson(text) : text;
    (activeSideRef.current === 'a' ? setText1 : setText2)(value);
  });

  // Format both panes when JSON mode is (re)entered — including on mount if
  // it's the saved mode — so existing/pasted JSON is aligned by default.
  useEffect(() => {
    if (mode !== 'json') return;
    setText1((v) => fmtJson(v));
    setText2((v) => fmtJson(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Deferred so the structural walk (recursive over parsed JSON) never makes
  // typing feel laggy — it renders at low priority behind the live keystroke.
  const dText1 = useDeferredValue(text1);
  const dText2 = useDeferredValue(text2);
  const jsonDiff = useMemo(
    () => (mode === 'json' ? computeJsonDiff(dText1, dText2) : null),
    [mode, dText1, dText2],
  );
  const hasContent = !!(text1 || text2);
  const swap = () => { setText1(text2); setText2(text1); };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 header-premium px-4 py-2.5 flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'json', label: 'JSON' },
          ]}
          aria-label="Diff mode"
        />
        <span className="hidden text-xs text-muted-foreground lg:block">
          {mode === 'text'
            ? 'Live diff — synced scrolling, inline highlights, and chunk arrows to copy changes across.'
            : 'Structural diff by path below, plus a synced line diff of the formatted JSON.'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {hasContent && stats && (
            stats.chunks === 0 ? (
              <Badge tone="success" size="sm">No differences</Badge>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs tabular-nums">
                <span className="text-ok">+{stats.added}</span>
                <span className="text-destructive">&minus;{stats.removed}</span>
              </span>
            )
          )}
          <IconButton
            title="Swap original and modified"
            aria-label="Swap original and modified"
            onClick={swap}
            disabled={!hasContent}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </IconButton>
          <IconButton
            title={collapseUnchanged ? 'Show full text' : 'Collapse unchanged lines'}
            aria-label="Toggle collapse unchanged lines"
            active={collapseUnchanged}
            onClick={() => setCollapseUnchanged((v) => !v)}
          >
            <FoldVertical className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* Pane header — labels + copy actions, aligned with the merge view's
          50/50 columns (the middle spacer matches its revert-arrow gutter). */}
      <div className="flex shrink-0">
        <PaneHeader className="min-w-0 flex-1" label="Original" action={<CopyButton value={text1} iconClassName="h-3.5 w-3.5" />} />
        <div className="w-[1.6em] shrink-0 border-b border-border bg-muted/10" />
        <PaneHeader className="min-w-0 flex-1" label="Modified" action={<CopyButton value={text2} iconClassName="h-3.5 w-3.5" />} />
      </div>

      <DiffMergeView
        key={mode}
        className="min-h-0"
        original={text1}
        modified={text2}
        onOriginalChange={setText1}
        onModifiedChange={setText2}
        onOriginalBlur={mode === 'json' ? (v) => setText1(fmtJson(v)) : undefined}
        onModifiedBlur={mode === 'json' ? (v) => setText2(fmtJson(v)) : undefined}
        language={mode}
        collapseUnchanged={collapseUnchanged}
        onStatsChange={setStats}
        onFocusSide={handleFocusSide}
        originalPlaceholder={mode === 'json' ? 'Paste original JSON' : `Enter original text — ${quickPasteHint}`}
        modifiedPlaceholder={mode === 'json' ? 'Paste modified JSON' : `Enter modified text — ${quickPasteHint}`}
      />

      {/* Structural JSON diff — logical changes by path, unaffected by
          formatting/key order. Only relevant in JSON mode. */}
      {mode === 'json' && hasContent && (
        <div className="shrink-0 border-t border-border" style={{ maxHeight: '32%' }}>
          <div className="h-full overflow-y-auto">
            <CollapsibleSection
              title="Structural changes"
              hint={jsonDiff?.changes?.length ? `— ${jsonDiff.changes.length} by path` : undefined}
              defaultOpen={!!jsonDiff?.changes?.length || !!jsonDiff?.error}
              className="px-4 py-2.5"
            >
              {jsonDiff?.error ? (
                <p className="font-mono text-xs text-destructive">Invalid JSON — {jsonDiff.error}</p>
              ) : jsonDiff?.changes && jsonDiff.changes.length > 0 ? (
                <div className="space-y-1 pb-1">
                  {jsonDiff.changes.map((c, i) => (
                    <JsonChangeRow key={i} change={c} />
                  ))}
                </div>
              ) : (
                <p className="pb-1 text-sm text-muted-foreground">
                  {text1.length + text2.length > STRUCTURAL_DIFF_CHAR_LIMIT
                    ? 'Input is too large for the structural diff — the line diff above still works.'
                    : 'No differences — the two JSON values are structurally identical.'}
                </p>
              )}
            </CollapsibleSection>
          </div>
        </div>
      )}
    </div>
  );
}

function JsonChangeRow({ change }: { change: Change }) {
  const tone: BadgeTone =
    change.kind === 'added' ? 'success' : change.kind === 'removed' ? 'danger' : 'warning';

  return (
    <div className="flex items-start gap-2 font-mono text-xs">
      <Badge tone={tone} uppercase>{change.kind}</Badge>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{change.path}</span>
        <span className="ml-2 break-all">
          {change.kind === 'changed' ? (
            <>
              <span className="text-bad line-through">{preview(change.before)}</span>
              <span className="mx-1 text-muted-foreground">→</span>
              <span className="text-ok">{preview(change.after)}</span>
            </>
          ) : change.kind === 'added' ? (
            <span className="text-ok">{preview(change.after)}</span>
          ) : (
            <span className="text-bad line-through">{preview(change.before)}</span>
          )}
        </span>
      </div>
    </div>
  );
}
