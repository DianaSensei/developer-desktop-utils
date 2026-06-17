import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useClockify, type TimeEntry } from './store';
import { BillableButton, Modal, ProjectPicker, TagPicker } from './ui';
import {
  MS_MIN,
  addDays,
  dayStart,
  fmtTimer,
  parseTimeOfDay,
  pad,
  sameDay,
  shortDate,
  timeOfDay,
  weekDays,
  weekRangeLabel,
  weekdayShort,
} from './time';

const HOUR_PX = 44;
const SNAP_MIN = 15;

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

export function CalendarView() {
  const { entries, timeOff, policies, projectById, now, addEntry, updateEntry, deleteEntry, settings } = useClockify();
  const [anchor, setAnchor] = useState(() => now);
  const [view, setView] = useState<'week' | 'day'>('week');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ dayTs: number; top: number; aMin: number; bMin: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX; // open near 07:00
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

  // --- drag-to-create ---
  const onColMouseDown = (dayTs: number, e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-block]')) return; // clicked a block
    const rect = e.currentTarget.getBoundingClientRect();
    const startMin = snap(((e.clientY - rect.top) / HOUR_PX) * 60);
    setDrag({ dayTs, top: rect.top, aMin: startMin, bMin: startMin + SNAP_MIN });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const min = snap(((e.clientY - drag.top) / HOUR_PX) * 60);
      setDrag((d) => (d ? { ...d, bMin: Math.max(d.aMin + SNAP_MIN, Math.min(1440, min)) } : d));
    };
    const onUp = () => {
      setDrag((d) => {
        if (d) {
          const lo = Math.max(0, Math.min(d.aMin, d.bMin));
          const hi = Math.min(1440, Math.max(d.aMin, d.bMin));
          const created = addEntry({
            description: '',
            projectId: null,
            taskId: null,
            tagIds: [],
            billable: false,
            start: d.dayTs + lo * MS_MIN,
            end: d.dayTs + hi * MS_MIN,
            source: 'manual',
          });
          setEditingId(created.id);
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
  }, [drag, addEntry]);

  const nowMin = (now - dayStart(now)) / MS_MIN;

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
        <div className="ml-auto flex rounded-md border p-0.5">
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

      {/* Day headers */}
      <div className="flex shrink-0 border-b pr-3" style={{ paddingLeft: 48 }}>
        {days.map((d) => (
          <div key={d} className="flex-1 px-1 py-1.5 text-center">
            <span className={cn('text-xs font-medium', sameDay(d, now) ? 'text-foreground' : 'text-muted-foreground')}>
              {weekdayShort(d)} {new Date(d).getDate()}
            </span>
            <TimeOffBand dayTs={d} requests={timeOff} policies={policies} />
          </div>
        ))}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative flex pr-3" style={{ height: 24 * HOUR_PX }}>
          {/* hour axis */}
          <div className="relative w-12 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {h > 0 ? `${pad(h)}:00` : ''}
              </div>
            ))}
          </div>

          {/* day columns */}
          {days.map((d) => {
            const dayEntries = entriesByDay.get(d) ?? [];
            const isToday = sameDay(d, now);
            return (
              <div
                key={d}
                className="relative flex-1 border-l"
                onMouseDown={(e) => onColMouseDown(d, e)}
              >
                {/* hour gridlines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-muted/60" style={{ top: h * HOUR_PX }} />
                ))}

                {/* current-time line */}
                {isToday && (
                  <div className="absolute left-0 right-0 z-20 border-t border-red-500" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}

                {/* drag preview */}
                {drag && drag.dayTs === d && (
                  <div
                    className="absolute left-1 right-1 z-10 rounded bg-primary/20 ring-1 ring-primary"
                    style={{
                      top: (Math.min(drag.aMin, drag.bMin) / 60) * HOUR_PX,
                      height: (Math.abs(drag.bMin - drag.aMin) / 60) * HOUR_PX,
                    }}
                  />
                )}

                {/* entry blocks */}
                {dayEntries.map((e) => {
                  const startMin = (e.start - d) / MS_MIN;
                  const endMin = ((e.end ?? now) - d) / MS_MIN;
                  const project = projectById(e.projectId);
                  const color = project?.color ?? '#64748b';
                  const height = Math.max(14, ((endMin - startMin) / 60) * HOUR_PX);
                  return (
                    <button
                      key={e.id}
                      data-block
                      onClick={(ev) => { ev.stopPropagation(); setEditingId(e.id); }}
                      className="absolute left-1 right-1 z-10 overflow-hidden rounded px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-sm transition-shadow hover:shadow-md"
                      style={{ top: (startMin / 60) * HOUR_PX, height, backgroundColor: color }}
                    >
                      <div className="truncate font-medium">{e.description || project?.name || 'No description'}</div>
                      {height > 26 && (
                        <div className="truncate opacity-80">
                          {timeOfDay(e.start, false)} · {fmtTimer((e.end ?? now) - e.start)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      {editing && (
        <EntryEditor
          entry={editing}
          onClose={() => setEditingId(null)}
          onChange={(patch) => updateEntry(editing.id, patch)}
          onDelete={() => { deleteEntry(editing.id); setEditingId(null); }}
        />
      )}
    </div>
  );
}

function TimeOffBand({
  dayTs,
  requests,
  policies,
}: {
  dayTs: number;
  requests: ReturnType<typeof useClockify>['timeOff'];
  policies: ReturnType<typeof useClockify>['policies'];
}) {
  const hit = requests.find((r) => dayTs >= r.start && dayTs <= r.end);
  if (!hit) return null;
  const policy = policies.find((p) => p.id === hit.policyId);
  return (
    <div
      className="mt-1 truncate rounded px-1 py-0.5 text-[10px] font-medium text-white"
      style={{ backgroundColor: policy?.color ?? '#64748b' }}
      title={hit.note || policy?.name}
    >
      {policy?.name ?? 'Time off'}
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
  const day = dayStart(entry.start);
  const [startStr, setStartStr] = useState(timeOfDay(entry.start, false));
  const [endStr, setEndStr] = useState(entry.end !== null ? timeOfDay(entry.end, false) : '');

  const commitStart = () => {
    const v = parseTimeOfDay(startStr, day);
    if (v !== null && (entry.end === null || v <= entry.end)) onChange({ start: v });
    else setStartStr(timeOfDay(entry.start, false));
  };
  const commitEnd = () => {
    if (entry.end === null) return;
    const v = parseTimeOfDay(endStr, day);
    if (v !== null && v >= entry.start) onChange({ end: v });
    else setEndStr(timeOfDay(entry.end, false));
  };

  return (
    <Modal open onClose={onClose} title="Edit entry">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Input value={entry.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Add description" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <ProjectPicker value={entry.projectId} taskValue={entry.taskId} onChange={(p, t) => onChange({ projectId: p, taskId: t })} />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Start</Label>
            <Input value={startStr} onChange={(e) => setStartStr(e.target.value)} onBlur={commitStart} className="font-mono" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">End</Label>
            <Input value={endStr} onChange={(e) => setEndStr(e.target.value)} onBlur={commitEnd} disabled={entry.end === null} className="font-mono" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TagPicker value={entry.tagIds} onChange={(ids) => onChange({ tagIds: ids })} />
          <BillableButton value={entry.billable} onChange={(v) => onChange({ billable: v })} />
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
