import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, CheckCircle2, Plus, Search, Trash2, NotebookPen, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { usePersistentState } from '@/hooks/usePersistentState';
import {
  buildMeetingMarkdown,
  formatDuration,
  meetingDurationMs,
  useMeetings,
  type Meeting,
} from '@/lib/meetings';
import { MeetingFields } from '@/components/meetings/MeetingFields';

type ViewMode = 'edit' | 'markdown' | 'preview';

function meetingMatches(m: Meeting, q: string): boolean {
  const hay = `${m.title} ${m.participants} ${m.agenda} ${m.decisions} ${m.actions}`.toLowerCase();
  return hay.includes(q);
}

function whenLabel(m: Meeting): string {
  const d = new Date(m.start);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function MeetingNotes() {
  const { meetings, addMeeting, updateMeeting, deleteMeeting, getMeeting } = useMeetings();
  const [selectedId, setSelectedId] = usePersistentState<string | null>('devtool:meeting:selected', null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = usePersistentState<ViewMode>('devtool:meeting:mode', 'edit');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const sorted = useMemo(
    () => [...meetings].sort((a, b) => b.start - a.start),
    [meetings],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((m) => meetingMatches(m, q)) : sorted;
  }, [sorted, query]);

  const selected = getMeeting(selectedId) ?? null;
  const markdown = useMemo(() => (selected ? buildMeetingMarkdown(selected) : ''), [selected]);

  const createNew = () => {
    const m = addMeeting();
    setSelectedId(m.id);
  };

  const copy = async () => {
    await copyToClipboard(markdown);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  const remove = (id: string) => {
    deleteMeeting(id);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div className="grid h-full grid-cols-1 overflow-hidden md:grid-cols-[260px_1fr]">
      {/* List pane */}
      <div className="flex min-h-0 flex-col border-r">
        <div className="shrink-0 space-y-2 border-b p-2.5">
          <Button onClick={createNew} size="sm" className="w-full gap-1.5">
            <Plus className="h-4 w-4" /> New note
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {meetings.length === 0 ? 'No meeting notes yet.' : 'No notes match your search.'}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={cn(
                    'group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    selectedId === m.id ? 'bg-foreground/10' : 'hover:bg-muted',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title.trim() || 'Untitled meeting'}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {whenLabel(m)} · {formatDuration(meetingDurationMs(m))}
                    </p>
                  </div>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); remove(m.id); }}
                    className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    title="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail pane — full-width editor with Edit / Markdown / Preview tabs */}
      {selected ? (
        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/10 px-4 py-2">
            <div className="inline-flex h-8 rounded-md border bg-muted/45 p-0.5">
              {(['edit', 'markdown', 'preview'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded px-3 text-xs font-medium capitalize transition-colors',
                    mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy markdown'}
              </button>
              <button
                type="button"
                onClick={() => remove(selected.id)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                title="Delete note"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {mode === 'edit' ? (
              <div className="mx-auto max-w-3xl p-5">
                <MeetingFields meeting={selected} onChange={(patch) => updateMeeting(selected.id, patch)} variant="page" />
              </div>
            ) : mode === 'markdown' ? (
              <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words p-5 font-mono text-sm">{markdown}</pre>
            ) : (
              <div className="prose prose-sm dark:prose-invert mx-auto max-w-3xl p-5">
                <ReactMarkdown>{markdown}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-card">
            <NotebookPen className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">
            Select a note to view and edit, or create a new one. Notes with a time appear in the Time Tracker calendar.
          </p>
          <Button onClick={createNew} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New note
          </Button>
        </div>
      )}
    </div>
  );
}
