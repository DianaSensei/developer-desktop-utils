import { useMemo, useState } from 'react';
import { Plus, Trash2, Plane, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { cn } from '@/lib/utils';
import { PROJECT_COLORS, useClockify, type TimeOffPolicy } from './store';
import { ConfirmButton, Modal } from './ui';
import { dayLabel, parseDateInput, toDateInput, workingDaysBetween } from './time';

export function TimeOff() {
  const { policies, timeOff, addTimeOff, deleteTimeOff, addPolicy, updatePolicy, deletePolicy, now } = useClockify();
  const [requesting, setRequesting] = useState(false);
  const [managing, setManaging] = useState(false);

  const year = new Date(now).getFullYear();
  const usedDays = (policyId: string) =>
    timeOff
      .filter((r) => r.policyId === policyId && new Date(r.start).getFullYear() === year)
      .reduce((s, r) => s + workingDaysBetween(r.start, r.end), 0);

  const sorted = useMemo(() => [...timeOff].sort((a, b) => b.start - a.start), [timeOff]);
  const policyById = (id: string) => policies.find((p) => p.id === id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <span className="text-sm font-medium">Time off · {year}</span>
        <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={() => setManaging(true)}>
          <Settings2 className="h-4 w-4" /> Policies
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => setRequesting(true)} disabled={policies.length === 0}>
          <Plus className="h-4 w-4" /> Request
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Balances */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {policies.map((p) => {
            const used = usedDays(p.id);
            return (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tabular-nums">{used}</span>
                  <span className="text-xs text-muted-foreground">
                    {used === 1 ? 'day taken' : 'days taken'} in {year}
                  </span>
                </div>
              </div>
            );
          })}
          {policies.length === 0 && (
            <p className="col-span-full py-6 text-center text-xs text-muted-foreground">No policies. Add one to start requesting time off.</p>
          )}
        </div>

        {/* Requests */}
        <h3 className="mb-2 mt-5 text-sm font-medium">Requests</h3>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground">
            <Plane className="h-8 w-8 opacity-30" />
            <p className="text-sm">No time off booked.</p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {sorted.map((r) => {
              const p = policyById(r.policyId);
              const days = workingDaysBetween(r.start, r.end);
              const upcoming = r.end >= now;
              return (
                <div key={r.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p?.color ?? '#64748b' }} />
                  <span className="w-24 shrink-0 truncate text-xs font-medium">{p?.name ?? 'Time off'}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {dayLabel(r.start)}
                    {r.end !== r.start && ` → ${dayLabel(r.end)}`}
                    {r.note && <span className="ml-2 text-muted-foreground">· {r.note}</span>}
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', upcoming ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground')}>
                    {upcoming ? 'upcoming' : 'taken'}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{days} {days === 1 ? 'day' : 'days'}</span>
                  <ConfirmButton onConfirm={() => deleteTimeOff(r.id)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </ConfirmButton>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {requesting && (
        <RequestModal
          policies={policies}
          defaultDate={now}
          onClose={() => setRequesting(false)}
          onSubmit={(policyId, start, end, note) => {
            addTimeOff({ policyId, start, end, note });
            setRequesting(false);
          }}
        />
      )}
      {managing && (
        <PolicyModal
          policies={policies}
          onClose={() => setManaging(false)}
          onAdd={(name, color, balance) => addPolicy(name, color, balance)}
          onUpdate={updatePolicy}
          onDelete={deletePolicy}
        />
      )}
    </div>
  );
}

function RequestModal({
  policies,
  defaultDate,
  onClose,
  onSubmit,
}: {
  policies: TimeOffPolicy[];
  defaultDate: number;
  onClose: () => void;
  onSubmit: (policyId: string, start: number, end: number, note: string) => void;
}) {
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '');
  const [startStr, setStartStr] = useState(toDateInput(defaultDate));
  const [endStr, setEndStr] = useState(toDateInput(defaultDate));
  const [note, setNote] = useState('');

  const submit = () => {
    const start = parseDateInput(startStr);
    let end = parseDateInput(endStr);
    if (start === null || end === null || !policyId) return;
    if (end < start) end = start;
    onSubmit(policyId, start, end, note.trim());
  };

  return (
    <Modal open onClose={onClose} title="Request time off">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Policy</Label>
          <Select value={policyId} onValueChange={setPolicyId}>
            <SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger>
            <SelectContent className="z-[9999]">
              {policies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">From</Label>
            <DatePicker value={startStr} onChange={setStartStr} className="w-full" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">To</Label>
            <DatePicker value={endStr} onChange={setEndStr} className="w-full" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. family trip" />
        </div>
        <p className="text-[11px] text-muted-foreground">Counts working days (Mon–Fri). Auto-approved.</p>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit}>Book</Button>
        </div>
      </div>
    </Modal>
  );
}

function PolicyModal({
  policies,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
}: {
  policies: TimeOffPolicy[];
  onClose: () => void;
  onAdd: (name: string, color: string, balance: number | null) => void;
  onUpdate: (id: string, patch: Partial<TimeOffPolicy>) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[9]);

  return (
    <Modal open onClose={onClose} title="Time-off policies">
      <div className="space-y-3">
        <div className="divide-y rounded-md border">
          {policies.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2.5 py-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <Input value={p.name} onChange={(e) => onUpdate(p.id, { name: e.target.value })} className="h-7 flex-1 text-sm" />
              <ConfirmButton onConfirm={() => onDelete(p.id)} title="Delete policy">
                <Trash2 className="h-3.5 w-3.5" />
              </ConfirmButton>
            </div>
          ))}
          {policies.length === 0 && <p className="px-2.5 py-3 text-xs text-muted-foreground">No policies yet.</p>}
        </div>

        <div className="space-y-2 rounded-md border p-2.5">
          <Label className="text-xs">New policy</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-8 text-sm" />
          <div className="flex flex-wrap gap-1">
            {PROJECT_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} className={cn('h-5 w-5 rounded-full transition-transform', color === c && 'ring-2 ring-offset-1 ring-offset-popover')} style={{ backgroundColor: c }} />
            ))}
          </div>
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={() => {
              if (!name.trim()) return;
              onAdd(name.trim(), color, null);
              setName('');
            }}
          >
            <Plus className="h-4 w-4" /> Add policy
          </Button>
        </div>
        <div className="flex justify-end border-t pt-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
