// Response viewer: tabs (Response / Headers / Timeline / Tests / Console) plus a
// status·time·size readout, a format dropdown (Bruno-style: Preview toggle +
// JSON/HTML/XML/JavaScript and Raw/Hex/Base64), and copy / download / clear
// actions. JSON bodies are pretty-printed; every view is copyable.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Binary, Braces, Check, ChevronDown, ChevronsRight, Code2, Copy, Download, Eraser,
  FileCode, FileText, Filter, Hash, Loader2, MoreHorizontal, Send, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { ApiResponse, LogEntry, TestResult } from './types';
import { formatBytes, prettyBody, statusColor } from './request';
import { saveTextFile } from './fileio';
import { queryJson } from './jsonpath';
import { ResponseViewer } from './ResponseViewer';

type Kind = 'json' | 'html' | 'xml' | 'image' | 'text';
type Format = 'json' | 'html' | 'xml' | 'javascript' | 'raw' | 'hex' | 'base64';

function detectKind(r: ApiResponse): Kind {
  const ct = r.contentType.toLowerCase();
  if (/json/.test(ct) || /^\s*[[{]/.test(r.body)) return 'json';
  if (/html/.test(ct)) return 'html';
  if (/xml/.test(ct)) return 'xml';
  if (/image\//.test(ct)) return 'image';
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
}

type Tab = 'body' | 'headers' | 'timeline' | 'tests' | 'console';

export function ResponsePanel({ response, sending, error, tests, logs, onClear }: Props) {
  const [tab, setTab] = useState<Tab>('body');
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<Format>('raw');
  const [preview, setPreview] = useState(false);
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  // Track header width so the tab strip can collapse into a » overflow menu when
  // the right-side controls leave too little room (Bruno-style responsiveness).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerW, setHeaderW] = useState(Infinity);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setHeaderW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure each tab's intrinsic width (from a hidden row) and the right-group
  // width so the strip collapses precisely — no clipping, status stays pinned.
  const measureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabW, setTabW] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    let changed = false;
    const next: Record<string, number> = {};
    for (const id of Object.keys(measureRefs.current)) {
      const el = measureRefs.current[id];
      if (!el) continue;
      next[id] = el.offsetWidth;
      if (tabW[id] !== next[id]) changed = true;
    }
    if (changed) setTabW(next);
  });

  const rightRef = useRef<HTMLDivElement>(null);
  const [rightW, setRightW] = useState(0);
  useEffect(() => {
    const el = rightRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setRightW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const big = !!response && response.body.length > LARGE_BODY;

  const pretty = useMemo(
    () => (response && !big ? prettyBody(response.body, response.contentType) : response?.body ?? ''),
    [response, big],
  );
  const kind = useMemo(() => (response ? detectKind(response) : 'text'), [response]);

  // Reset the view to the detected default whenever a new response arrives.
  // Oversized bodies default to raw text to stay responsive.
  useEffect(() => {
    if (response) {
      setFormat(response.body.length > LARGE_BODY ? 'raw' : KIND_FORMAT[detectKind(response)]);
      setPreview(false);
    }
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
  }, [response, kind, filter]);

  const bodyText = useMemo(() => {
    if (!response) return '';
    if (filterResult?.ok) return filterResult.text;
    if (big && format === 'json') return response.body;
    switch (format) {
      case 'json': return pretty;
      case 'hex': return hexDump(response.body);
      case 'base64': return toBase64(response.body);
      default: return response.body;
    }
  }, [response, format, pretty, filterResult]);

  const failed = tests.filter((t) => !t.passed).length;

  const copy = async () => {
    const text = tab === 'headers'
      ? (response?.headers ?? []).map(([k, v]) => `${k}: ${v}`).join('\n')
      : bodyText;
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const saveResponse = async () => {
    if (!response) return;
    const ext = kind === 'json' ? 'json' : kind === 'html' ? 'html' : kind === 'xml' ? 'xml' : 'txt';
    await saveTextFile(`response.${ext}`, response.body);
  };

  if (sending) {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground">Sending request…</p>
      </Centered>
    );
  }

  if (!response && !error && tests.length === 0 && logs.length === 0) {
    const mod = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
    const shortcuts: [string, string][] = [
      ['Send Request', `${mod} + Enter`],
      ['New Request', `${mod} + B`],
      ['Close Tab', `${mod} + W`],
      ['Edit Environments', `${mod} + E`],
    ];
    return (
      <Centered>
        <Send className="h-20 w-20 -rotate-12 stroke-[1] text-muted-foreground/15" />
        <div className="mt-6 space-y-2">
          {shortcuts.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-end gap-6 text-xs text-muted-foreground">
              <span>{label}</span>
              <span className="w-24 font-mono text-muted-foreground/80">{keys}</span>
            </div>
          ))}
        </div>
      </Centered>
    );
  }

  const TabBtn = ({ id, label, badge }: { id: Tab; label: string; badge?: React.ReactNode }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'relative -mb-px flex shrink-0 items-center gap-1 border-b-2 py-2 text-xs font-medium transition-colors',
        tab === id ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}{badge}
    </button>
  );

  // Tab definitions (only the relevant ones for the current response state).
  const tabDefs: { id: Tab; label: string; badge?: React.ReactNode }[] = [
    { id: 'body', label: 'Response' },
    ...(response ? [{ id: 'headers' as Tab, label: 'Headers', badge: <span className="text-[9px] text-muted-foreground">{response.headers.length}</span> }] : []),
    ...(response ? [{ id: 'timeline' as Tab, label: 'Timeline' }] : []),
    {
      id: 'tests', label: 'Tests',
      badge: tests.length > 0 ? (
        <span className={cn('rounded px-1 text-[10px]', failed ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
          {tests.length - failed}/{tests.length}
        </span>
      ) : undefined,
    },
    { id: 'console', label: 'Console', badge: logs.length > 0 ? <span className="text-[9px] text-muted-foreground">{logs.length}</span> : undefined },
  ];

  // Progressively drop trailing tabs into a » menu as the header narrows, using
  // measured widths so the active tab is never clipped and the status group on
  // the right stays pinned. Response and the active tab always stay inline.
  const GAP = 16;     // gap-4 between tabs
  const CHEV = 42;    // » button + its left margin
  const PAD = 24;     // left padding + buffer before the right group
  const wid = (id: string) => tabW[id] ?? 80;
  const budget = headerW - rightW - PAD;
  const totalAll = tabDefs.reduce((s, t) => s + wid(t.id) + GAP, 0);

  let inlineTabs = tabDefs;
  let overflowTabs: typeof tabDefs = [];
  if (Number.isFinite(headerW) && rightW > 0 && totalAll > budget) {
    const head: typeof tabDefs = [];
    let used = 0;
    for (const t of tabDefs) {
      if (used + wid(t.id) + GAP + CHEV <= budget) { head.push(t); used += wid(t.id) + GAP; }
      else break;
    }
    if (head.length === 0) head.push(tabDefs[0]);
    let rest = tabDefs.filter((t) => !head.includes(t));
    // Guarantee the active tab is visible: trim trailing inline tabs to make room.
    if (rest.some((t) => t.id === tab)) {
      const active = tabDefs.find((t) => t.id === tab)!;
      let hw = head.reduce((s, t) => s + wid(t.id) + GAP, 0);
      while (head.length > 1 && hw + wid(active.id) + GAP + CHEV > budget) {
        hw -= wid(head.pop()!.id) + GAP;
      }
      head.push(active);
      rest = tabDefs.filter((t) => !head.includes(t));
    }
    inlineTabs = head;
    overflowTabs = rest;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header: tabs left, format/status/actions pinned right */}
      <div ref={headerRef} className="flex items-center border-b px-3">
        {/* hidden row used only to measure intrinsic tab widths */}
        <div aria-hidden className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-4">
          {tabDefs.map((t) => (
            <button key={t.id} ref={(el) => { measureRefs.current[t.id] = el; }} className="flex shrink-0 items-center gap-1 py-2 text-xs font-medium">
              {t.label}{t.badge}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-4 overflow-hidden">
          {inlineTabs.map((t) => <TabBtn key={t.id} id={t.id} label={t.label} badge={t.badge} />)}
        </div>
        {overflowTabs.length > 0 && <TabOverflow tabs={overflowTabs} onSelect={setTab} />}

        <div ref={rightRef} className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap pl-4 text-xs">
          {response && tab === 'body' && (
            <FormatDropdown format={format} onChange={setFormat} preview={preview} onPreview={setPreview} />
          )}
          {response ? (
            <>
              <span className={cn('font-semibold', statusColor(response.status))}>{response.status} {response.statusText}</span>
              <span className="text-muted-foreground">{response.timeMs} ms</span>
              <span className="text-muted-foreground">{formatBytes(response.sizeBytes)}</span>
            </>
          ) : (
            <span className="font-semibold text-destructive">No response</span>
          )}
          {response && tab === 'body' && kind === 'json' && !big && (
            <button
              onClick={() => setShowFilter((s) => !s)}
              title="Filter (JSONPath)"
              className={cn('rounded p-1 transition-colors hover:bg-accent hover:text-foreground', showFilter || filter ? 'text-amber-500' : 'text-muted-foreground')}
            >
              <Filter className="h-4 w-4" />
            </button>
          )}
          {response && (
            <ActionsMenu copied={copied} onCopy={copy} onSave={saveResponse} onClear={onClear} />
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* tab content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'body' && response && (
          response.body ? (
            <>
              {big && (
                <div className="flex shrink-0 items-center gap-2 border-b bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Large response ({formatBytes(response.sizeBytes)}) shown as raw text for performance.
                </div>
              )}
              <ResponseBody response={response} kind={kind} format={format} preview={preview} text={bodyText} plain={big} />
              {showFilter && kind === 'json' && (
                <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5">
                  <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="$.store.book[*].title"
                    className="h-7 border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    spellCheck={false}
                    autoFocus
                  />
                  {filter && filterResult && !filterResult.ok && <span className="shrink-0 text-[10px] text-destructive">invalid</span>}
                  {filter && <button onClick={() => setFilter('')} title="Clear" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
                </div>
              )}
            </>
          ) : <p className="p-3 text-xs text-muted-foreground">Empty response body.</p>
        )}
        {tab === 'headers' && response && (
          <div className="min-h-0 flex-1 divide-y overflow-auto text-xs">
            {response.headers.map(([k, v], i) => (
              <div key={i} className="flex gap-3 px-3 py-1.5">
                <span className="w-48 shrink-0 break-words font-medium text-muted-foreground">{k}</span>
                <span className="break-words font-mono">{v}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'timeline' && response && <Timeline response={response} />}
        {tab === 'tests' && (
          <div className="min-h-0 flex-1 overflow-auto">
            {tests.length === 0
              ? <p className="p-3 text-xs text-muted-foreground">No tests or assertions ran.</p>
              : (
                <div className="divide-y text-xs">
                  {tests.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                      {t.passed
                        ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                      <div className="min-w-0">
                        <span className={cn('break-words', !t.passed && 'text-foreground')}>{t.name}</span>
                        {!t.passed && t.error && <p className="break-words text-[11px] text-destructive">{t.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}
        {tab === 'console' && (
          <div className="min-h-0 flex-1 overflow-auto">
            {logs.length === 0
              ? <p className="p-3 text-xs text-muted-foreground">No console output.</p>
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
  info: 'text-blue-600 dark:text-blue-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-destructive',
};

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2">{children}</div>;
}

// The … menu holding the copy / save / clear actions, so the status readout
// stays pinned right and never gets pushed off on resize.
function ActionsMenu({ copied, onCopy, onSave, onClear }: {
  copied: boolean; onCopy: () => void; onSave: () => void; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent';
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="More" className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 min-w-[11rem] rounded-md border bg-popover p-1 shadow-md">
            <button className={item} onClick={() => { onCopy(); setOpen(false); }}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </button>
            <button className={item} onClick={() => { onSave(); setOpen(false); }}>
              <Download className="h-3.5 w-3.5" /> Save response…
            </button>
            {onClear && (
              <button className={item} onClick={() => { onClear(); setOpen(false); }}>
                <Eraser className="h-3.5 w-3.5" /> Clear response
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// The » button shown when the tab strip is too narrow; lists the hidden tabs.
function TabOverflow({ tabs, onSelect }: { tabs: { id: Tab; label: string; badge?: React.ReactNode }[]; onSelect: (id: Tab) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-3 shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        title="More tabs"
        className="-mb-px border-b-2 border-transparent py-2 text-muted-foreground hover:text-foreground"
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 min-w-[10rem] rounded-md border bg-popover p-1 shadow-md">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => { onSelect(t.id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                {t.label}{t.badge}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── response body ────────────────────────────────────────────────────────────

function ResponseBody({ response, kind, format, preview, text, plain }: {
  response: ApiResponse; kind: Kind; format: Format; preview: boolean; text: string; plain?: boolean;
}) {
  if (preview) {
    if (kind === 'html' || format === 'html') {
      return <iframe title="Response preview" sandbox="" srcDoc={response.body} className="min-h-0 flex-1 border-0 bg-white" />;
    }
    if (kind === 'image') {
      const src = `data:${response.contentType};base64,${toBase64(response.body)}`;
      return (
        <div className="min-h-0 flex-1 overflow-auto bg-[#f6f6f6] p-4 dark:bg-neutral-900">
          <img src={src} alt="Response" className="max-w-full" />
        </div>
      );
    }
  }
  return (
    <div className="min-h-0 flex-1">
      <ResponseViewer value={text} language={!plain && format === 'json' ? 'json' : 'text'} plain={plain} />
    </div>
  );
}

// ─── timeline ─────────────────────────────────────────────────────────────────

function Timeline({ response }: { response: ApiResponse }) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 font-mono text-xs">
      <div>
        <p className={cn('font-semibold', statusColor(response.status))}>&lt; HTTP {response.status} {response.statusText}</p>
        {response.headers.map(([k, v], i) => (
          <p key={i} className="break-words text-muted-foreground">&lt; {k}: {v}</p>
        ))}
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <p>Total time: <span className="text-foreground">{response.timeMs} ms</span></p>
        <p>Size: <span className="text-foreground">{formatBytes(response.sizeBytes)}</span></p>
        {response.contentType && <p>Content-Type: <span className="text-foreground">{response.contentType}</span></p>}
      </div>
    </div>
  );
}

// ─── format dropdown ({ } JSON ▾) ─────────────────────────────────────────────

function FormatDropdown({ format, onChange, preview, onPreview }: {
  format: Format; onChange: (f: Format) => void; preview: boolean; onPreview: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = FORMAT_META[format].icon;

  const Row = ({ id }: { id: Format }) => {
    const RowIcon = FORMAT_META[id].icon;
    const active = format === id;
    return (
      <button
        onClick={() => { onChange(id); setOpen(false); }}
        className={cn('flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent', active && 'bg-amber-400/10 text-amber-500')}
      >
        <RowIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{FORMAT_META[id].label}</span>
        {active && <Check className="h-3.5 w-3.5 text-amber-500" />}
      </button>
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
      >
        <Icon className="h-3 w-3" /> {FORMAT_META[format].label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-48 rounded-md border bg-popover p-1.5 shadow-md">
            <div className="flex items-center justify-between px-2 py-1.5 text-xs">
              <span>Preview</span>
              <Switch checked={preview} onCheckedChange={onPreview} aria-label="Preview" />
            </div>
            <div className="my-1 border-t" />
            {SYNTAX_FORMATS.map((f) => <Row key={f} id={f} />)}
            <div className="my-1 border-t" />
            {ENCODING_FORMATS.map((f) => <Row key={f} id={f} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ─── encoders ─────────────────────────────────────────────────────────────────

function toBase64(s: string): string {
  try { return btoa(unescape(encodeURIComponent(s))); } catch { return ''; }
}

function hexDump(s: string): string {
  const bytes = new TextEncoder().encode(s.slice(0, 200_000));
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return lines.join('\n');
}
