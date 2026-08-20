import { useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { cn } from '@/lib/utils';
import type { RedisConnection, RedisReply } from './types';
import { redisApi } from './types';

interface CliConsoleProps {
  conn: RedisConnection;
  db: number;
}

interface Entry {
  id: number;
  command: string;
  lines: string[];
  isError: boolean;
}

/** Splits a command line into tokens, respecting single/double-quoted values. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

function formatReply(r: RedisReply, indent = 0): string[] {
  const pad = '  '.repeat(indent);
  switch (r.kind) {
    case 'Nil': return [`${pad}(nil)`];
    case 'Int': return [`${pad}(integer) ${r.data}`];
    case 'Status': return [`${pad}${r.data}`];
    case 'Bulk': return [`${pad}"${r.data}"`];
    case 'Error': return [`${pad}(error) ${r.data}`];
    case 'Array':
      if (r.data.length === 0) return [`${pad}(empty array)`];
      return r.data.flatMap((item, i) => {
        const [first, ...rest] = formatReply(item, 0);
        return [`${pad}${i + 1}) ${first.trimStart()}`, ...rest.map((l) => `${pad}   ${l}`)];
      });
  }
}

let nextId = 1;

export function CliConsole({ conn, db }: CliConsoleProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histPos, setHistPos] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const run = async () => {
    const line = input.trim();
    if (!line || running) return;
    const args = tokenize(line);
    if (args.length === 0) return;
    setRunning(true);
    setInput('');
    setHistory((h) => [...h, line]);
    setHistPos(null);
    try {
      const reply = await redisApi.exec(conn.id, db, args);
      setEntries((prev) => [...prev, { id: nextId++, command: line, lines: formatReply(reply), isError: reply.kind === 'Error' }]);
    } catch (e) {
      setEntries((prev) => [...prev, { id: nextId++, command: line, lines: [String(e instanceof Error ? e.message : e)], isError: true }]);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { void run(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = histPos == null ? history.length - 1 : Math.max(0, histPos - 1);
      setHistPos(next);
      setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histPos == null) return;
      const next = histPos + 1;
      if (next >= history.length) { setHistPos(null); setInput(''); } else { setHistPos(next); setInput(history[next]); }
    }
  };

  return (
    <div className="tool-full-height">
      <ViewHeader icon={Terminal} title="CLI Console" subtitle={`db${db} · runs any Redis command`} />

      <div className="px-5 pt-3 shrink-0">
        <Callout tone="info" size="sm">
          Commands run against <span className="font-mono">db{db}</span> (use the DB selector to switch) — a typed <span className="font-mono">SELECT</span> here won't persist across commands.
        </Callout>
      </div>

      <div className="tool-scrollable px-5 py-3 font-mono text-xs space-y-3">
        {entries.map((e) => (
          <div key={e.id}>
            <div className="text-fg-mute">$ <span className="text-fg">{e.command}</span></div>
            <pre className={cn('whitespace-pre-wrap break-all mt-0.5', e.isError ? 'text-bad' : 'text-fg')}>{e.lines.join('\n')}</pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t px-5 py-2.5 flex items-center gap-2 font-mono text-xs">
        <span className="text-fg-mute">{'>'}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          placeholder="GET mykey"
          autoFocus
          className="flex-1 bg-transparent outline-none placeholder:text-fg-mute/50"
        />
      </div>
    </div>
  );
}
