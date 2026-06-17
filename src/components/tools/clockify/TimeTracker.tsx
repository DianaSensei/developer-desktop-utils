import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2, Plus, Coffee, Timer as TimerIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useClockify, type TimeEntry } from './store';
import { BillableButton, ColorDot, ConfirmButton, ProjectPicker, TagPicker } from './ui';
import {
  dayKey,
  dayLabel,
  dayStart,
  fmtTimer,
  fmtTotal,
  parseTimeOfDay,
  pomodoroPhase,
  playBeep,
  timeOfDay,
  weekStart,
} from './time';

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
      className="h-7 w-[68px] text-center font-mono text-xs tabular-nums"
    />
  );
}

function EntryRow({ entry }: { entry: TimeEntry }) {
  const { projectById, now, updateEntry, deleteEntry, stopRunning, startEntry } = useClockify();
  const project = projectById(entry.projectId);
  const running = entry.end === null;
  const day = dayStart(entry.start);
  const duration = (entry.end ?? now) - entry.start;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input
        value={entry.description}
        onChange={(e) => updateEntry(entry.id, { description: e.target.value })}
        placeholder="Add description"
        className="h-8 min-w-[140px] flex-1 border-transparent bg-transparent px-1 text-sm hover:border-input focus-visible:border-input"
      />
      <ProjectPicker
        value={entry.projectId}
        taskValue={entry.taskId}
        onChange={(p, t) => updateEntry(entry.id, { projectId: p, taskId: t })}
        compact
      />
      <TagPicker value={entry.tagIds} onChange={(ids) => updateEntry(entry.id, { tagIds: ids })} compact />
      <BillableButton value={entry.billable} onChange={(v) => updateEntry(entry.id, { billable: v })} compact />

      <div className="flex items-center gap-1">
        <EditableTime ts={entry.start} dayTs={day} onCommit={(v) => updateEntry(entry.id, { start: Math.min(v, entry.end ?? Date.now()) })} />
        <span className="text-muted-foreground">–</span>
        {running ? (
          <span className="w-[68px] text-center text-xs text-red-500">now</span>
        ) : (
          <EditableTime ts={entry.end!} dayTs={day} onCommit={(v) => updateEntry(entry.id, { end: Math.max(v, entry.start) })} />
        )}
      </div>

      <span className={cn('w-20 text-right font-mono text-sm tabular-nums', running && 'text-red-500')}>
        {fmtTimer(duration)}
      </span>

      {running ? (
        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-500/10" onClick={stopRunning} title="Stop">
          <Square className="h-4 w-4 fill-current" />
        </Button>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Resume"
          onClick={() =>
            startEntry({
              description: entry.description,
              projectId: entry.projectId,
              taskId: entry.taskId,
              tagIds: entry.tagIds,
              billable: entry.billable,
            })
          }
        >
          <Play className="h-4 w-4" />
        </Button>
      )}
      <ConfirmButton onConfirm={() => deleteEntry(entry.id)} title="Delete entry" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
        <Trash2 className="h-3.5 w-3.5" />
      </ConfirmButton>
      {project && <ColorDot color={project.color} className="ml-0.5" />}
    </div>
  );
}

export function TimeTracker() {
  const { entries, running, now, settings, startEntry, stopRunning, addEntry } = useClockify();

  // entry-bar draft
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('10:00');

  useQuickPaste(setDesc, mode === 'timer' && !running);

  // sync draft from the running entry so the bar reflects it
  useEffect(() => {
    if (running) {
      setDesc(running.description);
      setProjectId(running.projectId);
      setTaskId(running.taskId);
      setTagIds(running.tagIds);
      setBillable(running.billable);
    }
  }, [running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A title is required before any time can be recorded.
  const hasTitle = desc.trim().length > 0;
  const descRef = useRef<HTMLInputElement>(null);

  const start = () => {
    if (!hasTitle) {
      descRef.current?.focus();
      return;
    }
    startEntry({ description: desc.trim(), projectId, taskId, tagIds, billable });
  };

  const addManual = () => {
    if (!hasTitle) {
      descRef.current?.focus();
      return;
    }
    const today = dayStart(now);
    const s = parseTimeOfDay(manualStart, today);
    const e = parseTimeOfDay(manualEnd, today);
    if (s === null || e === null || e <= s) return;
    addEntry({ description: desc.trim(), projectId, taskId, tagIds, billable, start: s, end: e, source: 'manual' });
    setDesc('');
  };

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

  // group entries by day (newest first)
  const groups = useMemo(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const k = dayKey(e.start);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    const out = [...m.values()].map((recs) => ({
      ts: recs[0].start,
      recs: recs.sort((a, b) => b.start - a.start),
      total: recs.reduce((s, e) => s + ((e.end ?? now) - e.start), 0),
    }));
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [entries, now]);

  const weekTotal = useMemo(() => {
    const ws = weekStart(now, settings.weekStartsMon);
    return entries.filter((e) => e.start >= ws).reduce((s, e) => s + ((e.end ?? now) - e.start), 0);
  }, [entries, now, settings.weekStartsMon]);

  return (
    <div className="flex h-full flex-col">
      {/* Entry bar */}
      <div
        className={cn(
          'shrink-0 border-b p-3 transition-colors',
          pomo?.onBreak && 'bg-emerald-500/5'
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={descRef}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mode === 'timer' && !running && start()}
            placeholder={`What are you working on? — ${quickPasteHint}`}
            className="h-10 min-w-[180px] flex-1 text-sm"
          />
          <ProjectPicker value={projectId} taskValue={taskId} onChange={(p, t) => { setProjectId(p); setTaskId(t); }} />
          <TagPicker value={tagIds} onChange={setTagIds} />
          <BillableButton value={billable} onChange={setBillable} />

          {/* timer / manual switch */}
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
                <Button size="lg" className="gap-2" onClick={start} disabled={!hasTitle} title={hasTitle ? undefined : 'Enter a title to start tracking'}>
                  <Play className="h-4 w-4" /> Start
                </Button>
              )}
            </>
          ) : (
            <>
              <Input value={manualStart} onChange={(e) => setManualStart(e.target.value)} className="h-9 w-20 text-center font-mono text-sm" />
              <span className="text-muted-foreground">–</span>
              <Input value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} className="h-9 w-20 text-center font-mono text-sm" />
              <Button className="gap-2" onClick={addManual} disabled={!hasTitle} title={hasTitle ? undefined : 'Enter a title to add an entry'}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </>
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
      </div>

      {/* Week total */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span>This week</span>
        <span className="font-mono tabular-nums text-foreground">{fmtTotal(weekTotal)}</span>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <TimerIcon className="h-9 w-9 opacity-30" />
            <p className="text-sm">No time entries yet. Press Start to track time.</p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.ts}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-3 py-1.5 text-xs backdrop-blur">
                <span className="font-medium text-muted-foreground">{dayLabel(g.ts)}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{fmtTotal(g.total)}</span>
              </div>
              <div className="divide-y">
                {g.recs.map((e) => (
                  <EntryRow key={e.id} entry={e} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
