import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useClockify } from './store';
import { useMeetings } from '@/lib/meetings';
import { MeetingDialog } from '@/components/meetings/MeetingDialog';
import { Modal, ProjectPicker } from './ui';
import { MS_HOUR, addDays, dayStart, sameDay, weekDays, weekRangeLabel, weekdayShort } from './time';

const MS_MIN = 60_000;

export function Schedule() {
  const { schedule, entries, projectById, taskById, addAssignment, deleteAssignment, settings, now } = useClockify();
  const { meetings, addMeeting } = useMeetings();
  const [anchor, setAnchor] = useState(() => now);
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);

  const days = useMemo(() => weekDays(anchor, settings.weekStartsMon), [anchor, settings.weekStartsMon]);

  const meetingsFor = (dayTs: number) =>
    meetings.filter((m) => sameDay(m.start, dayTs)).sort((a, b) => a.start - b.start);
  const addMeetingOn = (dayTs: number) => {
    const start = dayStart(dayTs) + 10 * MS_HOUR; // 10:00
    const m = addMeeting({ start, end: start + 60 * MS_MIN });
    setEditingMeetingId(m.id);
  };
  const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const plannedFor = (dayTs: number) => schedule.filter((a) => sameDay(a.date, dayTs));
  const plannedHours = (dayTs: number) => plannedFor(dayTs).reduce((s, a) => s + a.hours, 0);
  const trackedHours = (dayTs: number) =>
    entries
      .filter((e) => e.end !== null && sameDay(e.start, dayTs))
      .reduce((s, e) => s + (e.end! - e.start), 0) / MS_HOUR;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor((a) => addDays(a, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(now)}>Today</Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor((a) => addDays(a, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium">{weekRangeLabel(anchor, settings.weekStartsMon)}</span>
        <span className="ml-auto text-xs text-muted-foreground">Planned work vs tracked time</span>
      </div>

      <div className="grid flex-1 grid-cols-7 divide-x overflow-y-auto">
        {days.map((d) => {
          const planned = plannedHours(d);
          const tracked = trackedHours(d);
          return (
            <div key={d} className="flex min-w-0 flex-col">
              <div className={cn('shrink-0 border-b px-2 py-1.5 text-center', sameDay(d, now) && 'bg-foreground/5')}>
                <div className="text-xs font-medium">{weekdayShort(d)} {new Date(d).getDate()}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  <span className={cn(tracked >= planned && planned > 0 && 'text-emerald-600 dark:text-emerald-400')}>
                    {tracked.toFixed(1)}h
                  </span>
                  {' / '}
                  <span>{planned.toFixed(1)}h</span>
                </div>
              </div>
              <div className="flex-1 space-y-1 p-1">
                {plannedFor(d).map((a) => {
                  const project = projectById(a.projectId);
                  const task = taskById(a.taskId);
                  return (
                    <div
                      key={a.id}
                      className="group rounded-lg border-l-2 bg-card px-1.5 py-1 text-[11px]"
                      style={{ borderLeftColor: project?.color ?? '#64748b' }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium">{project?.name ?? 'General'}</span>
                        <span className="shrink-0 font-mono text-muted-foreground">{a.hours}h</span>
                      </div>
                      {task && <div className="truncate text-muted-foreground">{task.name}</div>}
                      {a.note && <div className="truncate text-muted-foreground">{a.note}</div>}
                      <button
                        onClick={() => deleteAssignment(a.id)}
                        className="mt-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                {meetingsFor(d).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setEditingMeetingId(m.id)}
                    className="block w-full rounded-lg border border-dashed border-indigo-400/70 bg-indigo-500/10 px-1.5 py-1 text-left text-[11px] text-indigo-700 transition-colors hover:bg-indigo-500/20 dark:text-indigo-200"
                  >
                    <div className="flex items-center gap-1 font-medium">
                      <Users className="h-3 w-3 shrink-0" />
                      <span className="truncate">{m.title || 'Meeting'}</span>
                    </div>
                    <div className="truncate opacity-80">{timeLabel(m.start)}–{timeLabel(m.end)}</div>
                  </button>
                ))}
                <div className="flex gap-1">
                  <button
                    onClick={() => setAddingDay(d)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" /> Plan
                  </button>
                  <button
                    onClick={() => addMeetingOn(d)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-indigo-400/60 py-1 text-[10px] text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300"
                  >
                    <Users className="h-3 w-3" /> Meeting
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {addingDay !== null && (
        <AddAssignment
          dayTs={addingDay}
          onClose={() => setAddingDay(null)}
          onAdd={(projectId, taskId, hours, note) => {
            addAssignment({ projectId, taskId, hours, note, date: dayStart(addingDay) });
            setAddingDay(null);
          }}
        />
      )}
      {editingMeetingId && (
        <MeetingDialog meetingId={editingMeetingId} onClose={() => setEditingMeetingId(null)} />
      )}
    </div>
  );
}

function AddAssignment({
  dayTs,
  onClose,
  onAdd,
}: {
  dayTs: number;
  onClose: () => void;
  onAdd: (projectId: string | null, taskId: string | null, hours: number, note: string) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [hours, setHours] = useState('4');
  const [note, setNote] = useState('');

  return (
    <Modal open onClose={onClose} title={`Plan work — ${new Date(dayTs).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <ProjectPicker value={projectId} taskValue={taskId} onChange={(p, t) => { setProjectId(p); setTaskId(t); }} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Planned hours</Label>
          <Input type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. design review" />
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onAdd(projectId, taskId, Math.max(0, Number(hours) || 0), note.trim())} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}
