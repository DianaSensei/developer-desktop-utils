// Response viewer: tabs (Response / Headers / Timeline / Tests / Console) plus a
// status·time·size readout, a format dropdown (Bruno-style: Preview toggle +
// JSON/HTML/XML/JavaScript and Raw/Hex/Base64), and copy / download / clear
// actions. JSON bodies are pretty-printed; every view is copyable.
//
// While a request is in flight the previously-rendered response stays on screen
// behind a progress bar rather than being replaced by a spinner — swapping the
// whole pane out and back was the single biggest source of flicker in the tool.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  AlertCircle, Binary, Braces, Check, ChevronDown, Code2, Copy, Download, Eraser,
  FileCode, FileText, Filter, Hash, MoreHorizontal, Send, X,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { IconButton } from '@/components/ui/icon-button';
import { Callout } from '@/components/ui/callout';
import { isMac } from '@/hooks/useQuickPaste';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { ApiResponse, LogEntry, TestResult } from './types';
import { formatBytes, prettyBody, statusColor } from './request';
import { saveBinaryFile, saveTextFile } from './fileio';
import { queryJson } from './jsonpath';
import { CodeViewer } from '@/design-system';
import type { RequestPanelTab } from './RequestPanel';

// Labels scriptPhases.ts attaches to a request's *own* scripts (as opposed to
// an inherited collection/folder script, which has no single tab of its own
// to jump to) — mapped to the RequestPanel tab that holds that script.
const SCRIPT_LABEL_TAB: Record<string, RequestPanelTab> = {
  'Pre-request script': 'script',
  'Post-response script': 'script',
  'Test script': 'tests',
};

export interface ParsedScriptError {
  label: string;
  message: string;
  jumpTab?: RequestPanelTab;
}

// engine.ts joins every failed phase into one `\n`-separated string, each
// line already `${label}: ${message}` (see scriptPhases.ts's `run()`) — a
// transport failure is the one exception, pushed with no label at all.
// Splits that back into individual, attributable entries instead of one
// undifferentiated block of text.
export function parseScriptErrors(error: string): ParsedScriptError[] {
  return error.split('\n').map((line) => {
    const idx = line.indexOf(': ');
    if (idx === -1) return { label: '', message: line };
    const label = line.slice(0, idx);
    return { label, message: line.slice(idx + 2), jumpTab: SCRIPT_LABEL_TAB[label] };
  });
}

type Kind = 'json' | 'html' | 'xml' | 'image' | 'text';
type Format = 'json' | 'html' | 'xml' | 'javascript' | 'raw' | 'hex' | 'base64';

function detectKind(r: ApiResponse): Kind {
  const ct = r.contentType.toLowerCase();
  if (/image\//.test(ct)) return 'image';
  if (/json/.test(ct) || /^\s*[[{]/.test(r.body)) return 'json';
  if (/html/.test(ct)) return 'html';
  if (/xml/.test(ct)) return 'xml';
  return 'text';
}

const KIND_FORMAT: Record<Kind, Format> = { json: 'json', html: 'html', xml: 'xml', image: 'raw', text: 'raw' };

const FORMAT_META: Record<Format, { label: string; icon: typeof Braces }> = {
  json: { label: 'JSON', icon: Braces },
  html: { label: 'HTML', icon: Code2 },
  xml: { label: 'XML', icon: FileText },
  javascript: { label: 'JavaScript', icon: FileCode },
  raw: { label: 'Raw', icon: FileText },
  hex: { label: 'Hex', icon: Binary },
  base64: { label: 'Base64', icon: Hash },
};

const SYNTAX_FORMATS: Format[] = ['json', 'html', 'xml', 'javascript'];
const ENCODING_FORMATS: Format[] = ['raw', 'hex', 'base64'];

// Above this size, skip pretty-printing / JSON syntax highlighting and show the
// raw text by default — parsing and folding multi-MB bodies otherwise freezes
// the UI. The user can still switch formats manually.
const LARGE_BODY = 2_000_000;

interface Props {
  response: ApiResponse | null;
  sending: boolean;
  error: string | null;
  tests: TestResult[];
  logs: LogEntry[];
  onClear?: () => void;
  // Switches the request builder to the tab holding the script that failed
  // (only own-request scripts map to one — see parseScriptErrors above).
  onJumpToTab?: (tab: RequestPanelTab) => void;
  // Whether the request that produced `response` already has an `Origin`
  // header of its own — suppresses the CORS/Origin hint below once the user
  // has already acted on it. Only checks the request's own Headers tab, not
  // an inherited collection/folder header of the same name.
  hasOriginHeader?: boolean;
}

type Tab = 'body' | 'headers' | 'timeline' | 'tests' | 'console';

// A completed (non-2xx) response whose body or headers talk about CORS/Origin
// — the desktop app's requests go through Rust (see request.ts's netFetch),
// which never has browser CORS enforcement to trip over, but a server can
// still reject a request for lacking the `Origin` header a real browser tab
// would have sent automatically. This is a heuristic on response content, not
// a certainty, so it's phrased as a suggestion, not a diagnosis.
const CORS_HINT_PATTERN =
  /\bcors\b|access-control-allow-origin|origin[^.!?]{0,30}(not allow|disallow|block|reject|forbidden)|(not allow|disallow|block|reject|forbidden)[^.!?]{0,30}origin/i;

export function looksLikeCorsRejection(response: ApiResponse): boolean {
  if (response.ok || response.status < 400 || response.status >= 500) return false;
  const haystack = `${response.body} ${response.headers.map(([k, v]) => `${k}: ${v}`).join(' ')}`;
  return CORS_HINT_PATTERN.test(haystack);
}

export function ResponsePanel({ response, sending, error, tests, logs, onClear, onJumpToTab, hasOriginHeader }: Props) {
  const [tab, setTab] = useState<Tab>('body');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const [format, setFormat] = useState<Format>('raw');
  const [preview, setPreview] = useState(false);
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  const big = !!response && response.body.length > LARGE_BODY;

  const pretty = useMemo(
    () => (response && !big ? prettyBody(response.body, response.contentType) : response?.body ?? ''),
    [response, big],
  );
  const kind = useMemo(() => (response ? detectKind(response) : 'text'), [response]);

  // Reset the view only when the *shape* of the payload changes. Re-sending the
  // same endpoint used to snap the format back to the default on every response,
  // discarding a format the user had deliberately picked.
  const lastShape = useRef<string | null>(null);
  useEffect(() => {
    if (!response) return;
    const shape = `${detectKind(response)}|${response.body.length > LARGE_BODY}`;
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    setFormat(response.body.length > LARGE_BODY ? 'raw' : KIND_FORMAT[detectKind(response)]);
    setPreview(detectKind(response) === 'image');
  }, [response]);

  // Apply the JSONPath filter to JSON bodies (the funnel box), if active/valid.
  const filterResult = useMemo(() => {
    if (!response || big || kind !== 'json' || !filter.trim()) return null;
    try {
      const out = queryJson(JSON.parse(response.body), filter);
      return { ok: true as const, text: JSON.stringify(out, null, 2) };
    } catch {
      return { ok: false as const, text: '' };
    }
  }, [response, big, kind, filter]);

  const bodyText = useMemo(() => {
    if (!response) return '';
    if (filterResult?.ok) return filterResult.text;
    if (big && format === 'json') return response.body;
    switch (format) {
      case 'json': return pretty;
      // Hex/Base64 read the preserved bytes for binary payloads — re-encoding
      // the decoded text would dump U+FFFD runs instead of the real content.
      case 'hex': return hexDump(
        response.bodyBase64 ? base64ToBytes(response.bodyBase64) : new TextEncoder().encode(response.body),
      );
      case 'base64': return response.bodyBase64 ?? toBase64(response.body);
      default: return response.body;
    }
  }, [response, big, format, pretty, filterResult]);

  const failed = tests.filter((t) => !t.passed).length;
  const corsHint = !!response && !hasOriginHeader && looksLikeCorsRejection(response);

  const copy = useCallback(async () => {
    const text = tab === 'headers'
      ? (response?.headers ?? []).map(([k, v]) => `${k}: ${v}`).join('\n')
      : bodyText;
    await copyToClipboard(text);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1200);
  }, [tab, response, bodyText]);

  const saveResponse = useCallback(async () => {
    if (!response) return;
    // Binary payloads are saved from the preserved bytes; writing the decoded
    // text would hand back a file full of replacement characters.
    if (response.binary && response.bodyBase64) {
      await saveBinaryFile(suggestedFileName(response), response.bodyBase64);
      return;
    }
    await saveTextFile(suggestedFileName(response), response.body);
  }, [response]);

  // Nothing has happened yet on this tab — show the keyboard-shortcut splash.
  // Note this is deliberately *not* shown while `sending` with prior content:
  // the previous response stays put and only the header reports progress.
  const blank = !response && !error && tests.length === 0 && logs.length === 0;
  if (blank && !sending) {
    const mod = isMac ? '⌘' : 'Ctrl';
    const shortcuts: [string, string][] = [
      ['Send Request', `${mod} + Enter`],
      ['New Request', `${mod} + B`],
      ['Close Tab', `${mod} + W`],
      ['Edit Environments', `${mod} + E`],
    ];
    return (
      <Centered>
        <Send className="h-20 w-20 -rotate-12 stroke-[1] text-fg-mute/15" />
        <div className="mt-6 space-y-2">
          {shortcuts.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-end gap-6 text-xs text-fg-mute">
              <span>{label}</span>
              <span className="w-24 font-mono text-fg-mute/80">{keys}</span>
            </div>
          ))}
        </div>
      </Centered>
    );
  }
  if (blank && sending) {
    return (
      <Centered>
        <Spinner size="lg" className="text-fg-mute/60" />
        <p className="text-xs text-fg-mute">Sending request…</p>
      </Centered>
    );
  }

  // Tab definitions (only the relevant ones for the current response state).
  const tabDefs: TabDef[] = [
    { id: 'body', label: 'Response' },
    ...(response ? [{ id: 'headers', label: 'Headers', badge: <span className="text-[11px] text-fg-mute">{response.headers.length}</span> }] : []),
    ...(response ? [{ id: 'timeline', label: 'Timeline' }] : []),
    {
      id: 'tests', label: 'Tests',
      badge: tests.length > 0 ? (
        <span className={cn('rounded px-1 text-[11px]', failed ? 'bg-bad-tint text-bad' : 'bg-ok-tint text-ok')}>
          {tests.length - failed}/{tests.length}
        </span>
      ) : undefined,
    },
    { id: 'console', label: 'Console', badge: logs.length > 0 ? <span className="text-[11px] text-fg-mute">{logs.length}</span> : undefined },
  ];
  // The active tab may vanish when a run ends without a response (Headers /
  // Timeline only exist alongside one) — fall back rather than render nothing.
  const activeTab: Tab = tabDefs.some((t) => t.id === tab) ? tab : 'body';

  const headerRight = (
    <>
      {response && activeTab === 'body' && (
        <FormatDropdown format={format} onChange={setFormat} preview={preview} onPreview={setPreview} kind={kind} />
      )}
      {sending ? (
        <span className="flex items-center gap-1.5 font-medium text-fg-mute">
          <Spinner size="sm" /> Sending…
        </span>
      ) : response ? (
        <>
          <span className={cn('font-semibold', statusColor(response.status))}>{response.status} {response.statusText}</span>
          <span className="text-fg-mute">{response.timeMs} ms</span>
          <span className="text-fg-mute">{formatBytes(response.sizeBytes)}</span>
        </>
      ) : (
        <span className="font-semibold text-bad">No response</span>
      )}
      {response && activeTab === 'body' && kind === 'json' && !big && (
        <IconButton
          onClick={() => setShowFilter((s) => !s)}
          title="Filter (JSONPath)"
          className={cn(showFilter || filter ? 'text-acc-ink' : undefined)}
        >
          <Filter className="h-4 w-4" />
        </IconButton>
      )}
      {response && <ActionsMenu copied={copied} onCopy={copy} onSave={saveResponse} onClear={onClear} />}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header: tabs left, format/status/actions pinned right */}
      <Tabs
        tabs={tabDefs}
        active={activeTab}
        onSelect={(id) => setTab(id as Tab)}
        activeClassName="border-acc text-fg"
        right={headerRight}
      />

      {/* In-flight indicator. Rendered in a fixed-height strip so switching
          between sending and idle never shifts the content below it. */}
      <div className="relative h-0.5 shrink-0 overflow-hidden" aria-hidden={!sending}>
        {sending && (
          <>
            <div className="absolute inset-0 bg-acc/15" />
            <div className="absolute inset-y-0 left-0 w-1/4 animate-progress-indeterminate bg-acc" />
          </>
        )}
      </div>

      {error && (
        <div className="flex max-h-40 shrink-0 flex-col divide-y divide-bad/20 overflow-auto border-b border-bad/20">
          {parseScriptErrors(error).map((e, i) => (
            <div key={i} className="flex items-start gap-2 bg-bad/8 px-3 py-2 text-xs text-bad">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {e.label && <span className="font-semibold">{e.label}: </span>}
                {e.message}
              </span>
              {e.jumpTab && onJumpToTab && (
                <button
                  onClick={() => onJumpToTab!(e.jumpTab!)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline"
                >
                  Open script
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {corsHint && (
        <div className="shrink-0 border-b border-warn/20 px-3 py-2">
          <Callout tone="warning" size="sm" title="Looks like an Origin/CORS check">
            The server may be rejecting this for missing an <code className="rounded bg-bg-2 px-1">Origin</code> header
            — unlike a browser tab, this app's requests don't send one automatically. Try adding an{' '}
            <code className="rounded bg-bg-2 px-1">Origin</code> header on the Params tab with the value the API expects.
          </Callout>
        </div>
      )}

      {/* tab content — dimmed, not unmounted, while the next send is running */}
      <div className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-200',
        sending && 'opacity-50',
      )}>
        {activeTab === 'body' && response && (
          response.body || response.bodyBase64 ? (
            <>
              {big && (
                <div className="flex shrink-0 items-center gap-2 border-b bg-warn-tint px-3 py-1.5 text-[11px] text-warn">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Large response ({formatBytes(response.sizeBytes)}) shown as raw text for performance.
                </div>
              )}
              <ResponseBody response={response} kind={kind} format={format} preview={preview} text={bodyText} plain={big} />
              {showFilter && kind === 'json' && (
                <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 focus-within:bg-bg-2/20">
                  <Filter className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="$.store.book[*].title"
                    className="h-ctl border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    spellCheck={false}
                    autoFocus
                  />
                  {filter && filterResult && !filterResult.ok && <span className="shrink-0 text-[11px] text-bad">invalid</span>}
                  {filter && <button onClick={() => setFilter('')} title="Clear" className="shrink-0 rounded p-0.5 text-fg-mute hover:text-fg"><X className="h-3.5 w-3.5" /></button>}
                </div>
              )}
            </>
          ) : <p className="p-3 text-xs text-fg-mute">Empty response body.</p>
        )}
        {activeTab === 'body' && !response && !error && (
          <p className="p-3 text-xs text-fg-mute">No response — see the Tests and Console tabs for what ran.</p>
        )}
        {activeTab === 'headers' && response && (
          <div className="min-h-0 flex-1 divide-y overflow-auto text-xs">
            {response.headers.map(([k, v], i) => (
              <div key={i} className="flex gap-3 px-3 py-1.5">
                <span className="w-48 shrink-0 break-words font-medium text-fg-mute">{k}</span>
                <span className="break-words font-mono">{v}</span>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'timeline' && response && <Timeline response={response} />}
        {activeTab === 'tests' && (
          <div className="min-h-0 flex-1 overflow-auto">
            {tests.length === 0
              ? <p className="p-3 text-xs text-fg-mute">No tests or assertions ran.</p>
              : (
                <div className="divide-y text-xs">
                  {tests.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                      {t.passed
                        ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                        : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />}
                      <div className="min-w-0">
                        <span className={cn('break-words', !t.passed && 'text-fg')}>{t.name}</span>
                        {!t.passed && t.error && <p className="break-words text-[11px] text-bad">{t.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}
        {activeTab === 'console' && (
          <div className="min-h-0 flex-1 overflow-auto">
            {logs.length === 0
              ? <p className="p-3 text-xs text-fg-mute">No console output.</p>
              : (
                <div className="divide-y font-mono text-xs">
                  {logs.map((l, i) => (
                    <div key={i} className={cn('break-words px-3 py-1', LOG_COLOR[l.level])}>{l.text}</div>
                  ))}
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

const LOG_COLOR: Record<LogEntry['level'], string> = {
  log: '',
  info: 'text-info',
  warn: 'text-warn',
  error: 'text-bad',
};

// Extension guessed from the response's content type, for the save dialog.
function suggestedFileName(r: ApiResponse): string {
  const ct = r.contentType.toLowerCase();
  const known: [RegExp, string][] = [
    [/json/, 'json'], [/html/, 'html'], [/xml/, 'xml'], [/csv/, 'csv'],
    [/javascript/, 'js'], [/image\/png/, 'png'], [/image\/jpe?g/, 'jpg'],
    [/image\/gif/, 'gif'], [/image\/webp/, 'webp'], [/image\/svg/, 'svg'],
    [/pdf/, 'pdf'], [/zip/, 'zip'], [/text\//, 'txt'],
  ];
  const hit = known.find(([re]) => re.test(ct));
  return `response.${hit ? hit[1] : r.binary ? 'bin' : 'txt'}`;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2">{children}</div>;
}

// The … menu holding the copy / save / clear actions, so the status readout
// stays pinned right and never gets pushed off on resize.
function ActionsMenu({ copied, onCopy, onSave, onClear }: {
  copied: boolean; onCopy: () => void; onSave: () => void; onClear?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger title="More" className="rounded p-1 text-fg-mute transition-colors hover:bg-acc hover:text-fg">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuItem onClick={onCopy} icon={copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}>
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSave} icon={<Download className="h-3.5 w-3.5" />}>
          Save response…
        </DropdownMenuItem>
        {onClear && (
          <DropdownMenuItem onClick={onClear} icon={<Eraser className="h-3.5 w-3.5" />}>
            Clear response
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── response body ────────────────────────────────────────────────────────────

function ResponseBody({ response, kind, format, preview, text, plain }: {
  response: ApiResponse; kind: Kind; format: Format; preview: boolean; text: string; plain?: boolean;
}) {
  if (preview) {
    if (kind === 'html' || format === 'html') {
      return <iframe title="Response preview" sandbox="" srcDoc={response.body} className="min-h-0 flex-1 border-0 bg-white dark:bg-[hsl(var(--bg-c))]" />;
    }
    if (kind === 'image') {
      // Use the preserved bytes; the decoded text copy of a PNG is not an image.
      const b64 = response.bodyBase64;
      if (!b64) {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-fg-mute">
            Image too large to preview.
          </div>
        );
      }
      return (
        <div className="min-h-0 flex-1 overflow-auto bg-sunk p-4">
          <img src={`data:${response.contentType};base64,${b64}`} alt="Response" className="max-w-full" />
        </div>
      );
    }
  }
  if (response.binary && format !== 'hex' && format !== 'base64') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Binary className="h-ctl w-ctl text-fg-mute/30" />
        <p className="text-xs text-fg-mute">
          Binary response ({response.contentType || 'unknown type'}, {formatBytes(response.sizeBytes)}).
        </p>
        <p className="text-[11px] text-fg-mute/80">
          Switch the format to Hex or Base64 to inspect it, or save it from the … menu.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <CodeViewer value={text} language={!plain && format === 'json' ? 'json' : 'text'} plain={plain} />
    </div>
  );
}

// ─── timeline ─────────────────────────────────────────────────────────────────

function Timeline({ response }: { response: ApiResponse }) {
  const t = response.timings;
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 font-mono text-xs">
      <div>
        <p className={cn('font-semibold', statusColor(response.status))}>&lt; HTTP {response.status} {response.statusText}</p>
        {response.headers.map(([k, v], i) => (
          <p key={i} className="break-words text-fg-mute">&lt; {k}: {v}</p>
        ))}
      </div>
      {t && (
        <div className="space-y-1">
          <TimingBar label="Waiting (TTFB)" ms={t.ttfbMs} total={response.timeMs} tone="bg-[hsl(var(--cat-1-c)/0.85)]" />
          <TimingBar label="Download" ms={t.downloadMs} total={response.timeMs} tone="bg-[hsl(var(--cat-2-c)/0.85)]" />
        </div>
      )}
      <div className="space-y-0.5 text-fg-mute">
        <p>Total time: <span className="text-fg">{response.timeMs} ms</span></p>
        <p>Size: <span className="text-fg">{formatBytes(response.sizeBytes)}</span></p>
        {response.contentType && <p>Content-Type: <span className="text-fg">{response.contentType}</span></p>}
        {response.url && <p className="break-all">URL: <span className="text-fg">{response.url}</span></p>}
      </div>
    </div>
  );
}

function TimingBar({ label, ms, total, tone }: { label: string; ms: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.max(2, Math.round((ms / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-fg-mute">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-2">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-16 shrink-0 text-right text-fg">{ms} ms</span>
    </div>
  );
}

// ─── format dropdown ({ } JSON ▾) ─────────────────────────────────────────────

function FormatDropdown({ format, onChange, preview, onPreview, kind }: {
  format: Format; onChange: (f: Format) => void; preview: boolean; onPreview: (v: boolean) => void; kind: Kind;
}) {
  const Icon = FORMAT_META[format].icon;
  const canPreview = kind === 'html' || kind === 'image' || format === 'html';

  const Row = ({ id }: { id: Format }) => {
    const RowIcon = FORMAT_META[id].icon;
    const active = format === id;
    return (
      <DropdownMenuItem
        onClick={() => onChange(id)}
        className={cn(active && 'bg-acc-tint text-acc-ink')}
        icon={<RowIcon className="h-3.5 w-3.5 shrink-0" />}
      >
        <span className="flex w-full items-center justify-between gap-2">
          {FORMAT_META[id].label}
          {active && <Check className="h-3.5 w-3.5 text-acc-ink" />}
        </span>
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-md border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-fg-mute transition-colors hover:text-fg">
        <Icon className="h-3 w-3" /> {FORMAT_META[format].label}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 p-1.5">
        <div className={cn('flex items-center justify-between px-2 py-1.5 text-xs', !canPreview && 'opacity-50')}>
          <span>Preview</span>
          <Switch checked={preview} onCheckedChange={onPreview} disabled={!canPreview} aria-label="Preview" />
        </div>
        <DropdownMenuSeparator />
        {SYNTAX_FORMATS.map((f) => <Row key={f} id={f} />)}
        <DropdownMenuSeparator />
        {ENCODING_FORMATS.map((f) => <Row key={f} id={f} />)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── encoders ─────────────────────────────────────────────────────────────────

function toBase64(s: string): string {
  try { return btoa(unescape(encodeURIComponent(s))); } catch { return ''; }
}

function base64ToBytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

const HEX_DUMP_LIMIT = 200_000;

function hexDump(input: Uint8Array): string {
  const bytes = input.subarray(0, HEX_DUMP_LIMIT);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  if (input.length > HEX_DUMP_LIMIT) {
    lines.push(`… ${input.length - HEX_DUMP_LIMIT} more bytes not shown`);
  }
  return lines.join('\n');
}
