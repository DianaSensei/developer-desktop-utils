import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2, Plus, ChevronRight, Coffee, Timer as TimerIcon, Search, Download, SlidersHorizontal, Check, Pencil, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { cn } from '@/lib/utils';
import { useQuickPaste } from '@/hooks/useQuickPaste';
import { useClockify, type TimeEntry } from './store';
import { ColorDot, ConfirmButton, DurationInput, Popover, ProjectPicker, TagPicker, TimeStepperField } from './ui';
import { buildRows, exportFilename, saveExport, toCsv, toJson } from './export';
import {
  dayStart,
  fmtHM,
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

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const TOGGLE_HINT = IS_MAC ? '⌘↵' : 'Ctrl+↵';

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

// Time cell bound to a single timestamp on a fixed day. Uses the constrained
// TimePicker so only valid times can be set.
function EditableTime({ ts, dayTs, onCommit }: { ts: number; dayTs: number; onCommit: (v: number) => void }) {
  return (
    <TimePicker
      value={timeOfDay(ts, false)}
      onChange={(hm) => { const v = parseTimeOfDay(hm, dayTs); if (v !== null) onCommit(v); }}
      className="h-7"
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
      {running ? (
        <span className="ml-auto w-16 text-right font-mono tabular-nums text-red-500">{fmtTimer(duration)}</span>
      ) : (
        // Editing the duration keeps the start fixed and moves the end.
        <DurationInput
          ms={duration}
          onCommit={(ms) => updateEntry(entry.id, { end: entry.start + Math.max(60_000, ms) })}
          className="ml-auto h-7 w-16 text-xs"
        />
      )}
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

// Small read-only tag chip.
function TagChip({ name }: { name: string }) {
  return <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{name}</span>;
}

// Inline task-name editor used by the rename affordance.
function RenameField({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { const n = v.trim(); if (n) onCommit(n); else onCancel(); };
  return (
    <Input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      className="h-7 flex-1 text-sm"
    />
  );
}

// Filter popover: project and tags — with an active-count badge.
function FilterControls({
  projectId, onProject, tagIds, onTags, activeCount, onClear,
}: {
  projectId: string | null | 'all';
  onProject: (v: string | null | 'all') => void;
  tagIds: string[];
  onTags: (ids: string[]) => void;
  activeCount: number;
  onClear: () => void;
}) {
  const { projects, tags } = useClockify();
  const active = projects.filter((p) => !p.archived);
  const toggleTag = (id: string) => onTags(tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id]);

  return (
    <Popover
      align="right"
      className="w-60"
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          title={activeCount > 0 ? `${activeCount} filter${activeCount > 1 ? 's' : ''} active` : 'Filter tasks'}
          className={cn(
            'relative flex h-7 w-7 items-center justify-center rounded-md border transition-colors hover:bg-muted hover:text-foreground',
            activeCount > 0 ? 'border-primary/50 text-foreground' : 'text-muted-foreground'
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>
      )}
    >
      {() => (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</p>
            <div className="max-h-40 overflow-y-auto">
              {([['all', 'All projects'], [null, 'No project']] as const).map(([val, label]) => (
                <button
                  key={String(val)}
                  onClick={() => onProject(val)}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted', projectId === val && 'bg-foreground/10')}
                >
                  <ColorDot color={val === null ? undefined : 'transparent'} />
                  <span className={cn(val === 'all' && 'font-medium')}>{label}</span>
                </button>
              ))}
              {active.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onProject(p.id)}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted', projectId === p.id && 'bg-foreground/10')}
                >
                  <ColorDot color={p.color} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {tags.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
              <div className="max-h-40 overflow-y-auto">
                {tags.map((t) => (
                  <button key={t.id} onClick={() => toggleTag(t.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', tagIds.includes(t.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                      {tagIds.includes(t.id) && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeCount > 0 && (
            <button onClick={onClear} className="w-full rounded border border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Clear filters
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}

export function TimeTracker() {
  const { entries, subtasks, running, now, settings, startEntry, stopRunning, addEntry, updateEntry, addSubtask, deleteSubtask, renameTask, projectById, tagById } = useClockify();

  // entry-bar draft
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
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

  // search + filters
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterProject, setFilterProject] = useState<string | null | 'all'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);

  // inline rename
  const [renaming, setRenaming] = useState<string | null>(null);

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

      // Union of every tag used across the task's records — used for chips + filtering.
      const allTagIds: string[] = [];
      for (const e of recs) for (const id of e.tagIds) if (!allTagIds.includes(id)) allTagIds.push(id);

      return {
        key,
        name: sorted[0].description.trim() || 'Untitled',
        projectId: sorted.find((r) => r.projectId)?.projectId ?? null,
        tagIds: sorted[0].tagIds,
        allTagIds,
        recs: sorted,
        directRecs,
        subgroups,
        subNames,
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
    };
  };

  const start = () => {
    if (!hasTitle) { descRef.current?.focus(); return; }
    const inh = inherit(desc);
    startEntry({ description: desc.trim(), projectId: inh.projectId, taskId, tagIds: inh.tagIds });
  };

  const resumeTask = (name: string, pid: string | null, tags: string[], sub: string | null = null) => {
    startEntry({ description: name, subtask: sub, projectId: pid, taskId: null, tagIds: tags });
  };

  // Resume a task group — continues its most-recently-active subtask if it has any.
  const resumeGroup = (g: (typeof groups)[number]) => {
    const sub = g.hasSub ? [...g.subgroups].sort((a, b) => b.lastActivity - a.lastActivity)[0]?.name ?? null : null;
    resumeTask(g.name, g.projectId, g.tagIds, sub);
  };

  // Global ⌘/Ctrl+Enter toggles the timer (start the typed/last task, or stop it)
  // from anywhere in the tool. Refs keep the handler registered once.
  const startRef = useRef(start);
  startRef.current = start;
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (runningRef.current) stopRunning();
        else startRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stopRunning]);

  // Duration the manual entry will add — shown in the shared action slot and
  // gates the Add button. 0 when the inputs are invalid (e.g. end ≤ start).
  const manualMs = useMemo(() => {
    if (manualKind === 'range') {
      const day = parseDateInput(manualDate);
      if (day === null) return 0;
      const s = parseTimeOfDay(manualStart, day);
      const e = parseTimeOfDay(manualEnd, day);
      if (s === null || e === null || e <= s) return 0;
      return e - s;
    }
    return parseDuration(manualDuration) ?? 0;
  }, [manualKind, manualDate, manualStart, manualEnd, manualDuration]);

  // Compact label for the day a manual entry lands on — "Today" / "Yesterday" or a short date.
  const manualDayTs = parseDateInput(manualDate);
  const manualDayLabel =
    manualDayTs === null
      ? 'Set date'
      : manualDayTs === dayStart(now)
        ? 'Today'
        : manualDayTs === dayStart(now) - 86_400_000
          ? 'Yesterday'
          : shortDate(manualDayTs);

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
    addEntry({ description: desc.trim(), projectId: inh.projectId, taskId, tagIds: inh.tagIds, start: s, end: e, source: 'manual' });
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

  // Apply search + filters on top of the period window.
  const q = query.trim().toLowerCase();
  const filterCount = (filterProject !== 'all' ? 1 : 0) + filterTags.length;
  const matchesFilters = (g: (typeof groups)[number]) => {
    if (q) {
      const projName = projectById(g.projectId)?.name.toLowerCase() ?? '';
      const hit = g.name.toLowerCase().includes(q) || projName.includes(q) || g.subNames.some((n) => n.toLowerCase().includes(q));
      if (!hit) return false;
    }
    if (filterProject !== 'all' && g.projectId !== filterProject) return false;
    if (filterTags.length && !filterTags.every((id) => g.allTagIds.includes(id))) return false;
    return true;
  };

  const visibleGroups = groups
    .filter((g) => (period === 'all' ? true : g.totalPeriod > 0 || g.recs.some((r) => r.end === null)))
    .filter(matchesFilters);
  const periodTotal = visibleGroups.reduce((s, g) => s + (period === 'all' ? g.totalAll : g.totalPeriod), 0);

  // Today's tracked total vs the daily target (independent of the selected period).
  const todayStart = dayStart(now);
  const todayTotal = useMemo(
    () => entries.reduce((s, e) => (e.start >= todayStart ? s + ((e.end ?? now) - e.start) : s), 0),
    [entries, todayStart, now]
  );
  const targetMs = settings.dailyTargetHours * 3600_000;
  const targetPct = targetMs > 0 ? Math.min(100, (todayTotal / targetMs) * 100) : 0;
  const overMs = todayTotal - targetMs;

  // Export the entries currently in view (period window + active filters).
  const exportText = (fmt: 'csv' | 'json') => {
    const recs = visibleGroups.flatMap((g) => (period === 'all' ? g.recs : g.recs.filter((r) => inWindow(r.start, win))));
    const rows = buildRows(recs, { projectById, tagById });
    return fmt === 'csv' ? toCsv(rows) : toJson(rows);
  };
  const doExport = async (fmt: 'csv' | 'json', close: () => void) => {
    close();
    try {
      await saveExport(exportFilename(fmt), fmt, exportText(fmt));
    } catch {
      // save cancelled or unavailable — silent
    }
  };
  const hasExportable = visibleGroups.some((g) => g.recs.some((r) => r.end !== null));

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
            placeholder="What are you working on?"
            className="h-9 min-w-[180px] flex-1 text-sm"
          />
          <ProjectPicker value={projectId} taskValue={taskId} onChange={(p, t) => { setProjectId(p); setTaskId(t); }} />
          <TagPicker value={tagIds} onChange={setTagIds} />

          {/* Mode + time merged into a single control — the two related pieces
              read as one unit and share the row's height. The time area keeps a
              fixed width in both modes so switching never shifts the controls to
              the left. Timer shows the live clock; Manual shows the target day +
              duration and opens a date/time popover. */}
          <div className="flex h-9 items-stretch overflow-hidden rounded-md border">
            <div className="flex items-stretch p-0.5">
              {(['timer', 'manual'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn('rounded px-2.5 text-xs font-medium capitalize transition-colors', mode === m ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {m}
                </button>
              ))}
            </div>
            {mode === 'timer' ? (
              <span className={cn('flex w-[88px] items-center justify-center border-l font-mono text-sm font-semibold tabular-nums', running && 'text-red-500')}>
                {fmtTimer(running ? now - running.start : 0)}
              </span>
            ) : (
              <Popover
                align="right"
                className="w-64"
                trigger={({ open, toggle }) => (
                  <button
                    onClick={toggle}
                    title="Set date & time"
                    className={cn('flex h-full w-[88px] flex-col items-center justify-center gap-0.5 border-l leading-none transition-colors hover:bg-muted', open && 'bg-muted')}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground">{manualDayLabel}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums">{fmtHM(manualMs)}</span>
                  </button>
                )}
              >
              {() => (
                <div className="space-y-2.5">
                  {/* Inline month calendar — no nested popover to open */}
                  <DatePicker inline value={manualDate} onChange={setManualDate} className="w-full border-0 bg-transparent p-0" />
                  <div className="flex rounded-md border p-0.5 text-xs">
                    {(['range', 'duration'] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => setManualKind(k)}
                        className={cn('flex-1 rounded px-2 py-1 font-medium capitalize transition-colors', manualKind === k ? 'bg-foreground/10' : 'text-muted-foreground hover:text-foreground')}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                  {manualKind === 'range' ? (
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Start</span>
                        <TimeStepperField value={manualStart} onChange={setManualStart} className="w-full" />
                      </label>
                      <span className="mt-4 text-muted-foreground">–</span>
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">End</span>
                        <TimeStepperField value={manualEnd} onChange={setManualEnd} className="w-full" />
                      </label>
                    </div>
                  ) : (
                    <Input value={manualDuration} onChange={(e) => setManualDuration(e.target.value)} placeholder="1:30 or 90m" className="h-9 w-full text-center font-mono text-sm" />
                  )}
                </div>
              )}
            </Popover>
          )}
          </div>
          {mode === 'timer' ? (
            running ? (
              <>
                {/* Start a different task without stopping first — the running one stops automatically. */}
                {isNewTask && (
                  <Button className="h-9 min-w-[100px] gap-2" onClick={start} title="Start this task (stops the current one)">
                    <Play className="h-4 w-4" /> Start
                  </Button>
                )}
                <Button variant="destructive" className="h-9 min-w-[100px] gap-2" onClick={stopRunning} title={`Stop (${TOGGLE_HINT})`}>
                  <Square className="h-4 w-4 fill-current" /> Stop
                </Button>
              </>
            ) : (
              <Button className="h-9 min-w-[100px] gap-2" onClick={start} disabled={!hasTitle} title={hasTitle ? `Start (${TOGGLE_HINT})` : 'Enter a task name to start'}>
                <Play className="h-4 w-4" /> Start
              </Button>
            )
          ) : (
            <Button className="h-9 min-w-[100px] gap-2" onClick={addManual} disabled={!hasTitle || manualMs <= 0} title={!hasTitle ? 'Enter a task name to add time' : manualMs <= 0 ? 'Set a valid time range' : undefined}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          )}
        </div>

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

        {/* Quick resume — the single most common action: continue a recent task.
            Only shown when idle (no timer running, nothing typed) so it never clutters. */}
        {mode === 'timer' && !running && desc.trim() === '' && groups.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[11px] font-medium text-muted-foreground">Continue</span>
            {groups.slice(0, 4).map((g) => {
              const project = projectById(g.projectId);
              return (
                <button
                  key={g.key}
                  onClick={() => resumeGroup(g)}
                  title={`Resume “${g.name}”`}
                  className="group flex max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground"
                >
                  <Play className="h-3 w-3 shrink-0 fill-current text-primary" />
                  <ColorDot color={project?.color} />
                  <span className="truncate">{g.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* One compact view bar: what to show (left) · how you're doing + tools (right) */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 text-xs">
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

        <div className="ml-auto flex items-center gap-3">
          {/* Daily goal — today's time vs target */}
          {targetMs > 0 && (
            <div className="flex items-center gap-2" title={`Today vs your ${settings.dailyTargetHours}h daily target`}>
              <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-500', overMs >= 0 ? 'bg-emerald-500' : 'bg-primary')}
                  style={{ width: `${targetPct}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                Today <span className="font-mono tabular-nums text-foreground">{fmtTotal(todayTotal)}</span>
                <span className="text-muted-foreground/70"> / {settings.dailyTargetHours}h</span>
              </span>
            </div>
          )}

          {/* Period total */}
          <span className="whitespace-nowrap text-muted-foreground">
            {period === 'all' ? 'Total' : period === 'range' ? 'Range' : `This ${period}`}{' '}
            <span className="font-mono tabular-nums text-foreground">{fmtTotal(periodTotal)}</span>
          </span>

          {/* Search — expands inline on demand */}
          {searchOpen || query ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => { if (!query) setSearchOpen(false); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false); } }}
                placeholder="Search…"
                className="h-7 w-44 pl-8 pr-7 text-xs"
              />
              {query && (
                <button onClick={() => { setQuery(''); setSearchOpen(false); }} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} title="Search tasks" className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Search className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Filters (icon + active-count badge) */}
          <FilterControls
            projectId={filterProject}
            onProject={setFilterProject}
            tagIds={filterTags}
            onTags={setFilterTags}
            activeCount={filterCount}
            onClear={() => { setFilterProject('all'); setFilterTags([]); }}
          />

          {/* Export */}
          <Popover
            align="right"
            className="w-40"
            trigger={({ toggle }) => (
              <button
                onClick={() => hasExportable && toggle()}
                disabled={!hasExportable}
                className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                title={hasExportable ? 'Export visible entries' : 'Nothing to export'}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
          >
            {(close) => (
              <div className="space-y-0.5">
                <button onClick={() => doExport('csv', close)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Download className="h-3.5 w-3.5 text-muted-foreground" /> Export CSV
                </button>
                <button onClick={() => doExport('json', close)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Download className="h-3.5 w-3.5 text-muted-foreground" /> Export JSON
                </button>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {visibleGroups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <TimerIcon className="h-9 w-9 opacity-30" />
            {q || filterCount > 0 ? (
              <p className="text-sm">No tasks match your search or filters.</p>
            ) : entries.length === 0 ? (
              <>
                <p className="text-sm font-medium text-foreground">Start tracking your time</p>
                <p className="text-xs">Type what you're working on above, then press <span className="font-medium text-foreground">Start</span>.</p>
              </>
            ) : (
              <p className="text-sm">
                {period === 'range' ? 'No time tracked in this range.' : `No time tracked this ${period}.`}
              </p>
            )}
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
                if (target) resumeTask(g.name, g.projectId, g.tagIds, target.name);
              } else {
                resumeTask(g.name, g.projectId, g.tagIds, null);
              }
            };
            return (
              <div key={g.key} className="border-b last:border-b-0">
                {/* Task header */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {renaming === g.key ? (
                    <>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <ColorDot color={project?.color} />
                      <RenameField
                        initial={g.name}
                        onCommit={(v) => { renameTask(g.name, v); setRenaming(null); }}
                        onCancel={() => setRenaming(null)}
                      />
                    </>
                  ) : (
                    <button onClick={() => toggleExpand(g.key)} className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                      <ColorDot color={project?.color} />
                      <span className="truncate text-sm font-medium">{g.name}</span>
                      <Pencil
                        className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); setRenaming(g.key); }}
                      />
                      {project && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{project.name}</span>}
                      {g.allTagIds.slice(0, 3).map((id) => {
                        const t = tagById(id);
                        return t ? <TagChip key={id} name={t.name} /> : null;
                      })}
                      {g.hasSub
                        ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.subgroups.length} sub</span>
                        : <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.recs.length}</span>}
                      {isRunning && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />}
                    </button>
                  )}
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
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Start this subtask" onClick={() => resumeTask(g.name, g.projectId, g.tagIds, sg.name)}>
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
