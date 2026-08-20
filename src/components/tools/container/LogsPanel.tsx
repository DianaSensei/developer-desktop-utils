import { useEffect, useRef, useState } from 'react';
import { Channel } from '@tauri-apps/api/core';
import type { LogLine } from './types';

const MAX_LINES = 2000;

/**
 * Streaming log viewer shared by container logs and compose logs — both back
 * onto the same `LogLine { stream, message }` shape and the same
 * start(onLog)/stop(id) start-a-Channel/stop-by-id lifecycle.
 */
export function LogsPanel({ start, stop }: {
  start: (onLog: Channel<LogLine>) => Promise<string>;
  stop: (streamId: string) => Promise<void>;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  startRef.current = start;
  stopRef.current = stop;

  useEffect(() => {
    setLines([]);
    setError(null);
    let cancelled = false;
    let streamId: string | null = null;

    const channel = new Channel<LogLine>();
    channel.onmessage = (line) => {
      setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(prev.length - MAX_LINES + 1), line] : [...prev, line]));
    };

    startRef.current(channel)
      .then((id) => {
        if (cancelled) { stopRef.current(id).catch(() => {}); return; }
        streamId = id;
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));

    return () => {
      cancelled = true;
      if (streamId) stopRef.current(streamId).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto rounded-md bg-bg-2/30 p-2.5 font-mono text-[11px] leading-relaxed">
      {error && <p className="text-bad">{error}</p>}
      {!error && lines.length === 0 && <p className="text-fg-mute">Waiting for logs…</p>}
      {lines.map((l, i) => (
        <div key={i} className={l.stream === 'stderr' ? 'text-bad whitespace-pre-wrap break-all' : 'whitespace-pre-wrap break-all'}>
          {l.message}
        </div>
      ))}
    </div>
  );
}
