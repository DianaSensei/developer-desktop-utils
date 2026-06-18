import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2, Plus, ChevronRight, Coffee, Timer as TimerIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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

type Period = 'day' | 'week' | 'month' | 'all' | 'range';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
  { id: 'range', label: 'Range' },
];

/** Inclusive window filter. A null bound means "open" on that side. */
function inWindow(start: number, win: { from: number | null; to: number | null }) {
  return (win.from == null || start >= win.from) && (win.to == null || start <= win.to);
}

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

// Inline "add a subtask" input shown at the bottom of an expanded task.
function AddSubtaskInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState('');
  const submit = () => { const n = v.trim(); if (n) { onAdd(n); setV(''); } };
  return (
    <div className="flex items-center gap-2 border-t py-2 pl-8 pr-3">
      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Add subtask…"
        className="h-7 flex-1 text-xs"
      />
      <Button size="sm" variant="outline" className="h-7" onClick={submit} disabled={!v.trim()}>Add</Button>
    </div>
  );
}

export function TimeTracker() {
  const { entries, subtasks, running, now, settings, startEntry, stopRunning, addEntry, updateEntry, addSubtask, deleteSubtask, projectById } = useClockify();

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
  const [rangeStart, setRangeStart] = useState(() => toDateInput(now - 6 * 24 * 3600_000));
  const [rangeEnd, setRangeEnd] = useState(() => toDateInput(now));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useQuickPaste(setDesc, mode === 'timer' && !running);

  const hasTitle = desc.trim().length > 0;
  const descRef = useRef<HTMLInputElement>(null);
  // True when the typed name is a different task than the one currently running —
  // i.e. pressing Start should switch (stop the old, start the new).
  const isNewTask = hasTitle && desc.trim().toLowerCase() !== (running?.description.trim().toLowerCase() ?? '');

  // Active time window for the totals/filtering. day/week/month are open-ended on
  // the upper side; "range" uses the two date pickers; "all" is fully open.
  const win = useMemo<{ from: number | null; to: number | null }>(() => {
    if (period === 'all') return { from: null, to: null };
    if (period === 'range') {
      const from = parseDateInput(rangeStart);
      const toDay = parseDateInput(rangeEnd);
      return { from, to: toDay == null ? null : toDay + 24 * 3600_000 - 1 }; // inclusive end day
    }
    return { from: periodStart(now, period, settings.weekStartsMon), to: null };
  }, [period, rangeStart, rangeEnd, now, settings.weekStartsMon]);

  // Auto-stop the running timer when it reaches the lunch break or the end of the
  // work day, so a session never silently runs through a break or past working
  // hours. The clock stops exactly at that boundary; the user can press Start to
  // continue afterwards.
  const autoStopAt = useMemo(() => {
    if (!running) return null;
    const day = dayStart(running.start);
    const lunchStart = parseTimeOfDay(settings.lunchStart, day);
    const lunchEnd = parseTimeOfDay(settings.lunchEnd, day);
    const workEnd = parseTimeOfDay(settings.workEnd, day);
    const bounds: number[] = [];
    if (lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart) bounds.push(lunchStart); // break begins
    if (workEnd !== null) bounds.push(workEnd); // over working hours
    const future = bounds.filter((b) => b > running.start);
    return future.length ? Math.min(...future) : null;
  }, [running, settings.lunchStart, settings.lunchEnd, settings.workEnd]);

  useEffect(() => {
    if (!running || autoStopAt === null) return;
    if (now >= autoStopAt) {
      updateEntry(running.id, { end: autoStopAt });
      if (settings.sound) playBeep();
    }
  }, [running, autoStopAt, now, updateEntry, settings.sound]);

  // Group time records into unique tasks keyed by (case-insensitive) name.
  const groups = useMemo(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const key = (e.description.trim() || 'Untitled').toLowerCase();
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    const dur = (recsArr: TimeEntry[]) => recsArr.reduce((s, e) => s + ((e.end ?? now) - e.start), 0);
    const out = [...m.entries()].map(([key, recs]) => {
      const sorted = recs.slice().sort((a, b) => b.start - a.start);

      // Subtask names: registry definitions (so empty ones still show) ∪ names used by entries.
      const defNames = subtasks.filter((s) => s.task === key).sort((a, b) => a.createdAt - b.createdAt).map((s) => s.name);
      const subNames: string[] = [];
      for (const n of [...defNames, ...recs.map((e) => e.subtask).filter((x): x is string => !!x)]) {
        if (!subNames.some((x) => x.toLowerCase() === n.toLowerCase())) subNames.push(n);
      }
      const directRecs = recs.filter((e) => !e.subtask).sort((a, b) => b.start - a.start);
      const subgroups = subNames.map((name) => {
        const srecs = recs.filter((e) => (e.subtask ?? '').toLowerCase() === name.toLowerCase()).sort((a, b) => b.start - a.start);
        return {
          name,
          recs: srecs,
          running: srecs.some((e) => e.end === null),
          totalAll: dur(srecs),
          totalPeriod: dur(srecs.filter((e) => inWindow(e.start, win))),
          lastActivity: srecs.reduce((mx, e) => Math.max(mx, e.end ?? now), 0),
        };
      });

      return {
        key,
        name: sorted[0].description.trim() || 'Untitled',
        projectId: sorted.find((r) => r.projectId)?.projectId ?? null,
        tagIds: sorted[0].tagIds,
        billable: sorted[0].billable,
        recs: sorted,
        directRecs,
        subgroups,
        hasSub: subNames.length > 0,
        // Most recent moment this task ran — a running entry counts as "now",
        // so the actively-tracked task always sorts to the top.
        lastActivity: recs.reduce((mx, e) => Math.max(mx, e.end ?? now), 0),
        totalAll: dur(recs),
        totalPeriod: dur(recs.filter((e) => inWindow(e.start, win))),
      };
    });
    out.sort((a, b) => b.lastActivity - a.lastActivity);
    return out;
  }, [entries, subtasks, now, win]);

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

  const resumeTask = (name: string, pid: string | null, tags: string[], bill: boolean, sub: string | null = null) => {
    startEntry({ description: name, subtask: sub, projectId: pid, taskId: null, tagIds: tags, billable: bill });
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
            onKeyDown={(e) => e.key === 'Enter' && mode === 'timer' && isNewTask && start()}
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
                <>
                  {/* Start a different task without stopping first — the running one stops automatically. */}
                  {isNewTask && (
                    <Button size="lg" className="gap-2" onClick={start} title="Start this task (stops the current one)">
                      <Play className="h-4 w-4" /> Start
                    </Button>
                  )}
                  <Button size="lg" variant="destructive" className="gap-2" onClick={stopRunning}>
                    <Square className="h-4 w-4 fill-current" /> Stop
                  </Button>
                </>
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
            <DatePicker
              value={manualDate}
              onChange={setManualDate}
              className="w-[150px] text-xs"
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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
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
          {period === 'range' && (
            <div className="flex items-center gap-1.5">
              <DatePicker value={rangeStart} onChange={setRangeStart} className="h-7 text-xs" />
              <span className="text-muted-foreground">→</span>
              <DatePicker value={rangeEnd} onChange={setRangeEnd} className="h-7 text-xs" />
            </div>
          )}
        </div>
        <span className="text-muted-foreground">
          {period === 'all' ? 'Total' : period === 'range' ? 'Range' : `This ${period}`}{' '}
          <span className="font-mono tabular-nums text-foreground">{fmtTotal(periodTotal)}</span>
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {visibleGroups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <TimerIcon className="h-9 w-9 opacity-30" />
            <p className="text-sm">{period === 'all' ? 'No tasks yet. Enter a name and press Start.' : period === 'range' ? 'No time tracked in this range.' : `No time tracked this ${period}.`}</p>
          </div>
        ) : (
          visibleGroups.map((g) => {
            const project = projectById(g.projectId);
            const isOpen = expanded.has(g.key);
            const isRunning = g.recs.some((r) => r.end === null);
            const total = period === 'all' ? g.totalAll : g.totalPeriod;
            const directTotal = (period === 'all' ? g.directRecs : g.directRecs.filter((e) => inWindow(e.start, win)))
              .reduce((s, e) => s + ((e.end ?? now) - e.start), 0);
            const directRunning = g.directRecs.some((e) => e.end === null);
            // When a task has subtasks you track by subtask; the header play resumes the
            // most-recently-active one (so it never silently tracks the parent).
            const startTask = () => {
              if (g.hasSub) {
                const target = [...g.subgroups].sort((a, b) => b.lastActivity - a.lastActivity)[0];
                if (target) resumeTask(g.name, g.projectId, g.tagIds, g.billable, target.name);
              } else {
                resumeTask(g.name, g.projectId, g.tagIds, g.billable, null);
              }
            };
            return (
              <div key={g.key} className="border-b last:border-b-0">
                {/* Task header */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => toggleExpand(g.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                    <ColorDot color={project?.color} />
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    {project && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{project.name}</span>}
                    {g.hasSub
                      ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.subgroups.length} sub</span>
                      : <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.recs.length}</span>}
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
                      title={g.hasSub ? 'Resume the latest subtask' : 'Start this task'}
                      onClick={startTask}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Expanded: subtasks (if any) or plain history, plus an add-subtask input */}
                {isOpen && (
                  <div className="border-t bg-muted/20">
                    {g.hasSub ? (
                      <>
                        {g.subgroups.map((sg) => {
                          const subKey = `${g.key}::${sg.name}`;
                          const subOpen = expanded.has(subKey);
                          const subTotal = period === 'all' ? sg.totalAll : sg.totalPeriod;
                          return (
                            <div key={subKey} className="border-t first:border-t-0">
                              <div className="flex items-center gap-2 py-2 pl-8 pr-3">
                                <button onClick={() => toggleExpand(subKey)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                  <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', subOpen && 'rotate-90')} />
                                  <span className="truncate text-sm">{sg.name}</span>
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{sg.recs.length}</span>
                                  {sg.running && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
                                </button>
                                <span className={cn('shrink-0 font-mono text-xs tabular-nums', sg.running && 'text-red-500')}>{fmtTotal(subTotal)}</span>
                                {sg.running ? (
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-500/10" onClick={stopRunning} title="Stop">
                                    <Square className="h-3.5 w-3.5 fill-current" />
                                  </Button>
                                ) : (
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Start this subtask" onClick={() => resumeTask(g.name, g.projectId, g.tagIds, g.billable, sg.name)}>
                                    <Play className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <ConfirmButton onConfirm={() => deleteSubtask(g.name, sg.name)} title="Delete subtask" className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </ConfirmButton>
                              </div>
                              {subOpen && (sg.recs.length > 0
                                ? <div className="divide-y bg-muted/30">{sg.recs.map((e) => <HistoryRow key={e.id} entry={e} />)}</div>
                                : <p className="py-2 pl-12 pr-3 text-xs text-muted-foreground">No time tracked yet.</p>)}
                            </div>
                          );
                        })}

                        {/* Direct (pre-subtask) time, if any */}
                        {g.directRecs.length > 0 && (() => {
                          const subKey = `${g.key}::__direct__`;
                          const subOpen = expanded.has(subKey);
                          return (
                            <div className="border-t">
                              <div className="flex items-center gap-2 py-2 pl-8 pr-3">
                                <button onClick={() => toggleExpand(subKey)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                  <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', subOpen && 'rotate-90')} />
                                  <span className="truncate text-sm italic text-muted-foreground">General</span>
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.directRecs.length}</span>
                                  {directRunning && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
                                </button>
                                <span className={cn('shrink-0 font-mono text-xs tabular-nums', directRunning && 'text-red-500')}>{fmtTotal(directTotal)}</span>
                              </div>
                              {subOpen && <div className="divide-y bg-muted/30">{g.directRecs.map((e) => <HistoryRow key={e.id} entry={e} />)}</div>}
                            </div>
                          );
                        })()}

                        <AddSubtaskInput onAdd={(n) => addSubtask(g.name, n)} />
                      </>
                    ) : (
                      <>
                        <div className="divide-y">{g.recs.map((e) => <HistoryRow key={e.id} entry={e} />)}</div>
                        <AddSubtaskInput onAdd={(n) => addSubtask(g.name, n)} />
                      </>
                    )}
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
