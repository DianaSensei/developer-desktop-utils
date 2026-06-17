import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2, Plus, ChevronRight, Coffee, Timer as TimerIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useClockify, type TimeEntry } from './store';
import { BillableButton, ColorDot, ConfirmButton, ProjectPicker, TagPicker } from './ui';
import {
  dayStart,
  fmtTimer,
  fmtTotal,
  parseDateInput,
  parseDuration,
  parseTimeOfDay,
  pomodoroPhase,
  playBeep,
  shortDate,
  timeOfDay,
  toDateInput,
  weekStart,
} from './time';

type Period = 'day' | 'week' | 'month' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
];

function periodStart(now: number, period: Period, mondayStart: boolean): number | null {
  if (period === 'all') return null;
  if (period === 'day') return dayStart(now);
  if (period === 'week') return weekStart(now, mondayStart);
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Editable HH:MM(:SS) cell bound to a single timestamp on a fixed day.
function EditableTime({ ts, dayTs, onCommit }: { ts: number; dayTs: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? timeOfDay(ts, false);
  return (
    <Input
      value={value}
      onFocus={() => setDraft(timeOfDay(ts, false))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const parsed = parseTimeOfDay(draft, dayTs);
          if (parsed !== null) onCommit(parsed);
        }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="h-7 w-[64px] text-center font-mono text-xs tabular-nums"
    />
  );
}

// One time record (history line) inside a task.
function HistoryRow({ entry }: { entry: TimeEntry }) {
  const { now, updateEntry, deleteEntry } = useClockify();
  const running = entry.end === null;
  const day = dayStart(entry.start);
  const duration = (entry.end ?? now) - entry.start;
  return (
    <div className="flex items-center gap-2 py-1.5 pl-9 pr-3 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{shortDate(entry.start)}</span>
      <div className="flex items-center gap-1">
        <EditableTime ts={entry.start} dayTs={day} onCommit={(v) => updateEntry(entry.id, { start: Math.min(v, entry.end ?? Date.now()) })} />
        <span className="text-muted-foreground">–</span>
        {running ? (
          <span className="w-[64px] text-center text-red-500">now</span>
        ) : (
          <EditableTime ts={entry.end!} dayTs={day} onCommit={(v) => updateEntry(entry.id, { end: Math.max(v, entry.start) })} />
        )}
      </div>
      <span className={cn('ml-auto w-16 text-right font-mono tabular-nums', running && 'text-red-500')}>{fmtTimer(duration)}</span>
      <ConfirmButton onConfirm={() => deleteEntry(entry.id)} title="Delete record" className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted">
        <Trash2 className="h-3 w-3" />
      </ConfirmButton>
    </div>
  );
}

export function TimeTracker() {
  const { entries, running, now, settings, startEntry, stopRunning, addEntry, projectById } = useClockify();

  // entry-bar draft
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');

  // manual-entry fields
  const [manualDate, setManualDate] = useState(() => toDateInput(now));
  const [manualKind, setManualKind] = useState<'range' | 'duration'>('range');
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('10:00');
  const [manualDuration, setManualDuration] = useState('1:00');

  const [period, setPeriod] = useState<Period>('week');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useQuickPaste(setDesc, mode === 'timer' && !running);

  const hasTitle = desc.trim().length > 0;
  const descRef = useRef<HTMLInputElement>(null);

  const ps = periodStart(now, period, settings.weekStartsMon);

  // Group time records into unique tasks keyed by (case-insensitive) name.
  const groups = useMemo(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const key = (e.description.trim() || 'Untitled').toLowerCase();
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    const out = [...m.entries()].map(([key, recs]) => {
      const sorted = recs.slice().sort((a, b) => b.start - a.start);
      return {
        key,
        name: sorted[0].description.trim() || 'Untitled',
        projectId: sorted.find((r) => r.projectId)?.projectId ?? null,
        tagIds: sorted[0].tagIds,
        billable: sorted[0].billable,
        recs: sorted,
        lastStart: sorted[0].start,
        totalAll: recs.reduce((s, e) => s + ((e.end ?? now) - e.start), 0),
        totalPeriod: ps == null ? 0 : recs.filter((e) => e.start >= ps).reduce((s, e) => s + ((e.end ?? now) - e.start), 0),
      };
    });
    out.sort((a, b) => b.lastStart - a.lastStart);
    return out;
  }, [entries, now, ps]);

  // When a name matches an existing task, inherit its project/tags if unset.
  const inherit = (name: string) => {
    const g = groups.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    return {
      projectId: projectId ?? g?.projectId ?? null,
      tagIds: tagIds.length ? tagIds : g?.tagIds ?? [],
      billable: billable || (g?.billable ?? false),
    };
  };

  const start = () => {
    if (!hasTitle) { descRef.current?.focus(); return; }
    const inh = inherit(desc);
    startEntry({ description: desc.trim(), projectId: inh.projectId, taskId, tagIds: inh.tagIds, billable: inh.billable });
  };

  const resumeTask = (name: string, pid: string | null, tags: string[], bill: boolean) => {
    startEntry({ description: name, projectId: pid, taskId: null, tagIds: tags, billable: bill });
  };

  const addManual = () => {
    if (!hasTitle) { descRef.current?.focus(); return; }
    const day = parseDateInput(manualDate);
    if (day === null) return;
    let s: number | null;
    let e: number | null;
    if (manualKind === 'range') {
      s = parseTimeOfDay(manualStart, day);
      e = parseTimeOfDay(manualEnd, day);
      if (s === null || e === null || e <= s) return;
    } else {
      const dur = parseDuration(manualDuration);
      if (dur === null || dur <= 0) return;
      s = parseTimeOfDay(settings.workStart || '09:00', day) ?? day + 9 * 3600_000;
      e = s + dur;
    }
    const inh = inherit(desc);
    addEntry({ description: desc.trim(), projectId: inh.projectId, taskId, tagIds: inh.tagIds, billable: inh.billable, start: s, end: e, source: 'manual' });
  };

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // pomodoro indicator for the running entry
  const pomo = useMemo(() => {
    if (!settings.pomodoro || !running) return null;
    return pomodoroPhase(now - running.start, settings.workMinutes, settings.breakMinutes);
  }, [settings.pomodoro, settings.workMinutes, settings.breakMinutes, running, now]);

  const lastPhase = useRef<boolean | null>(null);
  useEffect(() => {
    if (!pomo) { lastPhase.current = null; return; }
    if (lastPhase.current !== null && lastPhase.current !== pomo.onBreak && settings.sound) playBeep();
    lastPhase.current = pomo.onBreak;
  }, [pomo, settings.sound]);

  const visibleGroups = period === 'all' ? groups : groups.filter((g) => g.totalPeriod > 0 || g.recs.some((r) => r.end === null));
  const periodTotal = visibleGroups.reduce((s, g) => s + (period === 'all' ? g.totalAll : g.totalPeriod), 0);

  return (
    <div className="flex h-full flex-col">
      {/* Entry bar */}
      <div className={cn('shrink-0 border-b p-3 transition-colors', pomo?.onBreak && 'bg-emerald-500/5')}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={descRef}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mode === 'timer' && !running && start()}
            placeholder={`Task name — ${quickPasteHint}`}
            className="h-10 min-w-[180px] flex-1 text-sm"
          />
          <ProjectPicker value={projectId} taskValue={taskId} onChange={(p, t) => { setProjectId(p); setTaskId(t); }} />
          <TagPicker value={tagIds} onChange={setTagIds} />
          <BillableButton value={billable} onChange={setBillable} />

          <div className="flex rounded-md border p-0.5">
            {(['timer', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn('rounded px-2 py-1 text-xs font-medium capitalize transition-colors', mode === m ? 'bg-foreground/10' : 'text-muted-foreground hover:text-foreground')}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === 'timer' ? (
            <>
              <span className={cn('w-24 text-center font-mono text-lg font-semibold tabular-nums', running && 'text-red-500')}>
                {fmtTimer(running ? now - running.start : 0)}
              </span>
              {running ? (
                <Button size="lg" variant="destructive" className="gap-2" onClick={stopRunning}>
                  <Square className="h-4 w-4 fill-current" /> Stop
                </Button>
              ) : (
                <Button size="lg" className="gap-2" onClick={start} disabled={!hasTitle} title={hasTitle ? undefined : 'Enter a task name to start'}>
                  <Play className="h-4 w-4" /> Start
                </Button>
              )}
            </>
          ) : null}
        </div>

        {/* Manual entry row */}
        {mode === 'manual' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Input
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="h-9 w-[150px] text-xs [color-scheme:light] dark:[color-scheme:dark]"
            />
            <div className="flex rounded-md border p-0.5">
              {(['range', 'duration'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setManualKind(k)}
                  className={cn('rounded px-2 py-1 font-medium capitalize transition-colors', manualKind === k ? 'bg-foreground/10' : 'text-muted-foreground hover:text-foreground')}
                >
                  {k}
                </button>
              ))}
            </div>
            {manualKind === 'range' ? (
              <>
                <Input value={manualStart} onChange={(e) => setManualStart(e.target.value)} className="h-9 w-20 text-center font-mono text-sm" />
                <span className="text-muted-foreground">–</span>
                <Input value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} className="h-9 w-20 text-center font-mono text-sm" />
              </>
            ) : (
              <Input value={manualDuration} onChange={(e) => setManualDuration(e.target.value)} placeholder="1:30 or 90m" className="h-9 w-28 text-center font-mono text-sm" />
            )}
            <Button className="gap-2" onClick={addManual} disabled={!hasTitle} title={hasTitle ? undefined : 'Enter a task name to add time'}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        )}

        {pomo && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            {pomo.onBreak ? (
              <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                <Coffee className="h-3.5 w-3.5" /> Break
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <TimerIcon className="h-3.5 w-3.5" /> Focus
              </span>
            )}
            <span className="text-muted-foreground">
              ends in <span className="font-mono tabular-nums">{fmtTimer(pomo.remaining)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Period selector + total */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2 text-xs">
        <div className="flex rounded-md border p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={cn('rounded px-2 py-1 font-medium transition-colors', period === p.id ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground">
          {period === 'all' ? 'Total' : `This ${period}`}{' '}
          <span className="font-mono tabular-nums text-foreground">{fmtTotal(periodTotal)}</span>
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {visibleGroups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <TimerIcon className="h-9 w-9 opacity-30" />
            <p className="text-sm">{period === 'all' ? 'No tasks yet. Enter a name and press Start.' : `No time tracked this ${period}.`}</p>
          </div>
        ) : (
          visibleGroups.map((g) => {
            const project = projectById(g.projectId);
            const isOpen = expanded.has(g.key);
            const isRunning = g.recs.some((r) => r.end === null);
            const total = period === 'all' ? g.totalAll : g.totalPeriod;
            return (
              <div key={g.key} className="border-b last:border-b-0">
                {/* Task header */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => toggleExpand(g.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                    <ColorDot color={project?.color} />
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    {project && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{project.name}</span>}
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.recs.length}</span>
                    {isRunning && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
                  </button>
                  <span className={cn('shrink-0 font-mono text-sm tabular-nums', isRunning && 'text-red-500')}>{fmtTotal(total)}</span>
                  {isRunning ? (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-500/10" onClick={stopRunning} title="Stop">
                      <Square className="h-4 w-4 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      title="Start this task"
                      onClick={() => resumeTask(g.name, g.projectId, g.tagIds, g.billable)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* History */}
                {isOpen && (
                  <div className="divide-y border-t bg-muted/20">
                    {g.recs.map((e) => (
                      <HistoryRow key={e.id} entry={e} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
