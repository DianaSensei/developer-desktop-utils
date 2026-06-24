import { useState } from 'react';
import {
  Clock,
  CalendarDays,
  LayoutGrid,
  Settings as SettingsIcon,
  FolderKanban,
  Plus,
  Trash2,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ClockifyProvider, PROJECT_COLORS, useClockify } from './store';
import { ConfirmButton, Modal, NumberStepper, Toggle } from './ui';
import { TimePicker } from '@/components/ui/time-picker';
import { fmtTimer, workHoursForRanges } from './time';
import { TimeTracker } from './TimeTracker';
import { Timesheet } from './Timesheet';
import { CalendarView } from './CalendarView';

type TabId = 'tracker' | 'timesheet' | 'calendar';

const TABS: { id: TabId; label: string; icon: typeof Clock; render: () => JSX.Element }[] = [
  { id: 'tracker', label: 'Time Tracker', icon: Clock, render: () => <TimeTracker /> },
  { id: 'timesheet', label: 'Timesheet', icon: LayoutGrid, render: () => <Timesheet /> },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays, render: () => <CalendarView /> },
];

function SuiteInner() {
  const { running, now, stopRunning, projectById } = useClockify();
  const [tab, setTab] = useState<TabId>('tracker');
  const [showProjects, setShowProjects] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const active = TABS.find((t) => t.id === tab)!;
  const runningProject = projectById(running?.projectId ?? null);

  return (
    <div className="flex h-full flex-col">
      {/* Header: tabs + actions */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  tab === t.id ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Mini running indicator (visible from any tab) */}
        {running && tab !== 'tracker' && (
          <button
            onClick={() => setTab('tracker')}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-500"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono tabular-nums">{fmtTimer(now - running.start)}</span>
            <span className="max-w-[120px] truncate">{running.description || runningProject?.name || 'Tracking'}</span>
            <Square
              className="h-3 w-3 fill-current"
              onClick={(e) => { e.stopPropagation(); stopRunning(); }}
            />
          </button>
        )}

        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Projects" onClick={() => setShowProjects(true)}>
          <FolderKanban className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Settings" onClick={() => setShowSettings(true)}>
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Active tab */}
      <div className="min-h-0 flex-1">{active.render()}</div>

      {showProjects && <ProjectManager onClose={() => setShowProjects(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function ProjectManager({ onClose }: { onClose: () => void }) {
  const { projects, addProject, updateProject, deleteProject } = useClockify();
  const [name, setName] = useState('');

  return (
    <Modal open onClose={onClose} title="Projects" width="max-w-lg">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { addProject(name.trim()); setName(''); } }}
            placeholder="New project name…"
            className="h-9 flex-1"
          />
          <Button size="sm" className="gap-1.5" onClick={() => { if (name.trim()) { addProject(name.trim()); setName(''); } }}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border border-border">
          {projects.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">No projects yet.</p>}
          {projects.map((p) => (
            <div key={p.id} className={cn('flex items-center gap-2 px-2.5 py-2', p.archived && 'opacity-50')}>
              <ColorMenu color={p.color} onPick={(c) => updateProject(p.id, { color: c })} />
              <Input value={p.name} onChange={(e) => updateProject(p.id, { name: e.target.value })} className="h-8 flex-1 text-sm rounded-lg" />
              <button
                onClick={() => updateProject(p.id, { archived: !p.archived })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {p.archived ? 'restore' : 'archive'}
              </button>
              <ConfirmButton onConfirm={() => deleteProject(p.id)} title="Delete project">
                <Trash2 className="h-3.5 w-3.5" />
              </ConfirmButton>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Deleting a project keeps its time entries but unassigns them.</p>
      </div>
    </Modal>
  );
}

function ColorMenu({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="h-4 w-4 rounded-full ring-1 ring-border" style={{ backgroundColor: color }} />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 grid w-40 grid-cols-8 gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
            {PROJECT_COLORS.map((c) => (
              <button key={c} onClick={() => { onPick(c); setOpen(false); }} className="h-4 w-4 rounded-full" style={{ backgroundColor: c }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useClockify();

  // Daily target is derived from the work-hours ranges so the rest of the suite stays consistent.
  const dailyTarget = workHoursForRanges(settings.workStart, settings.lunchStart, settings.lunchEnd, settings.workEnd);
  const setWorkHours = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    updateSettings({ ...patch, dailyTargetHours: workHoursForRanges(next.workStart, next.lunchStart, next.lunchEnd, next.workEnd) });
  };

  return (
    <Modal open onClose={onClose} title="Settings">
      <div className="space-y-4">
        <section className="space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">General</h4>
          <Toggle label="Week starts Monday" checked={settings.weekStartsMon} onChange={(v) => updateSettings({ weekStartsMon: v })} />
        </section>

        <section className="space-y-2.5 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work hours</h4>
            <span className="text-[11px] text-muted-foreground">
              Target <span className="font-mono font-medium text-foreground">{dailyTarget}h</span>/day
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Work (before lunch)</span>
            <div className="flex items-center gap-1.5">
              <TimePicker value={settings.workStart} onChange={(v) => setWorkHours({ workStart: v })} />
              <span className="text-muted-foreground">–</span>
              <TimePicker value={settings.lunchStart} onChange={(v) => setWorkHours({ lunchStart: v })} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Lunch break</span>
            <div className="flex items-center gap-1.5">
              <TimePicker value={settings.lunchStart} onChange={(v) => setWorkHours({ lunchStart: v })} />
              <span className="text-muted-foreground">–</span>
              <TimePicker value={settings.lunchEnd} onChange={(v) => setWorkHours({ lunchEnd: v })} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Work (after lunch)</span>
            <div className="flex items-center gap-1.5">
              <TimePicker value={settings.lunchEnd} onChange={(v) => setWorkHours({ lunchEnd: v })} />
              <span className="text-muted-foreground">–</span>
              <TimePicker value={settings.workEnd} onChange={(v) => setWorkHours({ workEnd: v })} />
            </div>
          </div>
        </section>

        <section className="space-y-2.5 border-t border-border pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pomodoro</h4>
          <Toggle label="Enable Pomodoro indicator" checked={settings.pomodoro} onChange={(v) => updateSettings({ pomodoro: v })} />
          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Work (min)</span>
            <NumberStepper value={settings.workMinutes} min={1} max={180} onChange={(v) => updateSettings({ workMinutes: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Break (min)</span>
            <NumberStepper value={settings.breakMinutes} min={1} max={120} onChange={(v) => updateSettings({ breakMinutes: v })} />
          </label>
          <Toggle label="Phase chime" checked={settings.sound} onChange={(v) => updateSettings({ sound: v })} />
        </section>

        <div className="flex justify-end border-t border-border pt-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ClockifySuite() {
  return (
    <ClockifyProvider>
      <SuiteInner />
    </ClockifyProvider>
  );
}
