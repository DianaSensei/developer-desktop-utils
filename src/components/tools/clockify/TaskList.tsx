// Tasks tab: a local to-do list on top of the Time Tracker's Task records.
// List view groups open tasks by due date (Overdue → No date); Board view
// is To do / In progress / Done with drag and drop. A task can carry a due
// date (optional time), a reminder (rung app-wide by reminders.tsx),
// priority, project and notes, and starts the timer in one click.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Bell, CalendarDays, Check, Flag, LayoutList, Columns3, Pencil, Play, Plus, Square, Trash2, X,
} from 'lucide-react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { useLocale, useMessages } from '@/contexts/LocaleContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Segmented } from '@/components/ui/segmented';
import { DatePicker } from '@/components/ui/date-picker';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { combineDateTime, toDateISO, toHM } from '@/lib/meetings';
import MESSAGES from './TimeTracker.messages';
import JIRA_MESSAGES from './jira.messages';
import { JiraErrorBanner, JiraKeyChip, JiraTaskSection, JiraToolbar, jiraErrorText } from './JiraPanel';
import { JiraError, parseIssueRef } from './jira';
import { useJira } from './jiraContext';
import { useClockify, type Task } from './store';
import { ColorDot, ConfirmButton } from './ui';
import { dayStart, fmtTotal } from './time';
import {
  PRIORITIES, REMIND_OFFSETS, STATUSES, compareTasks, dueBucket, priorityOf, remindAtFor, statusOf, statusPatch,
  type DueBucket, type TaskPriority, type TaskStatus,
} from './todo';

type Filter = 'open' | 'today' | 'upcoming' | 'done' | 'all';
type View = 'list' | 'board';
type Translate = ReturnType<typeof useMessages<typeof MESSAGES>>;

const BUCKETS: DueBucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  high: 'text-bad',
  medium: 'text-warn',
  low: 'text-info',
  none: 'text-fg-mute/50',
};

function matchesFilter(t: Task, filter: Filter, now: number): boolean {
  const status = statusOf(t);
  if (filter === 'all') return true;
  if (filter === 'done') return status === 'done';
  if (status === 'done') return false;
  if (filter === 'open') return true;
  const bucket = dueBucket(t, now);
  if (filter === 'today') return bucket === 'overdue' || bucket === 'today';
  return bucket === 'tomorrow' || bucket === 'week' || bucket === 'later';
}

export function TaskList({ focusId, onFocused }: { focusId?: string | null; onFocused?: () => void }) {
  const tr = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('task-tracker');
  const { tasks, addTask, updateTask, now } = useClockify();
  const jira = useJira();
  const jm = useMessages(JIRA_MESSAGES);
  const [view, setView] = usePluginState<View>(sdk, 'tasks:view', 'list');
  const [filter, setFilter] = usePluginState<Filter>(sdk, 'tasks:filter', 'open');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // A reminder's "Open" lands here: show the task and open its editor.
  useEffect(() => {
    if (!focusId) return;
    if (tasks.some((t) => t.id === focusId)) {
      setFilter('all');
      setHighlight(focusId);
      setEditing(focusId);
    }
    onFocused?.();
  }, [focusId, tasks, setFilter, onFocused]);

  const visible = useMemo(
    () => tasks.filter((t) => matchesFilter(t, filter, now)).sort(compareTasks),
    [tasks, filter, now]
  );

  // A Jira key or issue URL in the box links that issue instead.
  const jiraRef = jira.connected && jira.config ? parseIssueRef(draft, jira.config.site) : null;
  const [addNote, setAddNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const addFromJira = (key: string) => {
    setAddNote(null);
    jira.addIssue(key)
      .then(({ taskId, existed }) => {
        setDraft('');
        setFilter('all');
        setHighlight(taskId);
        setAddNote({ tone: 'ok', text: existed ? jm('alreadyHere', { key }) : jm('addedIssue', { key }) });
      })
      .catch((e: unknown) => {
        const text = e instanceof JiraError && e.kind === 'notFound' ? jm('issueNotFound', { key }) : jiraErrorText(e, jm);
        setAddNote({ tone: 'bad', text });
      });
  };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (jiraRef) { addFromJira(jiraRef); return; }
    const extra: Partial<Task> = { status: 'todo', priority: 'none' };
    // Adding from Today means "due today" — otherwise it vanishes from view.
    if (filter === 'today') Object.assign(extra, { dueAt: dayStart(Date.now()), dueHasTime: false });
    addTask(name, null, null, extra);
    setDraft('');
  };

  const editingTask = editing ? tasks.find((t) => t.id === editing) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative min-w-[220px] flex-1">
          <Plus className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-mute" />
          <Input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setAddNote(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={jira.connected ? jm('addPlaceholderJira') : tr('todo.addPlaceholder')}
            aria-label={tr('todo.addAria')}
            className={cn('h-ctl pl-8', jiraRef && 'pr-40')}
          />
          {jiraRef && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-info">
              {jm('addByKey', { key: jiraRef })}
            </span>
          )}
        </div>
        <Segmented<Filter>
          size="sm"
          aria-label={tr('todo.filter.all')}
          value={filter}
          onValueChange={setFilter}
          options={(['open', 'today', 'upcoming', 'done', 'all'] as Filter[]).map((f) => ({ value: f, label: tr(`todo.filter.${f}`) }))}
        />
        <Segmented<View>
          size="sm"
          aria-label={tr('todo.view.list')}
          value={view}
          onValueChange={setView}
          options={[
            { value: 'list', icon: LayoutList, title: tr('todo.view.list') },
            { value: 'board', icon: Columns3, title: tr('todo.view.board') },
          ]}
        />
        <JiraToolbar />
      </div>
      <JiraErrorBanner />
      {addNote && (
        <p role={addNote.tone === 'bad' ? 'alert' : 'status'} className={cn('border-b border-line px-3 py-1.5 text-xs', addNote.tone === 'bad' ? 'text-bad' : 'text-fg-mute')}>
          {addNote.text}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {tasks.length === 0 && (
          <EmptyState icon={Check} title={tr('todo.empty.title')} description={tr('todo.empty.body')} className="mt-10" />
        )}
        {tasks.length > 0 && view === 'list' && (
          <ListView tasks={visible} now={now} highlight={highlight} onEdit={setEditing} tr={tr} />
        )}
        {tasks.length > 0 && view === 'board' && (
          <BoardView
            tasks={visible}
            now={now}
            highlight={highlight}
            onEdit={setEditing}
            onMove={(id, status) => updateTask(id, statusPatch(status, Date.now()))}
            tr={tr}
          />
        )}
      </div>

      {/* A side panel, not a modal: the list stays usable (tick, start a
          timer, pick another task) while one is open. */}
      {editingTask && <TaskEditor key={editingTask.id} task={editingTask} onClose={() => setEditing(null)} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ListView({ tasks, now, highlight, onEdit, tr }: {
  tasks: Task[]; now: number; highlight: string | null; onEdit: (id: string) => void; tr: Translate;
}) {
  if (tasks.length === 0) return <p className="px-4 py-8 text-center text-xs text-fg-mute">{tr('todo.empty.filtered')}</p>;
  const open = tasks.filter((t) => statusOf(t) !== 'done');
  const done = tasks.filter((t) => statusOf(t) === 'done');
  const groups = BUCKETS.map((b) => ({ key: b, items: open.filter((t) => dueBucket(t, now) === b) }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="space-y-4 px-3 py-3">
      {groups.map((g) => (
        <TaskGroup key={g.key} title={tr(`todo.bucket.${g.key}`)} tone={g.key === 'overdue' ? 'bad' : undefined} count={g.items.length}>
          {g.items.map((t) => <TaskRow key={t.id} task={t} now={now} highlighted={t.id === highlight} onEdit={() => onEdit(t.id)} />)}
        </TaskGroup>
      ))}
      {done.length > 0 && (
        <TaskGroup title={tr('todo.bucket.done')} count={done.length}>
          {done.map((t) => <TaskRow key={t.id} task={t} now={now} highlighted={t.id === highlight} onEdit={() => onEdit(t.id)} />)}
        </TaskGroup>
      )}
    </div>
  );
}

function TaskGroup({ title, count, tone, children }: { title: string; count: number; tone?: 'bad'; children: ReactNode }) {
  return (
    <section>
      <h3 className={cn('mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide', tone === 'bad' ? 'text-bad' : 'text-fg-mute')}>
        {title}
        <span className="font-normal tabular-nums text-fg-mute">{count}</span>
      </h3>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-card">{children}</ul>
    </section>
  );
}

function useTaskActions(task: Task) {
  const { running, startEntry, stopRunning, updateTask, projectById, entries, now } = useClockify();
  const status = statusOf(task);
  const isRunning = running?.taskId === task.id;
  const tracked = useMemo(
    () => entries.reduce((sum, e) => (e.taskId === task.id ? sum + ((e.end ?? now) - e.start) : sum), 0),
    [entries, task.id, now]
  );
  return {
    status,
    isRunning,
    tracked,
    project: projectById(task.projectId),
    toggleDone: () => updateTask(task.id, statusPatch(status === 'done' ? 'todo' : 'done', Date.now())),
    toggleTimer: () => {
      if (isRunning) { stopRunning(); return; }
      startEntry({ description: task.name, projectId: task.projectId, taskId: task.id });
      if (status === 'todo') updateTask(task.id, statusPatch('doing', Date.now()));
    },
  };
}

function TaskRow({ task, now, highlighted, onEdit }: { task: Task; now: number; highlighted: boolean; onEdit: () => void }) {
  const tr = useMessages(MESSAGES);
  const { deleteTask } = useClockify();
  const { hideIssue } = useJira();
  const a = useTaskActions(task);
  const done = a.status === 'done';
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [highlighted]);
  return (
    <li ref={ref} className={cn('group flex items-center gap-2.5 px-2.5 py-2', highlighted && 'bg-acc-tint')}>
      <Checkbox
        checked={done}
        onCheckedChange={a.toggleDone}
        aria-label={done ? tr('todo.reopen') : tr('todo.complete')}
      />
      <PriorityFlag priority={priorityOf(task)} />
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 rounded-xs text-left focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        title={tr('todo.edit')}
      >
        <span className={cn('block truncate text-sm', done ? 'text-fg-mute line-through' : 'text-fg')}>{task.name}</span>
        <TaskMeta task={task} now={now} project={a.project} tracked={a.tracked} />
      </button>
      <JiraKeyChip task={task} />
      {a.status === 'doing' && !done && (
        <span className="hidden shrink-0 rounded-sm bg-acc-tint px-1.5 py-0.5 text-[11px] font-medium text-acc-ink @lg:inline">
          {tr('todo.status.doing')}
        </span>
      )}
      {!done && (
        <Button
          variant="ghost"
          size="icon"
          className={cn('shrink-0', a.isRunning ? 'text-[var(--live)]' : 'text-fg-mute')}
          onClick={a.toggleTimer}
          title={a.isRunning ? tr('todo.stop') : tr('todo.start')}
          aria-label={a.isRunning ? tr('todo.stop') : tr('todo.start')}
        >
          {a.isRunning ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
      )}
      <ConfirmButton onConfirm={() => { if (task.jira) hideIssue(task.jira.key); deleteTask(task.id); }} title={tr('todo.delete')}>
        <Trash2 className="h-3.5 w-3.5" />
      </ConfirmButton>
    </li>
  );
}

function PriorityFlag({ priority }: { priority: TaskPriority }) {
  const tr = useMessages(MESSAGES);
  if (priority === 'none') return <span className="w-3.5 shrink-0" aria-hidden="true" />;
  return (
    <Flag
      className={cn('h-3.5 w-3.5 shrink-0', PRIORITY_CLASS[priority], priority === 'high' && 'fill-current')}
      aria-label={`${tr('todo.priority')}: ${tr(`todo.priority.${priority}`)}`}
    />
  );
}

function TaskMeta({ task, now, project, tracked }: {
  task: Task; now: number; project?: { name: string; color: string }; tracked: number;
}) {
  const tr = useMessages(MESSAGES);
  const { locale } = useLocale();
  const bucket = dueBucket(task, now);
  const done = statusOf(task) === 'done';
  const parts: ReactNode[] = [];
  if (task.dueAt != null) {
    parts.push(
      <span key="due" className={cn('inline-flex items-center gap-1', !done && bucket === 'overdue' && 'text-bad', !done && bucket === 'today' && 'text-acc-ink')}>
        <CalendarDays className="h-3 w-3" />
        {dueLabel(task, now, locale, tr)}
      </span>
    );
  }
  if (task.remindAt != null && !done) {
    const time = fmtDateTime(task.remindAt, now, locale);
    parts.push(
      <span key="remind" className="inline-flex items-center gap-1" title={tr('todo.reminderSet', { time })}>
        <Bell className="h-3 w-3" />
        <span className="sr-only">{tr('todo.reminderSet', { time })}</span>
      </span>
    );
  }
  if (project) {
    parts.push(
      <span key="project" className="inline-flex min-w-0 items-center gap-1">
        <ColorDot color={project.color} className="h-2 w-2" />
        <span className="truncate">{project.name}</span>
      </span>
    );
  }
  if (tracked >= 60_000) parts.push(<span key="tracked" className="tabular-nums">{tr('todo.tracked', { t: fmtTotal(tracked) })}</span>);
  if (task.notes?.trim()) parts.push(<Pencil key="notes" className="h-3 w-3" aria-hidden="true" />);
  if (parts.length === 0) return null;
  return <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-fg-mute">{parts}</span>;
}

function fmtDateTime(ts: number, now: number, locale: string): string {
  const sameDay = dayStart(ts) === dayStart(now);
  const time = new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return `${new Date(ts).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

function dueLabel(task: Task, now: number, locale: string, tr: Translate): string {
  if (task.dueAt == null) return '';
  const bucket = dueBucket(task, now);
  const time = task.dueHasTime ? ` ${new Date(task.dueAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}` : '';
  if (bucket === 'today') return tr('todo.bucket.today') + time;
  if (bucket === 'tomorrow') return tr('todo.bucket.tomorrow') + time;
  const sameYear = new Date(task.dueAt).getFullYear() === new Date(now).getFullYear();
  const date = new Date(task.dueAt).toLocaleDateString(locale, {
    weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
  return date + time;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function BoardView({ tasks, now, highlight, onEdit, onMove, tr }: {
  tasks: Task[]; now: number; highlight: string | null;
  onEdit: (id: string) => void; onMove: (id: string, status: TaskStatus) => void; tr: Translate;
}) {
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Pointer-driven drag: Tauri intercepts native drag gestures for OS file
  // drops, so HTML5 drag events never reach the webview (same as the Text
  // Editor's Explorer and the API Client's tree). Columns carry `data-drop-status`.
  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let target: TaskStatus | null = null;
    const onPointerMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
        dragging = true;
        setDragId(id);
        document.body.style.setProperty('user-select', 'none');
        document.body.style.setProperty('cursor', 'grabbing');
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drop-status]');
      target = (el?.dataset.dropStatus as TaskStatus | undefined) ?? null;
      setOver(target);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('keydown', onKey);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
      setDragId(null);
      setOver(null);
    };
    const onPointerUp = () => {
      cleanup();
      if (!dragging) return;
      // The release also clicks whatever is under the pointer (the card's
      // title opens the editor); swallow that one click.
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (target) onMove(id, target);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { target = null; cleanup(); } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('keydown', onKey);
  };

  return (
    <div className="grid h-full min-h-[320px] grid-cols-1 gap-3 p-3 @2xl:grid-cols-3">
      {STATUSES.map((status) => {
        const items = tasks.filter((t) => statusOf(t) === status);
        return (
          <section
            key={status}
            aria-label={tr(`todo.status.${status}`)}
            data-drop-status={status}
            className={cn(
              'flex min-h-0 flex-col rounded-md border bg-sunk p-2 transition-colors',
              over === status ? 'border-acc-edge bg-acc-tint' : 'border-line'
            )}
          >
            <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
              {tr(`todo.status.${status}`)}
              <span className="font-normal tabular-nums">{items.length}</span>
            </h3>
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
              {items.map((t) => (
                <BoardCard
                  key={t.id}
                  task={t}
                  now={now}
                  highlighted={t.id === highlight}
                  dragging={t.id === dragId}
                  onPointerDown={(e) => startDrag(e, t.id)}
                  onEdit={() => onEdit(t.id)}
                  onMove={(s) => onMove(t.id, s)}
                />
              ))}
              {items.length === 0 && (
                <li className="rounded-sm border border-dashed border-line px-2 py-4 text-center text-[11px] text-fg-mute">{tr('todo.dropHere')}</li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ task, now, highlighted, dragging, onPointerDown, onEdit, onMove }: {
  task: Task; now: number; highlighted: boolean; dragging: boolean;
  onPointerDown: (e: ReactPointerEvent) => void; onEdit: () => void; onMove: (s: TaskStatus) => void;
}) {
  const tr = useMessages(MESSAGES);
  const a = useTaskActions(task);
  const done = a.status === 'done';
  return (
    <li
      onPointerDown={onPointerDown}
      className={cn(
        'cursor-grab touch-none rounded-sm border border-line bg-card p-2 shadow-soft',
        highlighted && 'border-acc-edge',
        dragging && 'opacity-50'
      )}
    >
      <div className="flex items-start gap-1.5">
        <PriorityFlag priority={priorityOf(task)} />
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 rounded-xs text-left focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
          title={tr('todo.edit')}
        >
          <span className={cn('block break-words text-sm', done ? 'text-fg-mute line-through' : 'text-fg')}>{task.name}</span>
          <TaskMeta task={task} now={now} project={a.project} tracked={a.tracked} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-0.5">
        <span className="mr-auto"><JiraKeyChip task={task} /></span>
        {/* Keyboard alternative to drag and drop. */}
        <Select value={a.status} onValueChange={(v) => onMove(v as TaskStatus)}>
          <SelectTrigger aria-label={tr('todo.moveTo')} className="h-ctl w-auto gap-1 border-transparent bg-transparent px-2 text-[11px] shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{tr(`todo.status.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        {!done && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('shrink-0', a.isRunning ? 'text-[var(--live)]' : 'text-fg-mute')}
            onClick={a.toggleTimer}
            title={a.isRunning ? tr('todo.stop') : tr('todo.start')}
            aria-label={a.isRunning ? tr('todo.stop') : tr('todo.start')}
          >
            {a.isRunning ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

type RemindChoice = 'none' | 'custom' | `${(typeof REMIND_OFFSETS)[number]}`;

/** Which preset a saved reminder matches, so the editor shows "1 hour before"
 *  instead of a raw time. */
function remindChoiceOf(t: Pick<Task, 'dueAt' | 'dueHasTime' | 'remindAt'>): RemindChoice {
  if (t.remindAt == null) return 'none';
  const hit = REMIND_OFFSETS.find((off) => remindAtFor(t, off) === t.remindAt);
  return hit === undefined ? 'custom' : (String(hit) as RemindChoice);
}

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const tr = useMessages(MESSAGES);
  const { projects, updateTask, deleteTask } = useClockify();
  const { hideIssue } = useJira();
  const jm = useMessages(JIRA_MESSAGES);
  const [name, setName] = useState(task.name);
  const [status, setStatus] = useState<TaskStatus>(statusOf(task));
  const [priority, setPriority] = useState<TaskPriority>(priorityOf(task));
  const [projectId, setProjectId] = useState<string | null>(task.projectId);
  const [dueDate, setDueDate] = useState(task.dueAt != null ? toDateISO(task.dueAt) : '');
  const [dueTime, setDueTime] = useState<string | null>(task.dueAt != null && task.dueHasTime ? toHM(task.dueAt) : null);
  const [remind, setRemind] = useState<RemindChoice>(remindChoiceOf(task));
  const [customRemind, setCustomRemind] = useState<number>(task.remindAt ?? Date.now() + 60 * 60_000);
  const [notes, setNotes] = useState(task.notes ?? '');

  const due = useMemo(() => {
    if (!dueDate) return { dueAt: null, dueHasTime: false };
    const at = combineDateTime(dueDate, dueTime ?? '00:00');
    return { dueAt: at, dueHasTime: at != null && dueTime != null };
  }, [dueDate, dueTime]);

  let remindAt: number | null = null;
  if (remind === 'custom') remindAt = customRemind;
  else if (remind !== 'none') remindAt = remindAtFor(due, Number(remind));

  const save = () => {
    const patch: Partial<Task> = {
      name: name.trim() || task.name,
      priority,
      projectId,
      dueAt: due.dueAt,
      dueHasTime: due.dueHasTime,
      remindAt,
      notes,
    };
    Object.assign(patch, status === statusOf(task) ? {} : statusPatch(status, Date.now()));
    updateTask(task.id, patch);
    onClose();
  };

  const activeProjects = projects.filter((p) => !p.archived || p.id === task.projectId);

  return (
    <aside
      aria-label={tr('todo.edit')}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className={cn(
        'flex w-[400px] max-w-full shrink-0 flex-col border-l border-line bg-card',
        // Narrow windows: overlay the list instead of squeezing it.
        '@max-3xl:absolute @max-3xl:inset-y-0 @max-3xl:right-0 @max-3xl:z-20 @max-3xl:shadow-lift',
      )}
    >
      <div className="flex h-ctl shrink-0 items-center gap-2 border-b border-line px-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{tr('todo.edit')}</h3>
        <Button variant="ghost" size="icon" className="text-fg-mute" onClick={onClose} title={tr('cancel')} aria-label={tr('cancel')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <form
        className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3"
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <Field label={tr('todo.name')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={tr('todo.name')}
            className="h-ctl"
            autoFocus={!task.jira}
            readOnly={!!task.jira}
          />
          {task.jira && <p className="text-[11px] text-fg-mute">{jm('nameFromJira')}</p>}
        </Field>

        {task.jira && <JiraTaskSection task={task} />}

        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Field label={tr('todo.status')}>
            <Segmented<TaskStatus>
              size="sm"
              aria-label={tr('todo.status')}
              value={status}
              onValueChange={setStatus}
              options={STATUSES.map((s) => ({ value: s, label: tr(`todo.status.${s}`) }))}
            />
          </Field>
          <Field label={tr('todo.priority')}>
            <Segmented<TaskPriority>
              size="sm"
              aria-label={tr('todo.priority')}
              value={priority}
              onValueChange={setPriority}
              options={[...PRIORITIES].reverse().map((p) => ({ value: p, label: tr(`todo.priority.${p}`) }))}
            />
          </Field>
        </div>

        <Field label={tr('todo.project')}>
          <Select value={projectId ?? 'none'} onValueChange={(v) => setProjectId(v === 'none' ? null : v)}>
            <SelectTrigger aria-label={tr('todo.project')} className="h-ctl text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tr('todo.noProject')}</SelectItem>
              {activeProjects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="inline-flex items-center gap-2"><ColorDot color={p.color} />{p.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={tr('todo.due')}>
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={dueDate} onChange={setDueDate} placeholder={tr('todo.noDue')} className="w-44" />
            {dueDate && dueTime == null && (
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setDueTime('17:00')}>{tr('todo.addTime')}</Button>
            )}
            {dueDate && dueTime != null && (
              <>
                <TimePicker value={dueTime} onChange={setDueTime} />
                <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setDueTime(null)}>{tr('todo.removeTime')}</Button>
              </>
            )}
            {dueDate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-fg-mute"
                onClick={() => { setDueDate(''); setDueTime(null); if (remind !== 'custom') setRemind('none'); }}
              >
                {tr('todo.clearDue')}
              </Button>
            )}
          </div>
        </Field>

        <Field label={tr('todo.reminder')}>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={remind} onValueChange={(v) => setRemind(v as RemindChoice)}>
              <SelectTrigger aria-label={tr('todo.reminder')} className="h-ctl w-52 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tr('todo.remind.none')}</SelectItem>
                {REMIND_OFFSETS.map((off) => (
                  <SelectItem key={off} value={String(off)} disabled={due.dueAt == null}>
                    {tr(`todo.remind.${off}` as 'todo.remind.0')}
                  </SelectItem>
                ))}
                <SelectItem value="custom">{tr('todo.remind.custom')}</SelectItem>
              </SelectContent>
            </Select>
            {remind === 'custom' && <DateTimePicker value={customRemind} onChange={setCustomRemind} />}
          </div>
          {remind !== 'none' && remind !== 'custom' && due.dueAt != null && !due.dueHasTime && (
            <p className="mt-1 text-[11px] text-fg-mute">{tr('todo.remindDateOnly')}</p>
          )}
          {remindAt != null && remindAt < Date.now() && statusOf(task) !== 'done' && (
            <p className="mt-1 text-[11px] text-warn">{tr('todo.remindPast')}</p>
          )}
        </Field>

        <Field label={tr('todo.notes')}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={tr('todo.notesPlaceholder')}
            aria-label={tr('todo.notes')}
            rows={4}
            className="text-sm"
          />
        </Field>

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <ConfirmButton onConfirm={() => { if (task.jira) hideIssue(task.jira.key); deleteTask(task.id); onClose(); }} title={tr('todo.delete')}>
            <Trash2 className="h-3.5 w-3.5" />
          </ConfirmButton>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" size="sm">{tr('todo.save')}</Button>
        </div>
      </form>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-fg-mute">{label}</span>
      {children}
    </div>
  );
}
