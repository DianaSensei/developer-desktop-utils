import { useState, useRef, useMemo } from 'react';
import { Loader2, AlertCircle, Search, Copy, Check, X, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { kafkaApi, type KafkaMessage, type PartitionInfo } from './types';

type FetchMode = 'tail' | 'from' | 'range';
type ValueMode = 'text' | 'json' | 'hex';
type SortCol = 'partition' | 'offset' | 'key' | 'value' | 'timestamp';
type SortDir = 'asc' | 'desc';

interface ColWidths {
  partition: number;
  offset: number;
  key: number;
  timestamp: number;
}

const DEFAULT_WIDTHS: ColWidths = { partition: 40, offset: 88, key: 120, timestamp: 144 };
const MIN_WIDTHS: ColWidths = { partition: 32, offset: 56, key: 60, timestamp: 90 };
const DETAIL_MIN = 220;
const DETAIL_DEFAULT = 384;
const LIMITS = [20, 50, 100, 200] as const;

interface MessagesTabProps {
  brokerId: string;
  topic: string;
  partitions: PartitionInfo[];
}

function tryFormatJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function toHexView(s: string): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length === 0) return '(empty)';
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
  }
  return lines.join('\n');
}

function renderValue(value: string | null, mode: ValueMode): string {
  if (value === null) return '(null)';
  if (mode === 'json') return tryFormatJson(value);
  if (mode === 'hex') return toHexView(value);
  return value;
}

function formatTs(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ── Shared: Copy button ───────────────────────────────────────────────────────

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const { config } = useAppConfig();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    await copyToClipboard(text);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), config.editor.copyFeedbackMs);
  };

  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className={cn(
        'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0',
        className,
      )}
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ── Shared: Section header ────────────────────────────────────────────────────

function SectionHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-muted/15 border-b border-border/40">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {title}
      </span>
      {aside}
    </div>
  );
}

// ── Column header with sort + resize ─────────────────────────────────────────

interface ColHeaderProps {
  label: string;
  col: SortCol;
  align?: 'left' | 'right';
  sortCol: SortCol | null;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
  onResizeStart?: (e: React.MouseEvent) => void;
}

function ColHeader({ label, col, align = 'left', sortCol, sortDir, onSort, onResizeStart }: ColHeaderProps) {
  const active = sortCol === col;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <div className={cn('relative flex items-center min-w-0', align === 'right' && 'justify-end')}>
      <button
        onClick={() => onSort(col)}
        className={cn(
          'flex items-center gap-1 text-xs font-medium transition-colors select-none whitespace-nowrap',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
        <Icon className={cn('w-3 h-3 shrink-0', !active && 'opacity-30')} />
      </button>
      {onResizeStart && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 translate-x-full cursor-col-resize flex items-center justify-center z-10 group"
          onMouseDown={onResizeStart}
        >
          <div className="w-px h-4 bg-border group-hover:bg-primary/70 transition-colors" />
        </div>
      )}
    </div>
  );
}

// ── JSON syntax highlighter ──────────────────────────────────────────────────

type JTok = { t: 'key' | 'str' | 'num' | 'bool' | 'null' | 'punct' | 'ws'; v: string };

function tokenizeJson(s: string): JTok[] {
  const out: JTok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '"') { j++; break; }
        j++;
      }
      const after = s.slice(j).trimStart();
      out.push({ t: after.startsWith(':') ? 'key' : 'str', v: s.slice(i, j) });
      i = j;
    } else if (s.slice(i, i + 4) === 'true') {
      out.push({ t: 'bool', v: 'true' }); i += 4;
    } else if (s.slice(i, i + 5) === 'false') {
      out.push({ t: 'bool', v: 'false' }); i += 5;
    } else if (s.slice(i, i + 4) === 'null') {
      out.push({ t: 'null', v: 'null' }); i += 4;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i;
      if (s[j] === '-') j++;
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      if (s[j] === '.') { j++; while (j < s.length && s[j] >= '0' && s[j] <= '9') j++; }
      if (s[j] === 'e' || s[j] === 'E') { j++; if (s[j] === '+' || s[j] === '-') j++; while (j < s.length && s[j] >= '0' && s[j] <= '9') j++; }
      out.push({ t: 'num', v: s.slice(i, j) }); i = j;
    } else if ('{[]},:'.includes(ch)) {
      out.push({ t: 'punct', v: ch }); i++;
    } else {
      let j = i + 1;
      while (j < s.length && ' \n\r\t'.includes(s[j])) j++;
      out.push({ t: 'ws', v: s.slice(i, j) }); i = j;
    }
  }
  return out;
}

const TOK_CLS: Record<JTok['t'], string> = {
  key:   'text-sky-400',
  str:   'text-emerald-400',
  num:   'text-amber-400',
  bool:  'text-violet-400',
  null:  'text-rose-400',
  punct: 'text-muted-foreground/70',
  ws:    '',
};

function JsonHighlight({ raw }: { raw: string }) {
  const tokens = useMemo(() => {
    try {
      return tokenizeJson(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      return null;
    }
  }, [raw]);

  if (!tokens) {
    return (
      <div>
        <pre className="px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">{raw}</pre>
        <p className="px-3 pb-2 text-[10px] text-muted-foreground/40 italic">Not valid JSON</p>
      </div>
    );
  }

  return (
    <pre className="px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
      {tokens.map((tok, idx) =>
        tok.t === 'ws' ? tok.v : <span key={idx} className={TOK_CLS[tok.t]}>{tok.v}</span>
      )}
    </pre>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  msg: KafkaMessage;
  defaultValueMode: ValueMode;
  onClose: () => void;
}

function DetailPanel({ msg, defaultValueMode, onClose }: DetailPanelProps) {
  const [valueMode, setValueMode] = useState<ValueMode>(defaultValueMode);
  const renderedValue = useMemo(() => renderValue(msg.value, valueMode), [msg.value, valueMode]);
  const ts = formatTs(msg.timestamp);
  const headerEntries = Object.entries(msg.headers);

  const properties = [
    { label: 'Partition', value: String(msg.partition) },
    { label: 'Offset',    value: String(msg.offset) },
    { label: 'Timestamp', value: ts },
    { label: 'Key',       value: msg.key },
  ] as const;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/10 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Message Detail
        </span>
        <button
          onClick={onClose}
          title="Close"
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-border/40">

        {/* ── Properties ── */}
        <div>
          <SectionHead title="Properties" />
          <div className="px-3 py-2 space-y-1.5">
            {properties.map(({ label, value }) => (
              <div key={label} className="flex items-start gap-2 min-w-0">
                <span className="text-xs text-muted-foreground w-[4.5rem] shrink-0 pt-px">{label}</span>
                {value !== null ? (
                  <>
                    <span className="text-xs font-mono flex-1 break-all leading-snug">{value}</span>
                    <CopyBtn text={value} />
                  </>
                ) : (
                  <span className="text-xs font-mono italic text-muted-foreground/50">null</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Value ── */}
        <div>
          <SectionHead
            title="Value"
            aside={
              <div className="flex items-center gap-1.5">
                <div className="flex rounded border border-input text-xs overflow-hidden">
                  {(['text', 'json', 'hex'] as ValueMode[]).map((m) => (
                    <button
                      key={m}
                      className={cn(
                        'px-2 py-0.5 font-mono transition-colors',
                        valueMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60',
                      )}
                      onClick={() => setValueMode(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {msg.value !== null && <CopyBtn text={renderedValue} />}
              </div>
            }
          />
          {msg.value === null ? (
            <p className="px-3 py-2.5 text-xs font-mono italic text-muted-foreground/50">null</p>
          ) : valueMode === 'json' ? (
            <JsonHighlight raw={msg.value} />
          ) : (
            <pre className="px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
              {renderedValue}
            </pre>
          )}
        </div>

        {/* ── Headers ── always shown */}
        <div>
          <SectionHead
            title="Headers"
            aside={
              headerEntries.length > 0
                ? <span className="text-xs text-muted-foreground/60 tabular-nums">{headerEntries.length}</span>
                : undefined
            }
          />
          {headerEntries.length === 0 ? (
            <p className="px-3 py-2.5 text-xs italic text-muted-foreground/40">No headers</p>
          ) : (
            <div className="divide-y divide-border/30">
              {headerEntries.map(([k, v]) => (
                <div key={k} className="px-3 py-2 flex items-start gap-2 min-w-0">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="text-xs font-mono text-muted-foreground truncate">{k}</div>
                    <div className="text-xs font-mono break-all leading-snug">{v}</div>
                  </div>
                  <CopyBtn text={v} />
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MessagesTab({ brokerId, topic, partitions }: MessagesTabProps) {
  const { config } = useAppConfig();
  const [defaultValueMode, setDefaultValueMode] = usePersistentState<ValueMode>(
    `devtool:kafka:${brokerId}:defaultValueMode`,
    'text',
  );
  const [partition, setPartition] = useState<number>(partitions[0]?.id ?? 0);
  const [mode, setMode] = useState<FetchMode>('tail');
  const [fromOffset, setFromOffset] = useState('0');
  const [toOffset, setToOffset] = useState('100');
  const [limit, setLimit] = useState<number>(50);
  const [keyword, setKeyword] = useState('');
  const [messages, setMessages] = useState<KafkaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<KafkaMessage | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Column widths (px) — value column is always 1fr
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_WIDTHS);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;

  // Detail panel width (px)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT);
  const detailWidthRef = useRef(detailWidth);
  detailWidthRef.current = detailWidth;

  // Sort
  const [sortCol, setSortCol] = useState<SortCol | null>('offset');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // Column resize
  const startColResize = (col: keyof ColWidths, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidthsRef.current[col];

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_WIDTHS[col], startWidth + ev.clientX - startX);
      setColWidths((w) => ({ ...w, [col]: newWidth }));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Detail panel resize — dragging left edge: drag left = wider, drag right = narrower
  const startDetailResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailWidthRef.current;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(DETAIL_MIN, startWidth + startX - ev.clientX);
      setDetailWidth(newWidth);
      detailWidthRef.current = newWidth;
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const gridCols = `${colWidths.partition}px ${colWidths.offset}px ${colWidths.key}px 1fr ${colWidths.timestamp}px`;

  const doFetch = async () => {
    setLoading(true);
    setError('');
    setSelectedMsg(null);
    setHasMore(false);
    try {
      let startOffset: number;
      let fetchLimit: number;
      if (mode === 'tail') {
        startOffset = -1;
        fetchLimit = limit;
      } else if (mode === 'from') {
        startOffset = parseInt(fromOffset, 10) || 0;
        fetchLimit = limit;
      } else {
        const from = parseInt(fromOffset, 10) || 0;
        const to = parseInt(toOffset, 10) || 0;
        startOffset = from;
        fetchLimit = Math.min(Math.max(to - from, 1), config.kafka.maxFetchMessages);
      }
      const msgs = await kafkaApi.fetchMessages(brokerId, topic, partition, startOffset, fetchLimit);
      setMessages(msgs);
      setFetched(true);
      if (mode !== 'range' && msgs.length >= fetchLimit) {
        const minLoaded = msgs.reduce((min, m) => Math.min(min, m.offset), Infinity);
        const part = partitions.find((p) => p.id === partition);
        setHasMore(!part || minLoaded > part.earliestOffset);
      }
    } catch (e) {
      setError(String(e));
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const minOffset = messages.reduce((min, m) => Math.min(min, m.offset), Infinity);
      const part = partitions.find((p) => p.id === partition);
      const earliest = part?.earliestOffset ?? 0;
      if (minOffset <= earliest) { setHasMore(false); return; }
      const startOffset = Math.max(earliest, minOffset - limit);
      const fetchLimit = minOffset - startOffset;
      const more = await kafkaApi.fetchMessages(brokerId, topic, partition, startOffset, fetchLimit);
      if (more.length === 0) { setHasMore(false); return; }
      setMessages((prev) => [...prev, ...more]);
      const newMin = more.reduce((min, m) => Math.min(min, m.offset), Infinity);
      setHasMore(newMin > earliest);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRowClick = (msg: KafkaMessage) => {
    const isSame = selectedMsg?.partition === msg.partition && selectedMsg?.offset === msg.offset;
    setSelectedMsg(isSame ? null : msg);
  };

  const filtered = useMemo(() =>
    keyword
      ? messages.filter((m) =>
          [m.key, m.value, ...Object.values(m.headers)]
            .some((v) => v?.toLowerCase().includes(keyword.toLowerCase()))
        )
      : messages,
    [messages, keyword],
  );

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'partition':  cmp = a.partition - b.partition; break;
        case 'offset':     cmp = a.offset - b.offset; break;
        case 'key':        cmp = (a.key ?? '').localeCompare(b.key ?? ''); break;
        case 'value':      cmp = (a.value ?? '').localeCompare(b.value ?? ''); break;
        case 'timestamp': {
          const ta = new Date(a.timestamp).getTime();
          const tb = new Date(b.timestamp).getTime();
          cmp = !isNaN(ta) && !isNaN(tb) ? ta - tb : a.timestamp.localeCompare(b.timestamp);
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const selectedPartition = partitions.find((p) => p.id === partition);
  const sortProps = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex-1 flex flex-col min-h-0">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 py-2.5 border-b shrink-0 bg-muted/10">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Partition</Label>
          <Select value={String(partition)} onValueChange={(v) => setPartition(Number(v))}>
            <SelectTrigger className="h-8 text-xs font-mono min-w-[9rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {partitions.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  P{p.id} · {p.earliestOffset >= 0 ? p.earliestOffset.toLocaleString() : '?'} – {p.latestOffset >= 0 ? p.latestOffset.toLocaleString() : '?'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Start from</Label>
          <div className="flex rounded-lg border border-input overflow-hidden text-xs h-8">
            {(['tail', 'from', 'range'] as FetchMode[]).map((m) => (
              <button
                key={m}
                className={cn(
                  'px-2.5 transition-colors whitespace-nowrap',
                  mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
                onClick={() => setMode(m)}
              >
                {m === 'tail' ? 'Latest' : m === 'from' ? 'Offset' : 'Range'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'from' && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Start offset</Label>
            <Input
              type="number"
              min="0"
              value={fromOffset}
              onChange={(e) => setFromOffset(e.target.value)}
              placeholder={selectedPartition ? String(selectedPartition.earliestOffset) : '0'}
              className="h-8 w-28 text-xs font-mono"
              onKeyDown={(e) => e.key === 'Enter' && doFetch()}
            />
          </div>
        )}

        {mode === 'range' && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="number" min="0"
                value={fromOffset}
                onChange={(e) => setFromOffset(e.target.value)}
                className="h-8 w-24 text-xs font-mono"
                onKeyDown={(e) => e.key === 'Enter' && doFetch()}
              />
            </div>
            <span className="text-sm text-muted-foreground mb-1.5">–</span>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="number" min="0"
                value={toOffset}
                onChange={(e) => setToOffset(e.target.value)}
                className="h-8 w-24 text-xs font-mono"
                onKeyDown={(e) => e.key === 'Enter' && doFetch()}
              />
            </div>
          </div>
        )}

        {mode !== 'range' && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Limit</Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="h-8 text-xs w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMITS.map((l) => <SelectItem key={l} value={String(l)}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Default view</Label>
          <div className="flex rounded-lg border border-input overflow-hidden text-xs h-8">
            {(['text', 'json', 'hex'] as ValueMode[]).map((m) => (
              <button
                key={m}
                className={cn(
                  'px-2.5 transition-colors font-mono',
                  defaultValueMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
                onClick={() => setDefaultValueMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-2 ml-auto">
          {fetched && !loading && (
            <span className="text-xs text-muted-foreground tabular-nums mb-1.5">
              {filtered.length.toLocaleString()}
              {keyword ? ` / ${messages.length.toLocaleString()}` : ''}
              {' '}msg{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
          <Button size="sm" className="h-8 gap-1.5" onClick={doFetch} disabled={loading}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fetch'}
          </Button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="px-4 py-1.5 border-b shrink-0 flex items-center gap-2 bg-muted/5">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Filter by key, value, or headers…"
          className="h-8 text-xs border-0 shadow-none focus-visible:ring-0 px-0 flex-1"
          disabled={!fetched}
        />
        {keyword && (
          <button
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setKeyword('')}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── Body: message list + detail panel ── */}
      <div className="flex-1 flex min-h-0">

        {/* Message list */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-x-hidden">

          {/* Status states */}
          {(loading || error || !fetched || (!loading && !error && fetched && filtered.length === 0)) && (
            <div className="flex-1 flex items-center justify-center">
              {loading && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Fetching messages…
                </span>
              )}
              {!loading && error && (
                <span className="flex items-start gap-2 text-sm text-destructive px-6 max-w-xs">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="break-all">{error}</span>
                </span>
              )}
              {!loading && !error && !fetched && (
                <span className="text-sm text-muted-foreground">Choose a partition and click Fetch</span>
              )}
              {!loading && !error && fetched && filtered.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {keyword ? 'No messages match the filter' : 'No messages in this range'}
                </span>
              )}
            </div>
          )}

          {/* Column headers */}
          {!loading && !error && sorted.length > 0 && (
            <div
              className="grid px-3 py-2 border-b bg-muted/10 shrink-0"
              style={{ gridTemplateColumns: gridCols, gap: '0.5rem' }}
            >
              <ColHeader label="P" col="partition" align="right" {...sortProps}
                onResizeStart={(e) => startColResize('partition', e)} />
              <ColHeader label="Offset" col="offset" {...sortProps}
                onResizeStart={(e) => startColResize('offset', e)} />
              <ColHeader label="Key" col="key" {...sortProps}
                onResizeStart={(e) => startColResize('key', e)} />
              <ColHeader label="Value" col="value" {...sortProps} />
              <ColHeader label="Timestamp" col="timestamp" {...sortProps}
                onResizeStart={(e) => startColResize('timestamp', e)} />
            </div>
          )}

          {/* Message rows */}
          {!loading && !error && sorted.length > 0 && (
            <div className="flex-1 overflow-y-auto min-h-0">
              {sorted.map((msg) => {
                const isSelected = selectedMsg?.partition === msg.partition && selectedMsg?.offset === msg.offset;
                const ts = formatTs(msg.timestamp);
                return (
                  <button
                    key={`${msg.partition}-${msg.offset}`}
                    className={cn(
                      'w-full grid px-3 py-1.5 text-left border-b border-border/30 transition-colors border-l-2',
                      isSelected
                        ? 'bg-primary/10 border-l-primary'
                        : 'border-l-transparent hover:bg-muted/40',
                    )}
                    style={{ gridTemplateColumns: gridCols, gap: '0.5rem' }}
                    onClick={() => handleRowClick(msg)}
                  >
                    <span className="text-right text-xs text-muted-foreground tabular-nums font-mono">{msg.partition}</span>
                    <span className="text-xs font-mono text-muted-foreground tabular-nums">{msg.offset.toLocaleString()}</span>
                    <span className="text-xs font-mono truncate">
                      {msg.key !== null
                        ? msg.key
                        : <span className="italic text-muted-foreground/40">null</span>}
                    </span>
                    <span className="text-xs font-mono truncate text-foreground/80">
                      {msg.value !== null
                        ? msg.value
                        : <span className="italic text-muted-foreground/40">null</span>}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{ts}</span>
                  </button>
                );
              })}

              {/* Load more older messages */}
              {(hasMore || loadingMore) && (
                <div className="flex items-center justify-center py-3 border-t border-border/20">
                  {loadingMore ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                    </span>
                  ) : (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1 rounded hover:bg-muted/40"
                      onClick={loadMore}
                    >
                      Load older messages
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Resizable detail panel */}
        {selectedMsg && (
          <div
            className="shrink-0 flex min-h-0"
            style={{ width: detailWidth }}
          >
            {/* Drag handle on left edge */}
            <div
              className="w-1 shrink-0 cursor-col-resize border-l group hover:border-primary/50 transition-colors"
              onMouseDown={startDetailResize}
            >
              <div className="h-full w-full group-hover:bg-primary/10 transition-colors" />
            </div>

            {/* Panel content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <DetailPanel
                key={`${selectedMsg.partition}-${selectedMsg.offset}`}
                msg={selectedMsg}
                defaultValueMode={defaultValueMode}
                onClose={() => setSelectedMsg(null)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
