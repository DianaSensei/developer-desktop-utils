import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { PaneHeader } from '@/components/ui/tool-layout';
import { Segmented } from '@/components/ui/segmented';
import { CodeEditor } from '@/components/tools/apiclient/CodeEditor';
import * as Diff from 'diff';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';

type Mode = 'text' | 'json';

// ─── Structural JSON diff ─────────────────────────────────────────────────────

type ChangeKind = 'added' | 'removed' | 'changed';
interface Change { path: string; kind: ChangeKind; before?: unknown; after?: unknown }

function kindOf(v: unknown): 'array' | 'object' | 'null' | 'primitive' {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'object') return 'object';
  return 'primitive';
}

// Walks two parsed JSON values and collects leaf-level additions, removals, and
// changes keyed by their dotted/bracketed path.
function diffJson(a: unknown, b: unknown, path: string, out: Change[]): void {
  const ka = kindOf(a);
  const kb = kindOf(b);

  if (ka !== kb || (ka !== 'array' && ka !== 'object')) {
    // Leaf (or type mismatch): compare by value via stable stringify.
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

function computeJsonDiff(a: string, b: string): JsonDiffResult {
  if (!a.trim() || !b.trim()) return { changes: null, error: null };
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

  // Text mode uses textareas (custom undo); JSON mode uses CodeMirror (its own
  // history), so only wire the manual undo for text mode.
  useInputHistory(text1, setText1, mode === 'text');

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
  const activeSetter = useRef(setText1);
  useQuickPaste((text) => activeSetter.current(modeRef.current === 'json' ? fmtJson(text) : text));

  // Format both panes when JSON mode is (re)entered — including on mount if it's
  // the saved mode — so existing/pasted JSON is aligned by default.
  useEffect(() => {
    if (mode !== 'json') return;
    setText1((v) => fmtJson(v));
    setText2((v) => fmtJson(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Diffing runs on every keystroke. Defer it so typing in either pane stays
  // responsive — the textareas update instantly while the (heavier) diff render
  // happens at low priority and can be interrupted by further typing.
  const dText1 = useDeferredValue(text1);
  const dText2 = useDeferredValue(text2);
  const textDiff = useMemo(
    () => (mode === 'text' ? Diff.diffWords(dText1, dText2) : null),
    [mode, dText1, dText2],
  );
  const jsonDiff = useMemo(
    () => (mode === 'json' ? computeJsonDiff(dText1, dText2) : null),
    [mode, dText1, dText2],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Mode switcher */}
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
        <span className="hidden text-xs text-muted-foreground sm:block">
          {mode === 'text' ? 'Word-level diff of two text blocks.' : 'Structural diff of two JSON values by path.'}
        </span>
      </div>

      {/* Two input columns */}
      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x overflow-hidden">
        <div className="flex flex-col min-h-0">
          <PaneHeader label="Original" />
          {mode === 'json' ? (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2">
              <CodeEditor
                key="json-1"
                language="json"
                value={text1}
                onChange={setText1}
                onBlur={(v) => setText1(fmtJson(v))}
                placeholder="Paste original JSON"
              />
            </div>
          ) : (
            <Textarea
              value={text1}
              onChange={(e) => setText1(e.target.value)}
              onFocus={() => { activeSetter.current = setText1; }}
              placeholder={`Enter original text — ${quickPasteHint}`}
              className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
            />
          )}
        </div>
        <div className="flex flex-col min-h-0">
          <PaneHeader label="Modified" />
          {mode === 'json' ? (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-2">
              <CodeEditor
                key="json-2"
                language="json"
                value={text2}
                onChange={setText2}
                onBlur={(v) => setText2(fmtJson(v))}
                placeholder="Paste modified JSON"
              />
            </div>
          ) : (
            <Textarea
              value={text2}
              onChange={(e) => setText2(e.target.value)}
              onFocus={() => { activeSetter.current = setText2; }}
              placeholder={`Enter modified text — ${quickPasteHint}`}
              className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
            />
          )}
        </div>
      </div>

      {/* Result panel */}
      {(text1 || text2) && (
        <div className="shrink-0 border-t flex flex-col" style={{ maxHeight: '40%' }}>
          <PaneHeader
            label={mode === 'text' ? 'Diff Result' : 'JSON Diff'}
            action={
              <div className="flex items-center gap-3 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-200 dark:bg-red-900/40" />
                  Removed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-green-200 dark:bg-green-900/40" />
                  Added
                </span>
                {mode === 'json' && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm bg-amber-200 dark:bg-amber-900/40" />
                    Changed
                  </span>
                )}
              </div>
            }
          />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            {mode === 'text' ? (
              <pre className="font-mono text-sm whitespace-pre-wrap">
                {textDiff!.map((part, index) => {
                  const cls = part.added
                    ? 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-200'
                    : part.removed
                    ? 'bg-red-200 dark:bg-red-900/40 text-red-900 dark:text-red-200'
                    : '';
                  return <span key={index} className={cls}>{part.value}</span>;
                })}
              </pre>
            ) : jsonDiff!.error ? (
              <p className="font-mono text-xs text-destructive">Invalid JSON — {jsonDiff!.error}</p>
            ) : jsonDiff!.changes && jsonDiff!.changes.length > 0 ? (
              <div className="space-y-1">
                {jsonDiff!.changes.map((c, i) => (
                  <JsonChangeRow key={i} change={c} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No differences — the two JSON values are structurally identical.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JsonChangeRow({ change }: { change: Change }) {
  const badge =
    change.kind === 'added'
      ? { label: 'added', cls: 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200' }
      : change.kind === 'removed'
      ? { label: 'removed', cls: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200' }
      : { label: 'changed', cls: 'bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' };

  return (
    <div className="flex items-start gap-2 font-mono text-xs">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>{badge.label}</span>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{change.path}</span>
        <span className="ml-2 break-all">
          {change.kind === 'changed' ? (
            <>
              <span className="text-red-600 line-through dark:text-red-400">{preview(change.before)}</span>
              <span className="mx-1 text-muted-foreground">→</span>
              <span className="text-green-600 dark:text-green-400">{preview(change.after)}</span>
            </>
          ) : change.kind === 'added' ? (
            <span className="text-green-600 dark:text-green-400">{preview(change.after)}</span>
          ) : (
            <span className="text-red-600 line-through dark:text-red-400">{preview(change.before)}</span>
          )}
        </span>
      </div>
    </div>
  );
}
