import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { ArrowLeftRight, FoldVertical } from 'lucide-react';
import {
  Segmented, PaneHeader, Badge, CopyButton, IconButton, CollapsibleSection,
  type BadgeTone,
} from '@/design-system';
import { DiffMergeView, type DiffStats, type DiffSide } from './DiffMergeView';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/diff/TextDiff.messages';
import { ToolToolbar } from '@/components/ui/tool-layout';
import { JsonNumberText, parseInput as parseJsonLossless, serialize, type JsonValue } from '@/components/tools/JsonFormatter';

type Mode = 'text' | 'json';

// ─── Structural JSON diff ─────────────────────────────────────────────────────
// Line/word diffing (rendered by DiffMergeView below) tells you *where* two
// JSON blobs differ textually. This walks the parsed values instead, so
// reordered keys or reformatted whitespace don't show up as noise — only
// real additions, removals, and value changes, listed by path.

type ChangeKind = 'added' | 'removed' | 'changed';
interface Change { path: string; kind: ChangeKind; before?: unknown; after?: unknown }

function kindOf(v: unknown): 'array' | 'object' | 'null' | 'primitive' {
  if (v instanceof JsonNumberText) return 'primitive';
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'object') return 'object';
  return 'primitive';
}

// Numbers compare by value, and big ones (kept as text by the parser) by
// their exact digits, so 9007199254740993 and …992 differ.
function scalarKey(v: unknown): string {
  if (v instanceof JsonNumberText) return `n:${v.text}`;
  if (typeof v === 'number') return `n:${String(v)}`;
  return JSON.stringify(v) ?? 'undefined';
}

function diffJson(a: unknown, b: unknown, path: string, out: Change[]): void {
  const ka = kindOf(a);
  const kb = kindOf(b);

  if (ka !== kb || (ka !== 'array' && ka !== 'object')) {
    if (scalarKey(a) !== scalarKey(b)) {
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
    if (!Object.hasOwn(objA, k)) out.push({ path: p, kind: 'added', after: objB[k] });
    else if (!Object.hasOwn(objB, k)) out.push({ path: p, kind: 'removed', before: objA[k] });
    else diffJson(objA[k], objB[k], p, out);
  }
}

function preview(v: unknown): string {
  if (v === undefined) return 'undefined';
  const s = serialize(v as JsonValue, '', '"');
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

interface JsonDiffResult { changes: Change[] | null; error: { side: 'original' | 'modified'; message: string } | null }

// The structural walk above is unbounded recursion over parsed JSON — guard
// against pathological inputs freezing the tab. The visual diff below doesn't
// need this: CodeMirror's own diff algorithm already bounds itself.
const STRUCTURAL_DIFF_CHAR_LIMIT = 300_000;

export function computeJsonDiff(a: string, b: string): JsonDiffResult {
  if (!a.trim() || !b.trim()) return { changes: null, error: null };
  if (a.length + b.length > STRUCTURAL_DIFF_CHAR_LIMIT) {
    return { changes: null, error: null };
  }
  // Strict JSON.parse decides validity; the values come from the lossless
  // parser so numbers beyond 2^53 are not rounded together.
  try { JSON.parse(a); } catch (e) { return { changes: null, error: { side: 'original', message: (e as Error).message } }; }
  try { JSON.parse(b); } catch (e) { return { changes: null, error: { side: 'modified', message: (e as Error).message } }; }
  const pa = parseJsonLossless(a);
  const pb = parseJsonLossless(b);
  const out: Change[] = [];
  diffJson(pa, pb, '', out);
  return { changes: out, error: null };
}

/**
 * Re-indents valid JSON without parsing values: strings and numbers are copied
 * exactly as written, so `1.10`, `9007199254740993` or `"\u00e9"` stay what
 * the user typed. Anything that isn't valid JSON is returned unchanged.
 */
export function reindentJson(s: string): string {
  const t = s.trim();
  if (!t) return s;
  try { JSON.parse(t); } catch { return s; }
  const unit = '  ';
  let out = '';
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      out += t.slice(i, j + 1);
      i = j;
    } else if (c === '{' || c === '[') {
      let j = i + 1;
      while (/\s/.test(t[j] ?? '')) j++;
      if (t[j] === (c === '{' ? '}' : ']')) { out += c + t[j]; i = j; continue; }
      depth++;
      out += c + '\n' + unit.repeat(depth);
    } else if (c === '}' || c === ']') {
      depth--;
      out += '\n' + unit.repeat(depth) + c;
    } else if (c === ',') {
      out += ',\n' + unit.repeat(depth);
    } else if (c === ':') {
      out += ': ';
    } else if (!/\s/.test(c)) {
      out += c;
    }
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TextDiff() {
  const sdk = usePluginSdkFor('diff');
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const [mode, setMode] = usePluginState<Mode>(sdk, 'diff:mode', 'text', { legacyKey: 'devtool:diff:mode' });
  const [text1, setText1] = usePluginState(sdk, 'diff:text1', '', { legacyKey: 'devtool:diff:text1' });
  const [text2, setText2] = usePluginState(sdk, 'diff:text2', '', { legacyKey: 'devtool:diff:text2' });
  const [collapseUnchanged, setCollapseUnchanged] = useState(false);
  const [stats, setStats] = useState<DiffStats | null>(null);

  const fmtJson = reindentJson;
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
      <ToolToolbar className="flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'text', label: m('text') },
            { value: 'json', label: 'JSON' },
          ]}
          aria-label={m('modeLabel')}
        />
        <span className="hidden text-xs text-fg-mute lg:block">
          {mode === 'text'
            ? m('textHint')
            : m('jsonHint')}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {hasContent && stats && (
            stats.chunks === 0 ? (
              <Badge tone="success" size="sm">{m('noDifferences')}</Badge>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-md border border-line bg-bg-2/40 px-2 py-1 font-mono text-xs tabular-nums">
                <span className="text-ok">+{stats.added}</span>
                <span className="text-bad">&minus;{stats.removed}</span>
              </span>
            )
          )}
          <IconButton
            title={m('swap')}
            aria-label={m('swap')}
            onClick={swap}
            disabled={!hasContent}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </IconButton>
          <IconButton
            title={collapseUnchanged ? m('showFull') : m('collapseUnchanged')}
            aria-label={m('collapseUnchanged')}
            aria-pressed={collapseUnchanged}
            active={collapseUnchanged}
            onClick={() => setCollapseUnchanged((v) => !v)}
          >
            <FoldVertical className="h-4 w-4" />
          </IconButton>
        </div>
      </ToolToolbar>

      {/* Pane header — labels + copy actions, aligned with the merge view's
          50/50 columns (the middle spacer matches its revert-arrow gutter). */}
      <div className="flex shrink-0">
        <PaneHeader className="min-w-0 flex-1" label={m('original')} action={<CopyButton value={text1} iconClassName="h-3.5 w-3.5" />} />
        <div className="w-[1.6em] shrink-0 border-b border-line bg-bg-2/10" />
        <PaneHeader className="min-w-0 flex-1" label={m('modified')} action={<CopyButton value={text2} iconClassName="h-3.5 w-3.5" />} />
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
        originalPlaceholder={mode === 'json' ? m('pasteOriginalJson') : m('enterOriginal', { hint: quickPasteHint })}
        modifiedPlaceholder={mode === 'json' ? m('pasteModifiedJson') : m('enterModified', { hint: quickPasteHint })}
      />

      {/* Structural JSON diff — logical changes by path, unaffected by
          formatting/key order. Only relevant in JSON mode. */}
      {mode === 'json' && hasContent && (
        <div className="shrink-0 border-t border-line" style={{ maxHeight: '32%' }}>
          <div className="h-full overflow-y-auto">
            <CollapsibleSection
              title={m('structuralChanges')}
              hint={jsonDiff?.changes?.length ? m('byPath', { n: jsonDiff.changes.length }) : undefined}
              defaultOpen={!!jsonDiff?.changes?.length || !!jsonDiff?.error}
              className="px-4 py-2.5"
            >
              {jsonDiff?.error ? (
                <p className="font-mono text-xs text-bad">{m('invalidJson', { error: m(jsonDiff.error.side === 'original' ? 'originalError' : 'modifiedError', { error: jsonDiff.error.message }) })}</p>
              ) : jsonDiff?.changes && jsonDiff.changes.length > 0 ? (
                <div className="space-y-1 pb-1">
                  {jsonDiff.changes.map((c, i) => (
                    <JsonChangeRow key={i} change={c} />
                  ))}
                </div>
              ) : (
                <p className="pb-1 text-sm text-fg-mute">
                  {text1.length + text2.length > STRUCTURAL_DIFF_CHAR_LIMIT
                    ? m('tooLarge')
                    : m('identical')}
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
        <span className="font-medium text-fg">{change.path}</span>
        <span className="ml-2 break-all">
          {change.kind === 'changed' ? (
            <>
              <span className="text-bad line-through">{preview(change.before)}</span>
              <span className="mx-1 text-fg-mute">→</span>
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
