import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useClockify, type Expense } from './store';
import { BillableButton, ColorDot, ConfirmButton, Modal, ProjectPicker } from './ui';
import { monthKey, monthLabel, parseDateInput, shortDate, toDateInput } from './time';

export function Expenses() {
  const { expenses, projects, settings, projectById, addExpense, updateExpense, deleteExpense, now } = useClockify();
  const [filterProject, setFilterProject] = useState<string>('all');
  const [editing, setEditing] = useState<Expense | null>(null);
  const [adding, setAdding] = useState(false);

  const fmtMoney = (n: number) => `${settings.currencySymbol}${n.toFixed(2)}`;

  const filtered = useMemo(() => {
    let list = expenses;
    if (filterProject === 'none') list = list.filter((e) => !e.projectId);
    else if (filterProject !== 'all') list = list.filter((e) => e.projectId === filterProject);
    return [...list].sort((a, b) => b.date - a.date);
  }, [expenses, filterProject]);

  const groups = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of filtered) {
      const k = monthKey(e.date);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return [...m.values()].map((items) => ({
      ts: items[0].date,
      items,
      total: items.reduce((s, e) => s + e.amount, 0),
      billable: items.filter((e) => e.billable).reduce((s, e) => s + e.amount, 0),
    }));
  }, [filtered]);

  const grandTotal = filtered.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            <SelectItem value="none">No project</SelectItem>
            {projects.filter((p) => !p.archived).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-2 text-xs text-muted-foreground">
          Total <span className="font-medium text-foreground">{fmtMoney(grandTotal)}</span>
        </span>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Expense
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Receipt className="h-9 w-9 opacity-30" />
            <p className="text-sm">No expenses yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.ts}>
                <div className="mb-1.5 flex items-center justify-between px-1 text-xs">
                  <span className="font-medium text-muted-foreground">{monthLabel(g.ts)}</span>
                  <span className="text-muted-foreground">
                    {fmtMoney(g.total)}
                    {g.billable > 0 && <span className="ml-2 text-emerald-600 dark:text-emerald-400">{fmtMoney(g.billable)} billable</span>}
                  </span>
                </div>
                <div className="divide-y rounded-lg border">
                  {g.items.map((e) => {
                    const project = projectById(e.projectId);
                    return (
                      <div key={e.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="w-14 shrink-0 text-xs text-muted-foreground">{shortDate(e.date)}</span>
                        <span className="w-24 shrink-0 truncate text-xs">{e.category}</span>
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          {project && <ColorDot color={project.color} />}
                          <span className="truncate">{e.note || project?.name || '—'}</span>
                        </span>
                        {e.billable && <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">billable</span>}
                        <span className="w-20 shrink-0 text-right font-mono tabular-nums">{fmtMoney(e.amount)}</span>
                        <button onClick={() => setEditing(e)} className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <ConfirmButton onConfirm={() => deleteExpense(e.id)} title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </ConfirmButton>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(adding || editing) && (
        <ExpenseEditor
          expense={editing}
          categories={settings.expenseCategories}
          defaultDate={now}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={(data) => {
            if (editing) updateExpense(editing.id, data);
            else addExpense(data);
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ExpenseEditor({
  expense,
  categories,
  defaultDate,
  onClose,
  onSave,
}: {
  expense: Expense | null;
  categories: string[];
  defaultDate: number;
  onClose: () => void;
  onSave: (data: Omit<Expense, 'id'>) => void;
}) {
  const [dateStr, setDateStr] = useState(toDateInput(expense?.date ?? defaultDate));
  const [category, setCategory] = useState(expense?.category ?? categories[0] ?? 'General');
  const [projectId, setProjectId] = useState<string | null>(expense?.projectId ?? null);
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [billable, setBillable] = useState(expense?.billable ?? false);

  const save = () => {
    const date = parseDateInput(dateStr);
    const amt = Number(amount);
    if (date === null || !(amt > 0)) return;
    onSave({ date, category, projectId, amount: amt, note: note.trim(), billable });
  };

  return (
    <Modal open onClose={onClose} title={expense ? 'Edit expense' : 'Add expense'}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Date</Label>
            <Input value={dateStr} onChange={(e) => setDateStr(e.target.value)} placeholder="YYYY-MM-DD" className="font-mono" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Amount</Label>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="z-[9999]">
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Project</Label>
          <ProjectPicker value={projectId} onChange={(p) => setProjectId(p)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was it for?" />
        </div>
        <div className="flex items-center gap-2">
          <BillableButton value={billable} onChange={setBillable} />
          <span className="text-xs text-muted-foreground">{billable ? 'Billable to client' : 'Non-billable'}</span>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save}>{expense ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  );
}
