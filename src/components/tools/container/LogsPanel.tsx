import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { Search, Pause, Play, WrapText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LogLine } from './types';

const MAX_LINES = 2000;
const TAIL_OPTIONS = ['100', '500', '1000', '5000', 'all'] as const;

function toEpochSeconds(local: string): number {
  if (!local) return 0;
  const ms = new Date(local).getTime();
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
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
  const [sinceLocal, setSinceLocal] = useState('');
  const [untilLocal, setUntilLocal] = useState('');
  const [follow, setFollow] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [wrap, setWrap] = useState(true);

  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  const followRef = useRef(follow);
  startRef.current = start;
  stopRef.current = stop;
  followRef.current = follow;

  const since = useMemo(() => toEpochSeconds(sinceLocal), [sinceLocal]);
  const until = useMemo(() => toEpochSeconds(untilLocal), [untilLocal]);

  useEffect(() => {
    setLines([]);
    setError(null);
    let cancelled = false;
    let streamId: string | null = null;

    const channel = new Channel<LogLine>();
    channel.onmessage = (line) => {
      // Paused ("realtime" off) — keep the socket open but stop growing the
      // view, so flipping it back on resumes without losing scroll position
      // or re-fetching the tail.
      if (!followRef.current) return;
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
      if (streamId) stopRef.current(streamId).catch(() => {});
    };
  }, [tail, since, until]);

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
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search logs…"
            className="h-7 w-full rounded-sm border border-sunk bg-card pl-7 pr-7 text-xs placeholder:text-fg-mute focus:outline-none focus:border-acc/60 focus:ring-2 focus:ring-acc/35"
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
        <select
          value={tail}
          onChange={(e) => setTail(e.target.value)}
          title="Lines to load"
          className="h-7 rounded-sm border border-sunk bg-card px-1.5 text-[11px] focus:outline-none focus:border-acc/60 focus:ring-2 focus:ring-acc/35"
        >
          {TAIL_OPTIONS.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All lines' : `Last ${t}`}</option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={sinceLocal}
          onChange={(e) => setSinceLocal(e.target.value)}
          title="Only show logs since"
          className="h-7 rounded-sm border border-sunk bg-card px-1.5 text-[11px] text-fg-mute focus:outline-none focus:border-acc/60 focus:ring-2 focus:ring-acc/35"
        />
        <span className="text-[11px] text-fg-mute">–</span>
        <input
          type="datetime-local"
          value={untilLocal}
          onChange={(e) => setUntilLocal(e.target.value)}
          title="Only show logs until"
          className="h-7 rounded-sm border border-sunk bg-card px-1.5 text-[11px] text-fg-mute focus:outline-none focus:border-acc/60 focus:ring-2 focus:ring-acc/35"
        />
        <LogToggleButton
          active={follow}
          onClick={() => setFollow((f) => !f)}
          title={follow ? 'Live tailing — click to pause' : 'Paused — click to resume live tailing'}
        >
          {follow ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {follow ? 'Live' : 'Paused'}
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

function LogToggleButton({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border px-2 text-[11px] font-medium transition-colors',
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
