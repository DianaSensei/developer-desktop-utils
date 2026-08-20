import { useMemo, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import { ViewHeader } from '@/components/ui/view-header';
import { Callout } from '@/components/ui/callout';
import { cn } from '@/lib/utils';
import type { RedisConnection, RedisReply } from './types';
import { redisApi } from './types';
import { REDIS_COMMANDS, type RedisCommandDef } from './commands';

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

const MAX_SUGGESTIONS = 8;

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
  const [suggestIndex, setSuggestIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Autocomplete only targets the command name (first token) — once a space
  // is typed the user has moved on to arguments, so the dropdown gives way
  // to the syntax hint below instead of getting in the way.
  const firstToken = input.trimStart().split(/\s+/, 1)[0] ?? '';
  // `trimStart` (not `trim`) so a trailing space — "GET " — still counts as
  // "past the command name": trimming both ends would swallow it and leave
  // the dropdown open (matching GET/GETSET/GETRANGE...) instead of switching
  // to the syntax hint for the now-complete command name.
  const hasSpace = /\s/.test(input.trimStart());
  const suggestions = useMemo<RedisCommandDef[]>(() => {
    if (hasSpace || firstToken.length === 0) return [];
    const q = firstToken.toUpperCase();
    return REDIS_COMMANDS
      .filter((c) => c.name.startsWith(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
  }, [hasSpace, firstToken]);
  const dropdownOpen = suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].name === firstToken.toUpperCase());
  const matchedCommand = useMemo(
    () => REDIS_COMMANDS.find((c) => c.name === firstToken.toUpperCase()),
    [firstToken],
  );

  const selectSuggestion = (c: RedisCommandDef) => {
    setInput(`${c.name} `);
    setSuggestIndex(null);
  };

  const runLine = async (line: string) => {
    const args = tokenize(line);
    if (args.length === 0) return;
    setHistory((h) => [...h, line]);
    try {
      const reply = await redisApi.exec(conn.id, db, args);
      setEntries((prev) => [...prev, { id: nextId++, command: line, lines: formatReply(reply), isError: reply.kind === 'Error' }]);
    } catch (e) {
      setEntries((prev) => [...prev, { id: nextId++, command: line, lines: [String(e instanceof Error ? e.message : e)], isError: true }]);
    }
  };

  const run = async () => {
    const line = input.trim();
    if (!line || running) return;
    setRunning(true);
    setInput('');
    setHistPos(null);
    try {
      await runLine(line);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    }
  };

  /** Runs several lines in order — backs pasting a small multi-command script. */
  const runMultiple = async (lines: string[]) => {
    if (running || lines.length === 0) return;
    setRunning(true);
    setInput('');
    setHistPos(null);
    try {
      for (const line of lines) await runLine(line);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return; // single line: let the default paste happen
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    void runMultiple(lines);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (dropdownOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((i) => (i == null ? 0 : Math.min(i + 1, suggestions.length - 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((i) => (i == null ? suggestions.length - 1 : Math.max(i - 1, 0)));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestIndex != null)) {
        e.preventDefault();
        selectSuggestion(suggestions[suggestIndex ?? 0]);
        return;
      }
    }
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
          Commands run against <span className="font-mono">db{db}</span> (use the DB selector to switch) — a typed <span className="font-mono">SELECT</span> here won't persist across commands. Paste multiple lines to run them in order.
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

      {dropdownOpen ? (
        <div className="shrink-0 border-t max-h-40 overflow-y-auto px-2 py-1.5">
          {suggestions.map((c, i) => (
            <button
              key={c.name}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(c); }}
              className={cn(
                'flex w-full items-baseline gap-2 rounded px-2.5 py-1 text-left transition-colors',
                i === suggestIndex ? 'bg-acc/10 text-acc' : 'hover:bg-bg-2/60',
              )}
            >
              <span className="font-mono text-xs font-semibold">{c.name}</span>
              <span className="text-[11px] text-fg-mute truncate">{c.summary}</span>
            </button>
          ))}
        </div>
      ) : matchedCommand && (
        <div className="shrink-0 border-t px-5 py-1.5 text-[11px] text-fg-mute font-mono truncate">
          {matchedCommand.syntax}
        </div>
      )}

      <div className="shrink-0 border-t px-5 py-2.5 flex items-center gap-2 font-mono text-xs">
        <span className="text-fg-mute">{'>'}</span>
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setSuggestIndex(null); }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={running}
          placeholder="GET mykey"
          autoFocus
          className="flex-1 bg-transparent outline-none placeholder:text-fg-mute/50"
        />
      </div>
    </div>
  );
}
