import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useClockify, type TimeEntry } from './store';
import { useMeetings, type Meeting } from '@/lib/meetings';
import { MeetingDialog } from '@/components/meetings/MeetingDialog';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Modal, ProjectPicker, TagPicker } from './ui';
import {
  MS_MIN,
  addDays,
  dayStart,
  fmtTimer,
  fmtTotal,
  pad,
  sameDay,
  shortDate,
  timeOfDay,
  weekDays,
  weekRangeLabel,
  weekdayShort,
} from './time';

const HOUR_PX = 48;
const SNAP_MIN = 15;
const DAY_MIN = 24 * 60;

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clampMin = (min: number) => Math.max(0, Math.min(DAY_MIN, min));
const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(Math.round(min) % 60)}`;

// Pick black or white text for legibility on a given block colour.
function readableOn(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? 'rgba(17,24,39,0.92)' : '#ffffff';
}

// A pending (not-yet-saved) new event — drives the confirm dialog.
interface Draft { start: number; end: number }

// Pointer gesture in progress on the grid.
type Drag =
  | { mode: 'create'; dayTs: number; top: number; aMin: number; bMin: number }
  | { mode: 'move'; id: string; dayTs: number; top: number; durMin: number; grabMin: number; fromMin: number; curMin: number }
  | { mode: 'resize'; id: string; edge: 'start' | 'end'; dayTs: number; top: number; startMin: number; endMin: number };

/** Assign each block an overlap column so concurrent items sit side-by-side. */
function layoutColumns(items: { id: string; startMin: number; endMin: number }[]) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const result = new Map<string, { col: number; cols: number }>();
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const placement: Record<string, number> = {};
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => it.startMin >= end);
      if (col === -1) { col = colEnds.length; colEnds.push(it.endMin); }
      else colEnds[col] = it.endMin;
      placement[it.id] = col;
    }
    for (const it of cluster) result.set(it.id, { col: placement[it.id], cols: colEnds.length });
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return result;
}

export function CalendarView() {
  const { entries, projectById, now, addEntry, updateEntry, deleteEntry, settings } = useClockify();
  const { meetings, addMeeting } = useMeetings();
  const [anchor, setAnchor] = useState(() => now);
  const [view, setView] = useState<'week' | 'day'>('week');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) {
      const focusHour = Math.max(0, Math.min(18, new Date(now).getHours() - 1));
      scrollRef.current.scrollTop = focusHour * HOUR_PX;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(() => {
    if (view === 'day') return [dayStart(anchor)];
    return weekDays(anchor, settings.weekStartsMon);
  }, [anchor, view, settings.weekStartsMon]);

  const editing = editingId ? entries.find((e) => e.id === editingId) ?? null : null;

  const entriesByDay = useMemo(() => {
    const m = new Map<number, TimeEntry[]>();
    for (const d of days) m.set(d, []);
    for (const e of entries) {
      const d = dayStart(e.start);
      if (m.has(d)) m.get(d)!.push(e);
    }
    return m;
  }, [entries, days]);

  const meetingsByDay = useMemo(() => {
    const m = new Map<number, Meeting[]>();
    for (const d of days) m.set(d, []);
    for (const mt of meetings) {
      const d = dayStart(mt.start);
      if (m.has(d)) m.get(d)!.push(mt);
    }
    return m;
  }, [meetings, days]);

  const dayTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of days) m.set(d, (entriesByDay.get(d) ?? []).reduce((s, e) => s + ((e.end ?? now) - e.start), 0));
    return m;
  }, [days, entriesByDay, now]);
  const weekTotal = useMemo(() => [...dayTotals.values()].reduce((s, v) => s + v, 0), [dayTotals]);
  const targetMs = settings.dailyTargetHours * 3600_000;

  const yToMin = (clientY: number, top: number) => snap(((clientY - top) / HOUR_PX) * 60);

  const onColMouseDown = (dayTs: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startMin = yToMin(e.clientY, rect.top);
    setDrag({ mode: 'create', dayTs, top: rect.top, aMin: startMin, bMin: startMin });
  };

  const startMove = (entry: TimeEntry, e: React.MouseEvent) => {
    if (e.button !== 0 || entry.end === null) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).closest('[data-col]')!.getBoundingClientRect();
    const day = dayStart(entry.start);
    const grabMin = yToMin(e.clientY, rect.top);
    setDrag({
      mode: 'move', id: entry.id, dayTs: day, top: rect.top,
      durMin: (entry.end - entry.start) / MS_MIN,
      grabMin, fromMin: (entry.start - day) / MS_MIN, curMin: (entry.start - day) / MS_MIN,
    });
  };

  const startResize = (entry: TimeEntry, edge: 'start' | 'end', e: React.MouseEvent) => {
    if (e.button !== 0 || entry.end === null) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).closest('[data-col]')!.getBoundingClientRect();
    const day = dayStart(entry.start);
    setDrag({
      mode: 'resize', id: entry.id, edge, dayTs: day, top: rect.top,
      startMin: (entry.start - day) / MS_MIN, endMin: (entry.end - day) / MS_MIN,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const pointerMin = yToMin(e.clientY, drag.top);
      setDrag((d) => {
        if (!d) return d;
        if (d.mode === 'create') return { ...d, bMin: clampMin(pointerMin) };
        if (d.mode === 'move') {
          const next = clampMin(d.fromMin + (pointerMin - d.grabMin));
          return { ...d, curMin: Math.min(next, DAY_MIN - d.durMin) };
        }
        if (d.edge === 'start') return { ...d, startMin: Math.min(clampMin(pointerMin), d.endMin - SNAP_MIN) };
        return { ...d, endMin: Math.max(clampMin(pointerMin), d.startMin + SNAP_MIN) };
      });
    };
    const onUp = () => {
      setDrag((d) => {
        if (!d) return null;
        if (d.mode === 'create') {
          const lo = Math.min(d.aMin, d.bMin);
          const hi = Math.max(d.aMin, d.bMin);
          const span = hi - lo >= SNAP_MIN ? { lo, hi } : { lo, hi: Math.min(DAY_MIN, lo + 60) };
          setDraft({ start: d.dayTs + span.lo * MS_MIN, end: d.dayTs + span.hi * MS_MIN });
        } else if (d.mode === 'move') {
          if (d.curMin === d.fromMin) setEditingId(d.id);
          else updateEntry(d.id, { start: d.dayTs + d.curMin * MS_MIN, end: d.dayTs + (d.curMin + d.durMin) * MS_MIN });
        } else {
          updateEntry(d.id, { start: d.dayTs + d.startMin * MS_MIN, end: d.dayTs + d.endMin * MS_MIN });
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, updateEntry]);

  const previewMin = (e: TimeEntry, day: number): { startMin: number; endMin: number } => {
    const base = { startMin: (e.start - day) / MS_MIN, endMin: ((e.end ?? now) - day) / MS_MIN };
    if (!drag || !('id' in drag) || drag.id !== e.id) return base;
    if (drag.mode === 'move') return { startMin: drag.curMin, endMin: drag.curMin + drag.durMin };
    if (drag.mode === 'resize') return { startMin: drag.startMin, endMin: drag.endMin };
    return base;
  };

  const nowMin = (now - dayStart(now)) / MS_MIN;
  const totalColor = (ms: number) => (targetMs > 0 && ms >= targetMs ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground');

  return (
    <div className="flex h-full flex-col">
      {/* Nav */}
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor((a) => addDays(a, view === 'day' ? -1 : -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(now)}>
          Today
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor((a) => addDays(a, view === 'day' ? 1 : 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium">
          {view === 'day' ? shortDate(days[0]) : weekRangeLabel(anchor, settings.weekStartsMon)}
        </span>
        {view === 'week' && weekTotal > 0 && (
          <span className="text-xs text-muted-foreground">
            · <span className="font-mono tabular-nums text-foreground">{fmtTotal(weekTotal)}</span> tracked
          </span>
        )}
        <Button
          size="sm"
          className="ml-auto h-8 gap-1.5"
          onClick={() => {
            const day = dayStart(view === 'day' ? days[0] : now);
            const base = sameDay(day, now) ? Math.round(now / (30 * MS_MIN)) * (30 * MS_MIN) : day + 10 * 3600_000;
            setDraft({ start: base, end: base + 60 * MS_MIN });
          }}
        >
          New
        </Button>
        <div className="flex rounded-md border p-0.5">
          {(['week', 'day'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn('rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors', view === v ? 'bg-foreground/10' : 'text-muted-foreground hover:text-foreground')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Day headers — weekday + date-in-circle (today filled) + daily total */}
      <div className="flex shrink-0 border-b pr-3" style={{ paddingLeft: 48 }}>
        {days.map((d) => {
          const total = dayTotals.get(d) ?? 0;
          const today = sameDay(d, now);
          return (
            <div key={d} className="flex flex-1 flex-col items-center gap-0.5 py-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{weekdayShort(d)}</span>
              <span className={cn('flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold', today ? 'bg-primary text-primary-foreground' : 'text-foreground')}>
                {new Date(d).getDate()}
              </span>
              <span className={cn('font-mono text-[10px] tabular-nums', total > 0 ? totalColor(total) : 'text-transparent')}>
                {total > 0 ? fmtTotal(total) : '0m'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative flex pr-3" style={{ height: 24 * HOUR_PX }}>
          {/* hour axis */}
          <div className="relative w-12 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {h > 0 ? `${pad(h)}:00` : ''}
              </div>
            ))}
          </div>

          {/* day columns */}
          {days.map((d) => {
            const dayEntries = entriesByDay.get(d) ?? [];
            const dayMeetings = meetingsByDay.get(d) ?? [];
            const isToday = sameDay(d, now);

            // Entries + meetings share one overlap layout (Google-Calendar style).
            const blocks = [
              ...dayEntries.map((e) => { const p = previewMin(e, d); return { kind: 'entry' as const, id: e.id, startMin: p.startMin, endMin: p.endMin, entry: e }; }),
              ...dayMeetings.map((m) => ({ kind: 'meeting' as const, id: m.id, startMin: (m.start - d) / MS_MIN, endMin: (m.end - d) / MS_MIN, meeting: m })),
            ];
            const layout = layoutColumns(blocks.map((b) => ({ id: b.id, startMin: b.startMin, endMin: b.endMin })));

            return (
              <div
                key={d}
                data-col
                className={cn('relative flex-1 border-l', isToday && 'bg-primary/[0.03]')}
                onMouseDown={(e) => onColMouseDown(d, e)}
              >
                {/* hour + half-hour gridlines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h}>
                    <div className="absolute left-0 right-0 border-t border-border/70" style={{ top: h * HOUR_PX }} />
                    <div className="absolute left-0 right-0 border-t border-border/30" style={{ top: h * HOUR_PX + HOUR_PX / 2 }} />
                  </div>
                ))}

                {/* current-time line */}
                {isToday && (
                  <div className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <span className="absolute -left-1 -top-[5px] h-2.5 w-2.5 rounded-full bg-red-500" />
                  </div>
                )}

                {/* drag-to-create preview with a live time label */}
                {drag?.mode === 'create' && drag.dayTs === d && (() => {
                  const lo = Math.min(drag.aMin, drag.bMin);
                  const hi = Math.max(drag.aMin, drag.bMin);
                  return (
                    <div
                      className="pointer-events-none absolute left-1 right-1 z-10 overflow-hidden rounded-md bg-primary/25 px-1.5 py-0.5 text-[11px] font-medium text-primary ring-1 ring-primary"
                      style={{ top: (lo / 60) * HOUR_PX, height: Math.max(2, ((hi - lo) / 60) * HOUR_PX) }}
                    >
                      {hm(lo)} – {hm(hi >= lo + SNAP_MIN ? hi : lo + 60)}
                    </div>
                  );
                })()}

                {/* blocks */}
                {blocks.map((b) => {
                  const lay = layout.get(b.id) ?? { col: 0, cols: 1 };
                  const leftPct = (lay.col / lay.cols) * 100;
                  const widthPct = 100 / lay.cols;
                  const top = (b.startMin / 60) * HOUR_PX;
                  const height = Math.max(14, ((b.endMin - b.startMin) / 60) * HOUR_PX);
                  const posStyle = { top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` };

                  if (b.kind === 'meeting') {
                    const mt = b.meeting;
                    return (
                      <button
                        key={`m-${b.id}`}
                        data-block
                        onClick={(ev) => { ev.stopPropagation(); setEditingMeetingId(mt.id); }}
                        className="group absolute z-30 flex flex-col overflow-hidden rounded-lg border border-indigo-400/60 bg-indigo-500/15 py-1 pl-2.5 pr-1.5 text-left text-[11px] leading-tight text-indigo-700 shadow-sm backdrop-blur-[1px] transition duration-100 hover:shadow-md hover:brightness-[1.03] dark:bg-indigo-500/25 dark:text-indigo-100"
                        style={posStyle}
                      >
                        <span className="absolute inset-y-0 left-0 w-1 bg-indigo-500" />
                        <div className="flex items-center gap-1 font-semibold">
                          <Users className="h-3 w-3 shrink-0" />
                          <span className="truncate">{mt.title || 'Meeting'}</span>
                        </div>
                        {height > 34 && (
                          <div className="truncate text-[10px] font-medium opacity-80">{timeOfDay(mt.start, false)} – {timeOfDay(mt.end, false)}</div>
                        )}
                      </button>
                    );
                  }

                  const e = b.entry;
                  const project = projectById(e.projectId);
                  const color = project?.color ?? '#64748b';
                  const textColor = readableOn(color);
                  const running = e.end === null;
                  const dragging = drag && 'id' in drag && drag.id === e.id;
                  const compact = height < 34;
                  return (
                    <div
                      key={`e-${b.id}`}
                      data-block
                      onMouseDown={(ev) => startMove(e, ev)}
                      onClick={(ev) => { ev.stopPropagation(); if (running) setEditingId(e.id); }}
                      className={cn(
                        'group absolute z-10 flex select-none flex-col overflow-hidden rounded-lg border border-black/10 py-1 pl-2.5 pr-1.5 text-left text-[11px] leading-tight shadow-sm transition duration-100 hover:shadow-md hover:brightness-[1.04] dark:border-white/10',
                        running ? 'cursor-pointer ring-1 ring-inset ring-white/50' : 'cursor-grab active:cursor-grabbing',
                        dragging && 'z-40 shadow-lg brightness-[1.04]',
                      )}
                      style={{ ...posStyle, backgroundColor: color, backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(0,0,0,0.10))', color: textColor }}
                    >
                      {/* left accent bar */}
                      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: 'rgba(0,0,0,0.22)' }} />
                      {running && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-90" />}
                      {!running && (
                        <>
                          <span onMouseDown={(ev) => startResize(e, 'start', ev)} className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100" />
                          <span onMouseDown={(ev) => startResize(e, 'end', ev)} className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100" />
                        </>
                      )}
                      <div className="truncate font-semibold">{e.description || project?.name || 'Untitled'}</div>
                      {!compact && (
                        <div className="truncate text-[10px] font-medium opacity-80">
                          {timeOfDay(d + b.startMin * MS_MIN, false)} – {running ? 'now' : timeOfDay(d + b.endMin * MS_MIN, false)}
                          {project && e.description && <span className="opacity-70"> · {project.name}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit existing entry */}
      {editing && (
        <EntryEditor
          entry={editing}
          onClose={() => setEditingId(null)}
          onChange={(patch) => updateEntry(editing.id, patch)}
          onDelete={() => { deleteEntry(editing.id); setEditingId(null); }}
        />
      )}

      {/* Confirm new task / meeting (nothing is created until you press the button) */}
      {draft && (
        <QuickCreateDialog
          start={draft.start}
          end={draft.end}
          onCancel={() => setDraft(null)}
          onCreateTask={(fields) => { addEntry({ ...fields, source: 'manual' }); setDraft(null); }}
          onCreateMeeting={({ title, start, end }) => {
            const m = addMeeting({ title, start, end });
            setDraft(null);
            setEditingMeetingId(m.id); // open the notes editor right away
          }}
        />
      )}

      {editingMeetingId && (
        <MeetingDialog meetingId={editingMeetingId} onClose={() => setEditingMeetingId(null)} />
      )}
    </div>
  );
}

function EntryEditor({
  entry,
  onClose,
  onChange,
  onDelete,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onChange: (patch: Partial<TimeEntry>) => void;
  onDelete: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Edit entry">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Input value={entry.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="What did you work on?" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <ProjectPicker value={entry.projectId} taskValue={entry.taskId} onChange={(p, t) => onChange({ projectId: p, taskId: t })} />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Start</Label>
            <DateTimePicker value={entry.start} onChange={(ts) => onChange({ start: ts, ...(entry.end !== null && ts > entry.end ? { end: ts } : {}) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">End</Label>
            {entry.end !== null ? (
              <DateTimePicker value={entry.end} onChange={(ts) => onChange({ end: Math.max(ts, entry.start) })} />
            ) : (
              <div className="flex h-9 items-center px-1 text-xs text-muted-foreground">Running…</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TagPicker value={entry.tagIds} onChange={(ids) => onChange({ tagIds: ids })} />
        </div>
        <div className="flex justify-between border-t pt-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-red-500 hover:bg-red-500/10 hover:text-red-500" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function QuickCreateDialog({
  start: initialStart,
  end: initialEnd,
  onCancel,
  onCreateTask,
  onCreateMeeting,
}: {
  start: number;
  end: number;
  onCancel: () => void;
  onCreateTask: (fields: Pick<TimeEntry, 'description' | 'projectId' | 'taskId' | 'tagIds' | 'start' | 'end'>) => void;
  onCreateMeeting: (fields: { title: string; start: number; end: number }) => void;
}) {
  const [kind, setKind] = useState<'task' | 'meeting'>('task');
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const valid = end > start;

  const submit = () => {
    if (!valid) return;
    if (kind === 'task') onCreateTask({ description: title, projectId, taskId, tagIds, start, end });
    else onCreateMeeting({ title, start, end });
  };

  return (
    <Modal open onClose={onCancel} title="New event">
      <div className="space-y-3">
        {/* Task / Meeting selector */}
        <div className="flex rounded-md border p-0.5">
          {([['task', 'Task', Clock], ['meeting', 'Meeting', Users]] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors', kind === k ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{kind === 'task' ? 'Description' : 'Title'}</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={kind === 'task' ? 'What are you working on?' : 'Meeting title'}
            autoFocus
          />
        </div>

        {kind === 'task' && (
          <div className="space-y-1.5">
            <Label className="text-xs">Project</Label>
            <ProjectPicker value={projectId} taskValue={taskId} onChange={(p, t) => { setProjectId(p); setTaskId(t); }} />
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Start</Label>
            <DateTimePicker value={start} onChange={(ts) => { setStart(ts); if (ts >= end) setEnd(ts + 60 * MS_MIN); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">End</Label>
            <DateTimePicker value={end} onChange={setEnd} />
          </div>
        </div>

        {kind === 'task' && (
          <div className="flex items-center gap-2">
            <TagPicker value={tagIds} onChange={setTagIds} />
          </div>
        )}

        {kind === 'meeting' && (
          <p className="text-[11px] text-muted-foreground">Notes (agenda, decisions, action items) open next, and stay in sync with the Meeting Notes tool.</p>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">{valid ? fmtTimer(end - start) : 'End must be after start'}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" disabled={!valid} onClick={submit}>
              {kind === 'task' ? 'Add entry' : 'Create & add notes'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
