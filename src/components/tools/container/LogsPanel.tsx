import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { Search, Pause, Play, WrapText, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { cn } from '@/lib/utils';
import type { LogLine } from './types';

const MAX_LINES = 2000;
const TAIL_OPTIONS = ['100', '500', '1000', '5000', 'all'] as const;

function toEpochSeconds(ms: number | null): number {
  return ms === null ? 0 : Math.floor(ms / 1000);
}

/**
 * Streaming log viewer shared by container logs and compose logs — both back
 * onto the same `LogLine { stream, message }` shape and the same
 * start(tail, since, until, onLog)/stop(id) start-a-Channel/stop-by-id
 * lifecycle. `tail`/`since`/`until` are the daemon-side window (changing any
 * of them restarts the stream); `follow` and the keyword search are purely
 * client-side — the socket keeps running so toggling them back on never
 * loses history or re-fetches.
 */
export function LogsPanel({ start, stop }: {
  start: (tail: string, since: number, until: number, onLog: Channel<LogLine>) => Promise<string>;
  stop: (streamId: string) => Promise<void>;
}) {
  const [tail, setTail] = useState<string>('500');
  // Mốc thời gian giữ ở epoch-ms | null (null = không giới hạn) thay cho chuỗi
  // "yyyy-MM-ddTHH:mm" của <input type="datetime-local"> đã bỏ — xem khối
  // picker bên dưới.
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  const [untilMs, setUntilMs] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [wrap, setWrap] = useState(true);

  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Dòng log đến trong lúc TẠM DỪNG. Bản trước vứt thẳng chúng đi ("stop
  // growing the view"), nên khoảng thời gian người dùng dừng lại để ĐỌC chính
  // là khoảng bị mất log vĩnh viễn — không có dấu hiệu nào báo là đã hổng, và
  // socket vẫn chạy nên bấm Live lại cũng không kéo về được. Giờ đệm lại rồi
  // xả ra khi tiếp tục; `pendingCount` để nút Paused nói rõ đang giữ bao nhiêu.
  const pendingRef = useRef<LogLine[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  const followRef = useRef(follow);
  startRef.current = start;
  stopRef.current = stop;
  followRef.current = follow;

  const since = useMemo(() => toEpochSeconds(sinceMs), [sinceMs]);
  const until = useMemo(() => toEpochSeconds(untilMs), [untilMs]);

  useEffect(() => {
    setLines([]);
    setError(null);
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
      setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(prev.length - MAX_LINES + 1), line] : [...prev, line]));
    };

    startRef.current(tail, since, until, channel)
      .then((id) => {
        if (cancelled) { stopRef.current(id).catch(() => {}); return; }
        streamId = id;
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));

    return () => {
      cancelled = true;
      // Đổi cửa sổ tail/since/until là nạp lại từ đầu — đệm cũ thuộc về stream
      // trước, giữ lại chỉ tạo ra một khoảng lẫn lộn giữa hai lần truy vấn.
      pendingRef.current = [];
      setPendingCount(0);
      if (streamId) stopRef.current(streamId).catch(() => {});
    };
  }, [tail, since, until]);

  // Tiếp tục chạy → xả đệm vào view theo đúng thứ tự đã đến.
  useEffect(() => {
    if (!follow || pendingRef.current.length === 0) return;
    const buffered = pendingRef.current;
    pendingRef.current = [];
    setPendingCount(0);
    setLines((prev) => {
      const next = [...prev, ...buffered];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, [follow]);

  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const kw = keyword.trim().toLowerCase();
  const filtered = useMemo(
    () => (kw ? lines.filter((l) => l.message.toLowerCase().includes(kw)) : lines),
    [lines, kw],
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-mute" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search logs…"
            aria-label="Search logs"
            className="h-ctl w-full pl-7 pr-7 text-xs"
          />
          {keyword && (
            <button
              type="button"
              title="Clear search"
              onClick={() => setKeyword('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-mute hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
        <LogToggleButton
          active={follow}
          onClick={() => setFollow((f) => !f)}
          title={follow
            ? 'Live tailing — click to pause'
            : `Paused — ${pendingCount.toLocaleString()} new line(s) held, click to resume and show them`}
        >
          {follow ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {follow ? 'Live' : pendingCount > 0 ? `Paused · ${pendingCount.toLocaleString()} held` : 'Paused'}
        </LogToggleButton>
        <LogToggleButton active={wrap} onClick={() => setWrap((w) => !w)} title={wrap ? 'Wrap: on — click to disable' : 'Wrap: off — click to enable'}>
          <WrapText className="h-3.5 w-3.5" />
        </LogToggleButton>
      </div>

      {kw && (
        <p className="text-[11px] text-fg-mute shrink-0">
          {filtered.length.toLocaleString()} of {lines.length.toLocaleString()} lines match
        </p>
      )}

      <div
        ref={scrollRef}
        className={cn(
          'flex-1 min-h-0 overflow-y-auto rounded-md bg-bg-2/30 p-2.5 font-mono text-[11px] leading-relaxed',
          !wrap && 'overflow-x-auto',
        )}
      >
        {error && <p className="text-bad">{error}</p>}
        {!error && filtered.length === 0 && (
          <p className="text-fg-mute">{kw ? 'No matching lines.' : 'Waiting for logs…'}</p>
        )}
        {filtered.map((l, i) => (
          <div
            key={i}
            className={cn(
              wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
              l.stream === 'stderr' && 'text-bad',
            )}
          >
            {highlightMatch(l.message, kw)}
          </div>
        ))}
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

function LogToggleButton({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-ctl shrink-0 items-center gap-1 rounded-sm border px-2 text-[11px] font-medium transition-colors duration-fast ease-out-soft',
        active ? 'border-acc/40 bg-acc/10 text-acc' : 'border-sunk text-fg-mute hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

// Wraps each case-insensitive match of `kw` in <mark> so it's visible against
// the monospace log background without re-coloring the whole line.
function highlightMatch(message: string, kw: string): ReactNode {
  if (!kw) return message;
  const lower = message.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(kw);
  while (idx !== -1) {
    if (idx > i) parts.push(message.slice(i, idx));
    parts.push(<mark key={idx} className="rounded-sm bg-warn/40 text-fg">{message.slice(idx, idx + kw.length)}</mark>);
    i = idx + kw.length;
    idx = lower.indexOf(kw, i);
  }
  if (i < message.length) parts.push(message.slice(i));
  return parts;
}
