// Response viewer: status / time / size summary line plus Body and Headers
// tabs. JSON bodies are pretty-printed; the raw text is always copyable.

import { useMemo, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import type { ApiResponse, LogEntry, TestResult } from './types';
import { formatBytes, prettyBody, statusColor } from './request';
import { ResponseViewer } from './ResponseViewer';

interface Props {
  response: ApiResponse | null;
  sending: boolean;
  error: string | null;
  tests: TestResult[];
  logs: LogEntry[];
}

type Tab = 'body' | 'headers' | 'tests' | 'console';

export function ResponsePanel({ response, sending, error, tests, logs }: Props) {
  const [tab, setTab] = useState<Tab>('body');
  const [copied, setCopied] = useState(false);

  const pretty = useMemo(
    () => (response ? prettyBody(response.body, response.contentType) : ''),
    [response],
  );

  const failed = tests.filter((t) => !t.passed).length;

  const copy = async () => {
    await copyToClipboard(tab === 'body' ? pretty : (response?.headers ?? []).map(([k, v]) => `${k}: ${v}`).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
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
    return (
      <Centered>
        <p className="text-xs text-muted-foreground">Send a request to see the response.</p>
      </Centered>
    );
  }

  const TabBtn = ({ id, children, badge }: { id: Tab; children: React.ReactNode; badge?: React.ReactNode }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'relative -mb-px flex items-center gap-1 border-b-2 py-2 text-xs font-medium transition-colors',
        tab === id ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}{badge}
    </button>
  );

  const isJson = response ? /json/i.test(response.contentType) || /^\s*[[{]/.test(response.body) : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header: tabs left, status/meta right */}
      <div className="flex items-center gap-4 border-b px-3">
        <TabBtn id="body">Response</TabBtn>
        {response && <TabBtn id="headers" badge={<span className="text-[9px] text-muted-foreground">{response.headers.length}</span>}>Headers</TabBtn>}
        <TabBtn
          id="tests"
          badge={tests.length > 0 ? (
            <span className={cn('rounded px-1 text-[10px]', failed ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
              {tests.length - failed}/{tests.length}
            </span>
          ) : undefined}
        >Tests</TabBtn>
        <TabBtn id="console" badge={logs.length > 0 ? <span className="text-[9px] text-muted-foreground">{logs.length}</span> : undefined}>Console</TabBtn>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {response && isJson && (tab === 'body' || tab === 'headers') && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{'{ } JSON'}</span>
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
          {response && (tab === 'body' || tab === 'headers') && (
            <button onClick={copy} title="Copy" className="rounded p-1 text-muted-foreground hover:text-foreground">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
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
          response.body
            ? <div className="min-h-0 flex-1">{<ResponseViewer value={pretty} language={isJson ? 'json' : 'text'} />}</div>
            : <p className="p-3 text-xs text-muted-foreground">Empty response body.</p>
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
