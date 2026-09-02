import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Channel } from '@tauri-apps/api/core';
import {
  Search, Pause, Play, WrapText, X, Clock, Regex, CaseSensitive,
  ChevronUp, ChevronDown, ArrowDownToLine, Eraser, Download, AlertTriangle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { saveTextFile } from '@/components/tools/apiclient/fileio';
import { MOD_KEY } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { LogLine } from './types';

const MAX_LINES = 5000;
const TAIL_OPTIONS = ['100', '500', '1000', '5000', 'all'] as const;
/** Incoming lines are painted in batches on this cadence instead of one
 *  setState per line: a chatty container emits hundreds of lines a second, and
 *  a render per line locks the UI up (the search box stops accepting input).
 *  ~8 repaints a second still reads as live. */
const FLUSH_MS = 120;
/** How close to the bottom still counts as "at the bottom" — a few pixels of
 *  slack so sub-pixel scroll heights don't read as "user scrolled away". */
const BOTTOM_SLACK_PX = 24;

type StreamFilter = 'all' | 'stdout' | 'stderr';
/** Filter hides non-matching lines; highlight keeps them and steps between
 *  matches. Both are useful and neither replaces the other: filtering answers
 *  "how often does this happen", highlighting answers "what happened around
 *  it". */
type SearchMode = 'filter' | 'highlight';

function toEpochSeconds(ms: number | null): number {
  return ms === null ? 0 : Math.floor(ms / 1000);
}

/** `2026-08-26T09:41:02.123456789Z` → `09:41:02.123`. The date is dropped: on
 *  screen every line is almost always the same day, and the full value stays
 *  in the row's `title` and in a copy/save export. */
export function formatTimestamp(ts: string): string {
  const t = ts.indexOf('T');
  if (t === -1) return ts;
  const time = ts.slice(t + 1).replace('Z', '');
  const dot = time.indexOf('.');
  return dot === -1 ? time : time.slice(0, dot + 4);
}

/** One matcher for both plain and regex search, so every consumer (filtering,
 *  match counting, highlighting) agrees on what a match is. Returns null for
 *  an empty query, and throws only through `error` — never at render time. */
export function buildMatcher(query: string, regex: boolean, caseSensitive: boolean): {
  test: ((s: string) => boolean) | null;
  ranges: ((s: string) => [number, number][]) | null;
  error: string | null;
} {
  const q = query.trim();
  if (!q) return { test: null, ranges: null, error: null };

  if (regex) {
    try {
      const re = new RegExp(q, caseSensitive ? 'g' : 'gi');
      return {
        test: (s) => { re.lastIndex = 0; return re.test(s); },
        ranges: (s) => {
          const out: [number, number][] = [];
          re.lastIndex = 0;
          let m = re.exec(s);
          while (m) {
            // A zero-length match (e.g. `a*`) would loop forever — step past it.
            if (m[0].length === 0) { re.lastIndex++; m = re.exec(s); continue; }
            out.push([m.index, m.index + m[0].length]);
            m = re.exec(s);
          }
          return out;
        },
        error: null,
      };
    } catch (e) {
      return { test: null, ranges: null, error: e instanceof Error ? e.message : 'Invalid regular expression' };
    }
  }

  const needle = caseSensitive ? q : q.toLowerCase();
  const prep = (s: string) => (caseSensitive ? s : s.toLowerCase());
  return {
    test: (s) => prep(s).includes(needle),
    ranges: (s) => {
      const out: [number, number][] = [];
      const hay = prep(s);
      let i = hay.indexOf(needle);
      while (i !== -1) {
        out.push([i, i + needle.length]);
        i = hay.indexOf(needle, i + needle.length);
      }
      return out;
    },
    error: null,
  };
}

/**
 * Streaming log viewer shared by container logs and compose logs — both back
 * onto the same `LogLine { stream, message, timestamp }` shape and the same
 * start(tail, since, until, timestamps, onLog)/stop(id) start-a-Channel/
 * stop-by-id lifecycle.
 *
 * `tail`/`since`/`until`/`timestamps` are the daemon-side window: changing any
 * of them restarts the stream. Everything else — follow, stream filter,
 * search, wrap — is client-side, so the socket keeps running and toggling
 * them back never loses history or re-fetches.
 */
export function LogsPanel({ start, stop, name }: {
  start: (tail: string, since: number, until: number, timestamps: boolean, onLog: Channel<LogLine>) => Promise<string>;
  stop: (streamId: string) => Promise<void>;
  /** Used for the exported file name — e.g. `api-1` → `api-1-logs.log`. */
  name?: string;
}) {
  const [tail, setTail] = useState<string>('500');
  // Mốc thời gian giữ ở epoch-ms | null (null = không giới hạn) thay cho chuỗi
  // "yyyy-MM-ddTHH:mm" của <input type="datetime-local"> đã bỏ — xem khối
  // picker bên dưới.
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  const [untilMs, setUntilMs] = useState<number | null>(null);
  const [timestamps, setTimestamps] = useState(false);
  const [follow, setFollow] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('filter');
  const [streamFilter, setStreamFilter] = useState<StreamFilter>('all');
  const [wrap, setWrap] = useState(true);

  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  /** Set once the buffer has wrapped, so the cap is stated rather than silent. */
  const [truncated, setTruncated] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [activeMatch, setActiveMatch] = useState(0);

  // Dòng log đến trong lúc TẠM DỪNG. Bản trước vứt thẳng chúng đi ("stop
  // growing the view"), nên khoảng thời gian người dùng dừng lại để ĐỌC chính
  // là khoảng bị mất log vĩnh viễn — không có dấu hiệu nào báo là đã hổng, và
  // socket vẫn chạy nên bấm Live lại cũng không kéo về được. Giờ đệm lại rồi
  // xả ra khi tiếp tục; `pendingCount` để nút Paused nói rõ đang giữ bao nhiêu.
  const pendingRef = useRef<LogLine[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  /** Lines received since the last paint — flushed on the FLUSH_MS tick. */
  const incomingRef = useRef<LogLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  const followRef = useRef(follow);
  startRef.current = start;
  stopRef.current = stop;
  followRef.current = follow;

  const since = useMemo(() => toEpochSeconds(sinceMs), [sinceMs]);
  const until = useMemo(() => toEpochSeconds(untilMs), [untilMs]);

  const appendCapped = useCallback((prev: LogLine[], incoming: LogLine[]): LogLine[] => {
    const next = prev.length === 0 ? incoming : [...prev, ...incoming];
    if (next.length <= MAX_LINES) return next;
    setTruncated(true);
    return next.slice(next.length - MAX_LINES);
  }, []);

  useEffect(() => {
    setLines([]);
    setError(null);
    setConnecting(true);
    setTruncated(false);
    incomingRef.current = [];
    let cancelled = false;
    let streamId: string | null = null;

    const channel = new Channel<LogLine>();
    channel.onmessage = (line) => {
      // Tạm dừng: giữ socket mở và đệm dòng mới lại (cắt theo cùng trần
      // MAX_LINES để việc dừng lâu không phình bộ nhớ), thay vì loại bỏ.
      if (!followRef.current) {
        pendingRef.current = pendingRef.current.length >= MAX_LINES
          ? [...pendingRef.current.slice(pendingRef.current.length - MAX_LINES + 1), line]
          : [...pendingRef.current, line];
        setPendingCount(pendingRef.current.length);
        return;
      }
      incomingRef.current.push(line);
    };

    // One repaint per tick, however many lines arrived in between.
    const flush = window.setInterval(() => {
      if (incomingRef.current.length === 0) return;
      const batch = incomingRef.current;
      incomingRef.current = [];
      setConnecting(false);
      setLines((prev) => appendCapped(prev, batch));
    }, FLUSH_MS);

    startRef.current(tail, since, until, timestamps, channel)
      .then((id) => {
        if (cancelled) { stopRef.current(id).catch(() => {}); return; }
        streamId = id;
        // A container that is simply quiet never sends a first line; stop
        // showing "Connecting…" once the stream itself is established.
        setConnecting(false);
      })
      .catch((e) => { setConnecting(false); setError(String(e instanceof Error ? e.message : e)); });

    return () => {
      cancelled = true;
      window.clearInterval(flush);
      // Đổi cửa sổ tail/since/until là nạp lại từ đầu — đệm cũ thuộc về stream
      // trước, giữ lại chỉ tạo ra một khoảng lẫn lộn giữa hai lần truy vấn.
      pendingRef.current = [];
      incomingRef.current = [];
      setPendingCount(0);
      if (streamId) stopRef.current(streamId).catch(() => {});
    };
  }, [tail, since, until, timestamps, appendCapped]);

  // Tiếp tục chạy → xả đệm vào view theo đúng thứ tự đã đến.
  useEffect(() => {
    if (!follow || pendingRef.current.length === 0) return;
    const buffered = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    setLines((prev) => appendCapped(prev, buffered));
  }, [follow, appendCapped]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (follow && atBottom) scrollToBottom();
  }, [lines, follow, atBottom, scrollToBottom]);

  /** Scrolling up while live pauses the tail — otherwise the next batch yanks
   *  the viewport back down and the line being read is gone. Scrolling back to
   *  the bottom resumes it, so no button press is needed either way. */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    setAtBottom(bottom);
    if (!bottom && followRef.current) setFollow(false);
  };

  const matcher = useMemo(() => buildMatcher(keyword, regex, caseSensitive), [keyword, regex, caseSensitive]);
  const searchError = matcher.error;

  const streamFiltered = useMemo(
    () => (streamFilter === 'all' ? lines : lines.filter((l) => l.stream === streamFilter)),
    [lines, streamFilter],
  );

  /** Rows actually rendered, plus which of them match — filter mode drops the
   *  rest, highlight mode keeps them and only marks the matches. */
  const { rows, matchIndexes } = useMemo(() => {
    if (!matcher.test) return { rows: streamFiltered, matchIndexes: [] as number[] };
    if (searchMode === 'filter') {
      const kept = streamFiltered.filter((l) => matcher.test!(l.message));
      return { rows: kept, matchIndexes: kept.map((_, i) => i) };
    }
    const idx: number[] = [];
    streamFiltered.forEach((l, i) => { if (matcher.test!(l.message)) idx.push(i); });
    return { rows: streamFiltered, matchIndexes: idx };
  }, [streamFiltered, matcher, searchMode]);

  // Keep the active match in range as lines stream in or the query changes.
  useEffect(() => { setActiveMatch(0); }, [keyword, regex, caseSensitive, searchMode, streamFilter]);

  const stepMatch = (delta: number) => {
    // Only meaningful while every line is on screen — in filter mode the rows
    // ARE the matches, so stepping would just scroll for no reason.
    if (searchMode !== 'highlight' || matchIndexes.length === 0) return;
    const next = (activeMatch + delta + matchIndexes.length) % matchIndexes.length;
    setActiveMatch(next);
    setFollow(false);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${matchIndexes[next]}"]`);
    el?.scrollIntoView({ block: 'center' });
  };

  /** Exactly what is on screen, with the timestamps if they're shown — a copy
   *  that silently dropped the filters would be worse than useless. */
  const exportText = useCallback(
    () => rows.map((l) => (l.timestamp ? `${l.timestamp} ${l.message}` : l.message)).join('\n'),
    [rows],
  );

  // ⌘/Ctrl+F focuses the panel's own search rather than the webview's find
  // bar, which cannot see virtualised or filtered-out lines anyway.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        if (!rootRef.current?.isConnected) return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasWindow = sinceMs !== null || untilMs !== null;

  return (
    <div ref={rootRef} className="flex flex-1 min-h-0 flex-col gap-2">
      {/* Row 1 — search and everything that acts on what is already loaded. */}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-mute" />
          <Input
            ref={searchRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setKeyword(''); e.currentTarget.blur(); }
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
            }}
            placeholder={`Search logs…  ${MOD_KEY}F`}
            aria-label="Search logs"
            aria-invalid={!!searchError}
            className={cn('h-ctl w-full pl-7 pr-7 text-xs', searchError && 'border-bad focus-visible:border-bad focus-visible:ring-bad/30')}
          />
          {keyword && (
            <button
              type="button"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => setKeyword('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-mute transition-colors hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <LogToggleButton active={regex} onClick={() => setRegex((r) => !r)} title={regex ? 'Regular expression: on' : 'Regular expression: off'}>
          <Regex className="h-3.5 w-3.5" />
        </LogToggleButton>
        <LogToggleButton
          active={caseSensitive}
          onClick={() => setCaseSensitive((c) => !c)}
          title={caseSensitive ? 'Case sensitive: on' : 'Case sensitive: off'}
        >
          <CaseSensitive className="h-3.5 w-3.5" />
        </LogToggleButton>
        <LogToggleButton
          active={searchMode === 'highlight'}
          onClick={() => setSearchMode((m) => (m === 'filter' ? 'highlight' : 'filter'))}
          title={searchMode === 'filter'
            ? 'Filtering to matching lines — click to keep every line and just highlight matches'
            : 'Highlighting matches in place — click to hide non-matching lines'}
        >
          {searchMode === 'filter' ? 'Filter' : 'Highlight'}
        </LogToggleButton>

        {matchIndexes.length > 0 && keyword && searchMode === 'highlight' && (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            <IconStep title="Previous match" onClick={() => stepMatch(-1)}><ChevronUp className="h-3.5 w-3.5" /></IconStep>
            <span className="px-1 text-[11px] tabular-nums text-fg-mute">
              {activeMatch + 1}/{matchIndexes.length.toLocaleString()}
            </span>
            <IconStep title="Next match" onClick={() => stepMatch(1)}><ChevronDown className="h-3.5 w-3.5" /></IconStep>
          </span>
        )}
      </div>

      {/* Row 2 — the daemon-side window (restarts the stream) and view options. */}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <Select value={streamFilter} onValueChange={(v) => setStreamFilter(v as StreamFilter)}>
          <SelectTrigger className="h-ctl w-[104px] shrink-0 px-2 text-[11px]" title="Which stream to show" aria-label="Which stream to show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Both streams</SelectItem>
            <SelectItem value="stdout" className="text-xs">stdout only</SelectItem>
            <SelectItem value="stderr" className="text-xs">stderr only</SelectItem>
          </SelectContent>
        </Select>

        {/* Ba control này từng là <select> và hai <input type="datetime-local">
            gốc của trình duyệt — thứ mà docs/design/DESIGN-SYSTEM.md cấm hẳn:
            chúng vẽ khác nhau hoàn toàn giữa WKWebView (macOS), WebView2
            (Windows) và WebKitGTK (Linux) — riêng WebKitGTK còn không dựng nổi
            lịch cho datetime-local, để lại một ô chữ trống người dùng phải tự
            gõ đúng định dạng. Repo đã sẵn Select/DatePicker/TimePicker viết ra
            đúng để thay chúng; đây là chỗ duy nhất còn sót. */}
        <Select value={tail} onValueChange={setTail}>
          <SelectTrigger className="h-ctl w-[110px] shrink-0 px-2 text-[11px]" title="Lines to load" aria-label="Lines to load">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAIL_OPTIONS.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t === 'all' ? 'All lines' : `Last ${t}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LogTimeBound label="Only show logs since" value={sinceMs} onChange={setSinceMs} />
        <span className="text-[11px] text-fg-mute">–</span>
        <LogTimeBound label="Only show logs until" value={untilMs} onChange={setUntilMs} />

        <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />

        <LogToggleButton
          active={follow}
          onClick={() => { setFollow((f) => !f); if (!follow) scrollToBottom(); }}
          title={follow
            ? 'Live tailing — click to pause'
            : `Paused — ${pendingCount.toLocaleString()} new line(s) held, click to resume and show them`}
        >
          {follow ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {follow ? 'Live' : pendingCount > 0 ? `Paused · ${pendingCount.toLocaleString()} held` : 'Paused'}
        </LogToggleButton>
        <LogToggleButton
          active={timestamps}
          onClick={() => setTimestamps((t) => !t)}
          title={timestamps ? 'Timestamps: on — click to hide (reloads)' : 'Timestamps: off — click to show (reloads)'}
        >
          <Clock className="h-3.5 w-3.5" />
        </LogToggleButton>
        <LogToggleButton active={wrap} onClick={() => setWrap((w) => !w)} title={wrap ? 'Wrap long lines: on' : 'Wrap long lines: off'}>
          <WrapText className="h-3.5 w-3.5" />
        </LogToggleButton>

        <span className="ml-auto inline-flex items-center gap-1.5">
          <CopyButton
            value={exportText}
            variant="outline"
            size="sm"
            className="h-ctl text-[11px]"
            label="Copy"
            title="Copy the lines currently shown"
          />
          <LogToggleButton
            active={false}
            onClick={() => void saveTextFile(`${name ?? 'container'}-logs.log`, exportText())}
            title="Save the lines currently shown to a file"
          >
            <Download className="h-3.5 w-3.5" /> Save
          </LogToggleButton>
          <LogToggleButton
            active={false}
            onClick={() => { setLines([]); setTruncated(false); }}
            title="Clear the view — the stream keeps running"
          >
            <Eraser className="h-3.5 w-3.5" />
          </LogToggleButton>
        </span>
      </div>

      <div className="flex min-h-[16px] shrink-0 flex-wrap items-center gap-x-3 text-[11px] text-fg-mute">
        {searchError ? (
          <span className="inline-flex items-center gap-1 text-bad">
            <AlertTriangle className="h-3 w-3" /> {searchError}
          </span>
        ) : keyword ? (
          <span>
            {searchMode === 'filter'
              ? `${rows.length.toLocaleString()} of ${streamFiltered.length.toLocaleString()} lines match`
              : `${matchIndexes.length.toLocaleString()} matching line(s)`}
          </span>
        ) : (
          <span>{streamFiltered.length.toLocaleString()} line(s)</span>
        )}
        {truncated && <span title={`Only the most recent ${MAX_LINES.toLocaleString()} lines are kept in view`}>buffer capped at {MAX_LINES.toLocaleString()}</span>}
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="log"
          aria-label="Container logs"
          className={cn(
            'h-full overflow-y-auto rounded-md bg-bg-2/30 p-2.5 font-mono text-[11px] leading-relaxed',
            !wrap && 'overflow-x-auto',
          )}
        >
          {error && <p className="text-bad">{error}</p>}
          {!error && connecting && rows.length === 0 && (
            <p className="flex items-center gap-2 text-fg-mute"><Spinner size="sm" /> Connecting to the log stream…</p>
          )}
          {!error && !connecting && rows.length === 0 && (
            <p className="text-fg-mute">
              {keyword
                ? 'No lines match this search.'
                : streamFilter !== 'all'
                  ? `Nothing on ${streamFilter} in this window.`
                  : hasWindow
                    ? 'No logs in this time range — widen "since"/"until" to see more.'
                    : 'No output yet — new lines appear here as the container writes them.'}
            </p>
          )}
          {rows.map((l, i) => (
            <div
              key={i}
              data-row={i}
              title={l.timestamp ?? undefined}
              className={cn(
                'flex gap-2 rounded-sm px-1 -mx-1 hover:bg-acc/5',
                l.stream === 'stderr' && 'border-l-2 border-bad/60 pl-1.5 -ml-1.5',
                searchMode === 'highlight' && matchIndexes[activeMatch] === i && 'bg-acc/10',
              )}
            >
              {l.timestamp && (
                <span className="shrink-0 select-none tabular-nums text-fg-faint">{formatTimestamp(l.timestamp)}</span>
              )}
              <span className={cn('min-w-0', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre', l.stream === 'stderr' && 'text-bad')}>
                {highlightMatch(l.message, matcher.ranges)}
              </span>
            </div>
          ))}
        </div>

        {/* Only offered when it does something: the view is scrolled away from
            the newest line. Doubles as the "you are not seeing live output"
            indicator, which the Paused button alone did not make obvious. */}
        {!atBottom && (
          <button
            type="button"
            onClick={() => { setFollow(true); setAtBottom(true); scrollToBottom(); }}
            className={cn(
              'absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full',
              'border border-acc/40 bg-card/95 px-3 py-1 text-[11px] font-medium shadow-lg backdrop-blur-xs',
              'animate-in fade-in-0 slide-in-from-bottom-1 duration-fast ease-out-soft hover:bg-acc/10',
            )}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Jump to latest{pendingCount > 0 ? ` · ${pendingCount.toLocaleString()} new` : ''}
          </button>
        )}
      </div>
    </div>
  );
}

/** Một mốc thời gian tuỳ chọn: chưa đặt thì chỉ là nút "Set…", đặt rồi thì hiện
 *  bộ chọn ngày+giờ kèm nút xoá để quay lại "không giới hạn". `DateTimePicker`
 *  bắt buộc có giá trị (epoch ms), nên trạng thái "chưa đặt" phải nằm ở đây. */
function LogTimeBound({ label, value, onChange }: {
  label: string; value: number | null; onChange: (ms: number | null) => void;
}) {
  if (value === null) {
    return (
      <LogToggleButton
        active={false}
        // Mặc định về đầu giờ hiện tại — mốc tròn, gần như luôn là thứ người
        // dùng muốn tinh chỉnh từ đó, thay vì giây hiện tại lẻ loi.
        onClick={() => { const d = new Date(); d.setMinutes(0, 0, 0); onChange(d.getTime()); }}
        title={label}
      >
        {label.includes('since') ? 'Since…' : 'Until…'}
      </LogToggleButton>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={label}>
      <DateTimePicker value={value} onChange={onChange} />
      <button
        type="button"
        title={`Clear — ${label.toLowerCase()}`}
        aria-label={`Clear — ${label.toLowerCase()}`}
        onClick={() => onChange(null)}
        className="text-fg-mute transition-colors hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function IconStep({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-mute transition-colors hover:bg-acc/10 hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/35"
    >
      {children}
    </button>
  );
}

function LogToggleButton({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-ctl shrink-0 items-center gap-1 rounded-sm border px-2 text-[11px] font-medium transition-colors duration-fast ease-out-soft',
        'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:ring-offset-bg',
        active
          ? 'border-acc/40 bg-acc/10 text-acc'
          : 'border-line/70 text-fg-mute hover:border-line hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

// Wraps each match in <mark> so it's visible against the monospace log
// background without re-coloring the whole line. Ranges come from the shared
// matcher, so plain and regex search highlight identically.
function highlightMatch(message: string, ranges: ((s: string) => [number, number][]) | null): ReactNode {
  if (!ranges) return message;
  const found = ranges(message);
  if (found.length === 0) return message;
  const parts: ReactNode[] = [];
  let i = 0;
  for (const [from, to] of found) {
    if (from > i) parts.push(message.slice(i, from));
    parts.push(<mark key={from} className="rounded-sm bg-warn/40 text-fg">{message.slice(from, to)}</mark>);
    i = to;
  }
  if (i < message.length) parts.push(message.slice(i));
  return parts;
}
