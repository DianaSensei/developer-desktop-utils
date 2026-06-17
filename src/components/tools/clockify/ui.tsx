import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, DollarSign, Plus, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useClockify } from './store';
import { fmtHM, parseDuration } from './time';

// ---------------------------------------------------------------------------
// Modal — lightweight portal dialog (no extra dependency)
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <div
        className={cn('w-full rounded-lg border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95 duration-100', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Popover — anchored floating panel that closes on outside click / Escape
// ---------------------------------------------------------------------------

export function Popover({
  trigger,
  children,
  align = 'left',
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed-viewport coordinates so the panel escapes any scroll/overflow ancestor.
  const [pos, setPos] = useState<{ top: number; left: number; right: number; width: number } | null>(null);

  // Anchor the panel to the trigger; keep it in sync while open (scroll/resize).
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, right: window.innerWidth - r.right, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // capture → catches inner scroll containers
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Clamp into the viewport so a long panel near the bottom stays visible.
  useLayoutEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    const h = panelRef.current.offsetHeight;
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    if (pos.top > maxTop) setPos((p) => (p && p.top !== maxTop ? { ...p, top: maxTop } : p));
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={triggerRef} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: align === 'right' ? undefined : pos.left,
            right: align === 'right' ? pos.right : undefined,
            minWidth: pos.width,
          }}
          className={cn(
            'z-[9999] min-w-[200px] rounded-md border bg-popover p-1.5 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100',
            className
          )}
        >
          {children(() => setOpen(false))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle — pill switch
// ---------------------------------------------------------------------------

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  const btn = (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-background transition-transform', checked ? 'translate-x-3.5' : 'translate-x-0.5')} />
    </button>
  );
  if (!label) return btn;
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {btn}
    </label>
  );
}

// ---------------------------------------------------------------------------
// ColorDot
// ---------------------------------------------------------------------------

export function ColorDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color ?? 'hsl(var(--muted-foreground))' }}
    />
  );
}

// ---------------------------------------------------------------------------
// ConfirmButton — two-step destructive action (no window.confirm)
// ---------------------------------------------------------------------------

export function ConfirmButton({
  onConfirm,
  children,
  className,
  title,
}: {
  onConfirm: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          onConfirm();
          setArmed(false);
        } else setArmed(true);
      }}
      className={cn(
        'transition-colors',
        armed ? 'text-red-500' : 'text-muted-foreground hover:text-red-500',
        className
      )}
    >
      {armed ? <Check className="h-3.5 w-3.5" /> : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ProjectPicker — select an existing project, none, or quick-create
// ---------------------------------------------------------------------------

export function ProjectPicker({
  value,
  taskValue,
  onChange,
  compact,
}: {
  value: string | null;
  taskValue?: string | null;
  onChange: (projectId: string | null, taskId: string | null) => void;
  compact?: boolean;
}) {
  const { projects, tasks, projectById, taskById, addProject, addTask } = useClockify();
  const [creating, setCreating] = useState('');
  const project = projectById(value);
  const task = taskById(taskValue ?? null);
  const active = projects.filter((p) => !p.archived);

  return (
    <Popover
      align="left"
      className="min-w-[240px]"
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors hover:bg-muted',
            compact ? 'h-7' : 'h-9'
          )}
        >
          <ColorDot color={project?.color} />
          <span className={cn('truncate', !project && 'text-muted-foreground')}>
            {project ? project.name : 'No project'}
            {task ? ` · ${task.name}` : ''}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-80 w-60 overflow-y-auto">
          <button
            onClick={() => { onChange(null, null); close(); }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <ColorDot /> No project
          </button>
          {active.map((p) => {
            const projTasks = tasks.filter((t) => t.projectId === p.id && !t.completed);
            return (
              <div key={p.id}>
                <button
                  onClick={() => { onChange(p.id, null); close(); }}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted', value === p.id && !taskValue && 'bg-foreground/10')}
                >
                  <ColorDot color={p.color} />
                  <span className="truncate">{p.name}</span>
                </button>
                {projTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { onChange(p.id, t.id); close(); }}
                    className={cn('flex w-full items-center gap-2 rounded py-1 pl-7 pr-2 text-xs text-muted-foreground hover:bg-muted', taskValue === t.id && 'bg-foreground/10 text-foreground')}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            );
          })}
          <div className="mt-1 flex items-center gap-1 border-t pt-1.5">
            <Input
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && creating.trim()) {
                  const p = addProject(creating.trim());
                  onChange(p.id, null);
                  setCreating('');
                  close();
                }
              }}
              placeholder="New project…"
              className="h-7 text-xs"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() => {
                if (!creating.trim()) return;
                const p = addProject(creating.trim());
                onChange(p.id, null);
                setCreating('');
                close();
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {value && (
            <CreateTaskRow
              onCreate={(name) => {
                const t = addTask(name, value);
                onChange(value, t.id);
                close();
              }}
            />
          )}
        </div>
      )}
    </Popover>
  );
}

function CreateTaskRow({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="flex items-center gap-1 pt-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onCreate(name.trim());
            setName('');
          }
        }}
        placeholder="New task in project…"
        className="h-7 pl-7 text-xs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TagPicker — multi-select tags with quick-create
// ---------------------------------------------------------------------------

export function TagPicker({ value, onChange, compact }: { value: string[]; onChange: (ids: string[]) => void; compact?: boolean }) {
  const { tags, addTag } = useClockify();
  const [creating, setCreating] = useState('');
  const selected = tags.filter((t) => value.includes(t.id));

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <Popover
      align="left"
      trigger={({ toggle: t }) => (
        <button
          onClick={t}
          className={cn('flex items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors hover:bg-muted', compact ? 'h-7' : 'h-9')}
        >
          <TagIcon className="h-3.5 w-3.5 opacity-60" />
          <span className={cn('truncate', !selected.length && 'text-muted-foreground')}>
            {selected.length ? selected.map((t) => t.name).join(', ') : 'Tags'}
          </span>
        </button>
      )}
    >
      {() => (
        <div className="max-h-72 w-52 overflow-y-auto">
          {tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet</p>}
          {tags.map((t) => (
            <button key={t.id} onClick={() => toggle(t.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', value.includes(t.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                {value.includes(t.id) && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="truncate">{t.name}</span>
            </button>
          ))}
          <div className="mt-1 flex items-center gap-1 border-t pt-1.5">
            <Input
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && creating.trim()) {
                  const tag = addTag(creating.trim());
                  if (!value.includes(tag.id)) onChange([...value, tag.id]);
                  setCreating('');
                }
              }}
              placeholder="New tag…"
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// BillableToggle — small $ button
// ---------------------------------------------------------------------------

export function BillableButton({ value, onChange, compact }: { value: boolean; onChange: (v: boolean) => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title={value ? 'Billable' : 'Non-billable'}
      className={cn(
        'flex items-center justify-center rounded-md border transition-colors',
        compact ? 'h-7 w-7' : 'h-9 w-9',
        value ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:bg-muted'
      )}
    >
      <DollarSign className="h-4 w-4" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// DurationInput — commits a parsed duration (ms) on blur / Enter
// ---------------------------------------------------------------------------

export function DurationInput({
  ms,
  onCommit,
  className,
  placeholder = '0:00',
}: {
  ms: number;
  onCommit: (ms: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (ms > 0 ? fmtHM(ms) : '');

  const commit = () => {
    if (draft === null) return;
    const parsed = parseDuration(draft);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };

  return (
    <Input
      value={display}
      placeholder={placeholder}
      onFocus={() => setDraft(ms > 0 ? fmtHM(ms) : '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className={cn('text-center font-mono tabular-nums', className)}
    />
  );
}
