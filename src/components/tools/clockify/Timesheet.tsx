import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useClockify } from './store';
import { ColorDot, DurationInput, ProjectPicker } from './ui';
import { addDays, fmtHM, sameDay, weekDays, weekRangeLabel, weekStart, weekdayShort } from './time';

const comboKey = (p: string | null, t: string | null) => `${p ?? 'none'}|${t ?? 'none'}`;

export function Timesheet() {
  const { entries, settings, projectById, taskById, setDayTotal, now } = useClockify();
  const [anchor, setAnchor] = useState(() => now);
  const [extraRows, setExtraRows] = useState<Array<{ p: string | null; t: string | null }>>([]);

  const days = useMemo(() => weekDays(anchor, settings.weekStartsMon), [anchor, settings.weekStartsMon]);
  const ws = weekStart(anchor, settings.weekStartsMon);
  const we = addDays(ws, 7);

  // rows = distinct project/task combos with entries this week, plus manually-added rows
  const rows = useMemo(() => {
    const map = new Map<string, { p: string | null; t: string | null }>();
    for (const e of entries) {
      if (e.start >= ws && e.start < we) {
        map.set(comboKey(e.projectId, e.taskId), { p: e.projectId, t: e.taskId });
      }
    }
    for (const r of extraRows) map.set(comboKey(r.p, r.t), r);
    return [...map.values()];
  }, [entries, ws, we, extraRows]);

  // duration per combo per day
  const cell = (p: string | null, t: string | null, dayTs: number) =>
    entries
      .filter((e) => e.projectId === p && e.taskId === t && e.end !== null && sameDay(e.start, dayTs))
      .reduce((s, e) => s + (e.end! - e.start), 0);

  const dayTotal = (dayTs: number) =>
    entries.filter((e) => e.end !== null && sameDay(e.start, dayTs)).reduce((s, e) => s + (e.end! - e.start), 0);

  const rowTotal = (p: string | null, t: string | null) =>
    days.reduce((s, d) => s + cell(p, t, d), 0);

  const grandTotal = days.reduce((s, d) => s + dayTotal(d), 0);

  return (
    <div className="flex h-full flex-col">
      {/* Week nav */}
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor((a) => addDays(a, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(now)}>
          Today
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAnchor((a) => addDays(a, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium">{weekRangeLabel(anchor, settings.weekStartsMon)}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Week total <span className="font-mono tabular-nums text-foreground">{fmtHM(grandTotal)}</span>
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-56 bg-background px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                Project / Task
              </th>
              {days.map((d) => (
                <th key={d} className={cn('px-1 py-2 text-center text-xs font-medium', sameDay(d, now) ? 'text-foreground' : 'text-muted-foreground')}>
                  <div>{weekdayShort(d)}</div>
                  <div className="font-normal opacity-70">{new Date(d).getDate()}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-xs text-muted-foreground">
                  No rows yet. Add a project row below or track time in the Time Tracker.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const project = projectById(r.p);
              const task = taskById(r.t);
              return (
                <tr key={comboKey(r.p, r.t)} className="group">
                  <td className="sticky left-0 z-10 bg-background px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <ColorDot color={project?.color} />
                      <span className={cn('truncate text-sm', !project && 'text-muted-foreground')}>
                        {project ? project.name : 'No project'}
                        {task ? ` · ${task.name}` : ''}
                      </span>
                    </div>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="px-0.5 py-1">
                      <DurationInput ms={cell(r.p, r.t, d)} onCommit={(ms) => setDayTotal(r.p, r.t, d, ms)} className="h-8 w-full" />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center font-mono text-sm tabular-nums">{fmtHM(rowTotal(r.p, r.t))}</td>
                </tr>
              );
            })}
            {/* day totals */}
            <tr>
              <td className="sticky left-0 z-10 bg-background px-2 py-2 text-xs font-medium text-muted-foreground">Daily total</td>
              {days.map((d) => (
                <td key={d} className="px-1 py-2 text-center font-mono text-xs tabular-nums text-muted-foreground">
                  {fmtHM(dayTotal(d))}
                </td>
              ))}
              <td className="px-2 py-2 text-center font-mono text-sm font-semibold tabular-nums">{fmtHM(grandTotal)}</td>
            </tr>
          </tbody>
        </table>

        {/* Add row */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Add row:</span>
          <ProjectPicker
            value={null}
            onChange={(p, t) => {
              if (!rows.some((r) => comboKey(r.p, r.t) === comboKey(p, t))) {
                setExtraRows((prev) => [...prev, { p, t }]);
              }
            }}
            compact
          />
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
