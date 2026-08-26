import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RowCheckbox } from './SelectionBar';
import { containerApi, type ContainerConnection, type ContainerResourceUpdate, type ContainerResources } from './types';

// Editor for the cgroup limits `docker update` can change on an existing
// container — CPU, memory, block IO, pids and restart policy. Works on one
// container (fields pre-filled from the daemon, only edited fields are sent)
// or on a whole selection (fields start blank, and each one is only applied
// once explicitly ticked, so a bulk CPU change can't wipe per-container
// memory limits).

const MIB = 1024 * 1024;
const NANO = 1_000_000_000;

const RESTART_POLICIES = ['no', 'always', 'unless-stopped', 'on-failure'] as const;

type FieldKey =
  | 'cpus' | 'cpuShares' | 'cpusetCpus'
  | 'memory' | 'memoryReservation' | 'memorySwap'
  | 'pidsLimit' | 'blkioWeight' | 'restartPolicy';

type FormState = Record<FieldKey, string>;

const EMPTY_FORM: FormState = {
  cpus: '', cpuShares: '', cpusetCpus: '',
  memory: '', memoryReservation: '', memorySwap: '',
  pidsLimit: '', blkioWeight: '', restartPolicy: '',
};

/** Round-trips a value through the same formatting the inputs show, so a
 *  field the user never touched compares equal and is left off the wire. */
function formStateFrom(r: ContainerResources): FormState {
  const mib = (bytes?: number | null) => (bytes && bytes > 0 ? String(Math.round(bytes / MIB)) : '');
  return {
    cpus: r.nanoCpus ? String(Number((r.nanoCpus / NANO).toFixed(3))) : '',
    cpuShares: r.cpuShares ? String(r.cpuShares) : '',
    cpusetCpus: r.cpusetCpus ?? '',
    memory: mib(r.memoryBytes),
    memoryReservation: mib(r.memoryReservationBytes),
    // -1 is docker's "unlimited swap" sentinel — shown verbatim rather than
    // as a nonsense negative megabyte count.
    memorySwap: r.memorySwapBytes === -1 ? '-1' : mib(r.memorySwapBytes),
    pidsLimit: r.pidsLimit ? String(r.pidsLimit) : '',
    blkioWeight: r.blkioWeight ? String(r.blkioWeight) : '',
    restartPolicy: r.restartPolicy && r.restartPolicy !== '' ? r.restartPolicy : 'no',
  };
}

function parseNumber(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() === '' || Number.isNaN(n) ? null : n;
}

/** Field-by-field validation with docker's own accepted ranges. Returns the
 *  first problem so the dialog can refuse to send a request the daemon would
 *  reject anyway. */
function validate(form: FormState, active: Set<FieldKey>): string | null {
  const num = (key: FieldKey) => parseNumber(form[key]);
  if (active.has('cpus')) {
    const v = num('cpus');
    if (form.cpus.trim() !== '' && (v === null || v < 0)) return 'CPU limit must be a non-negative number of cores.';
  }
  for (const key of ['cpuShares', 'memory', 'memoryReservation', 'pidsLimit'] as FieldKey[]) {
    if (!active.has(key) || form[key].trim() === '') continue;
    const v = num(key);
    if (v === null || v < 0 || !Number.isInteger(v)) return `${LABELS[key]} must be a non-negative whole number.`;
  }
  if (active.has('memory') && form.memory.trim() !== '') {
    const v = num('memory')!;
    if (v > 0 && v < 6) return 'Memory limit must be at least 6 MB (docker minimum).';
  }
  if (active.has('memorySwap') && form.memorySwap.trim() !== '') {
    const v = num('memorySwap');
    if (v === null || !Number.isInteger(v) || v < -1) return 'Memory + swap must be a whole number of MB, or -1 for unlimited.';
  }
  if (active.has('blkioWeight') && form.blkioWeight.trim() !== '') {
    const v = num('blkioWeight');
    if (v === null || !Number.isInteger(v) || v < 10 || v > 1000) return 'Block IO weight must be between 10 and 1000.';
  }
  if (active.has('cpusetCpus') && form.cpusetCpus.trim() !== '' && !/^[0-9]+([,-][0-9]+)*$/.test(form.cpusetCpus.trim())) {
    return 'CPU set must look like "0", "0-3" or "0,2,4".';
  }
  return null;
}

const LABELS: Record<FieldKey, string> = {
  cpus: 'CPU limit',
  cpuShares: 'CPU shares',
  cpusetCpus: 'CPU set',
  memory: 'Memory limit',
  memoryReservation: 'Memory reservation',
  memorySwap: 'Memory + swap',
  pidsLimit: 'PIDs limit',
  blkioWeight: 'Block IO weight',
  restartPolicy: 'Restart policy',
};

/** Maps the form's human units (cores, MB) onto the daemon's wire units
 *  (nano-CPUs, bytes). An empty field means "clear this limit", which docker
 *  spells as `0` for every limit except swap, where `-1` is unlimited. */
function toPayload(form: FormState, keys: FieldKey[]): ContainerResourceUpdate {
  const payload: ContainerResourceUpdate = {};
  const mbToBytes = (raw: string) => {
    const v = parseNumber(raw);
    if (v === null) return 0;
    return v === -1 ? -1 : Math.round(v * MIB);
  };
  for (const key of keys) {
    const raw = form[key];
    switch (key) {
      case 'cpus': {
        const nano = Math.round((parseNumber(raw) ?? 0) * NANO);
        payload.nanoCpus = nano;
        // The daemon rejects a config carrying both NanoCpus and a CPU
        // quota/period pair ("Conflicting options"), and a container started
        // with --cpu-quota still has that pair in its HostConfig — which the
        // update would merge with. Clearing them is exactly what the CLI's
        // `--cpus` does, so the same limit is expressed one way only.
        if (nano > 0) { payload.cpuQuota = 0; payload.cpuPeriod = 0; }
        break;
      }
      case 'cpuShares': payload.cpuShares = parseNumber(raw) ?? 0; break;
      case 'cpusetCpus': payload.cpusetCpus = raw.trim(); break;
      case 'memory': payload.memoryBytes = mbToBytes(raw); break;
      case 'memoryReservation': payload.memoryReservationBytes = mbToBytes(raw); break;
      case 'memorySwap': payload.memorySwapBytes = mbToBytes(raw); break;
      case 'pidsLimit': payload.pidsLimit = parseNumber(raw) ?? 0; break;
      case 'blkioWeight': payload.blkioWeight = parseNumber(raw) ?? 0; break;
      case 'restartPolicy': payload.restartPolicy = raw || 'no'; break;
    }
  }
  return payload;
}

export function ContainerResourcesDialog({ open, onOpenChange, connection, targets, onApplied }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connection: ContainerConnection;
  /** One entry edits that container's current limits; several applies the
   *  ticked fields to every one of them. */
  targets: { id: string; name: string }[];
  onApplied: () => void;
}) {
  const bulk = targets.length > 1;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initial, setInitial] = useState<FormState>(EMPTY_FORM);
  const [enabled, setEnabled] = useState<Set<FieldKey>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const singleId = !bulk ? targets[0]?.id : undefined;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEnabled(new Set());
    if (!singleId) { setForm(EMPTY_FORM); setInitial(EMPTY_FORM); return; }
    setLoading(true);
    containerApi.resources(connection, singleId)
      .then((r) => { const f = formStateFrom(r); setForm(f); setInitial(f); })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [open, singleId, connection]);

  const set = (key: FieldKey, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const toggleEnabled = (key: FieldKey) => setEnabled((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Single: whatever the user actually changed. Bulk: whatever they ticked.
  const activeKeys = useMemo<FieldKey[]>(() => {
    if (bulk) return Array.from(enabled);
    return (Object.keys(form) as FieldKey[]).filter((k) => form[k] !== initial[k]);
  }, [bulk, enabled, form, initial]);

  const apply = async () => {
    if (activeKeys.length === 0) return;
    const problem = validate(form, new Set(activeKeys));
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const payload = toPayload(form, activeKeys);
    const results = await Promise.allSettled(
      targets.map((t) => containerApi.updateResources(connection, t.id, payload)),
    );
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    setBusy(false);
    if (failed.length > 0) {
      const first = failed[0].reason;
      setError(`${failed.length} of ${targets.length} failed — ${String(first instanceof Error ? first.message : first)}`);
      // Partial success still changed something on the daemon, so refresh.
      if (failed.length < targets.length) onApplied();
      return;
    }
    onApplied();
    onOpenChange(false);
  };

  const title = bulk
    ? `Resource limits · ${targets.length} containers`
    : `Resource limits · ${targets[0]?.name ?? ''}`;

  const field = (key: FieldKey, hint: string, input: ReactNode) => (
    <ResourceField
      key={key}
      label={LABELS[key]}
      hint={hint}
      bulk={bulk}
      enabled={enabled.has(key)}
      onToggleEnabled={() => toggleEnabled(key)}
      changed={!bulk && form[key] !== initial[key]}
    >
      {input}
    </ResourceField>
  );

  const numberInput = (key: FieldKey, placeholder: string) => (
    <Input
      value={form[key]}
      placeholder={placeholder}
      inputMode="decimal"
      disabled={busy || (bulk && !enabled.has(key))}
      onChange={(e) => set(key, e.target.value)}
      className="h-ctl font-mono text-sm"
    />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Cpu className="h-4 w-4" /> <span className="font-mono">{title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-4">
          {loading && <LoadingRow />}
          {!loading && (
            <>
              <p className="text-[11px] text-fg-mute">
                {bulk
                  ? 'Tick a limit to apply it to every selected container. Un-ticked limits are left exactly as they are.'
                  : 'Applied live — no restart needed. Leave a field empty to remove that limit.'}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {field('cpus', 'Cores, e.g. 1.5. Empty = unlimited.', numberInput('cpus', '1.5'))}
                {field('cpuShares', 'Relative weight vs other containers. Default 1024.', numberInput('cpuShares', '1024'))}
                {field('memory', 'Hard limit in MB. Min 6.', numberInput('memory', '512'))}
                {field('memoryReservation', 'Soft limit in MB, kept under pressure.', numberInput('memoryReservation', '256'))}
                {field('memorySwap', 'Memory + swap in MB. -1 = unlimited swap.', numberInput('memorySwap', '1024'))}
                {field('cpusetCpus', 'Pin to specific cores, e.g. 0-3.', (
                  <Input
                    value={form.cpusetCpus}
                    placeholder="0-3"
                    disabled={busy || (bulk && !enabled.has('cpusetCpus'))}
                    onChange={(e) => set('cpusetCpus', e.target.value)}
                    className="h-ctl font-mono text-sm"
                  />
                ))}
                {field('pidsLimit', 'Max processes. Empty or -1 = unlimited.', numberInput('pidsLimit', '512'))}
                {field('blkioWeight', 'Block IO weight, 10–1000.', numberInput('blkioWeight', '500'))}
                {field('restartPolicy', 'What the daemon does when the container exits.', (
                  <Select
                    value={form.restartPolicy || 'no'}
                    disabled={busy || (bulk && !enabled.has('restartPolicy'))}
                    onValueChange={(v) => set('restartPolicy', v)}
                  >
                    <SelectTrigger className="h-ctl text-sm"><SelectValue placeholder="no" /></SelectTrigger>
                    <SelectContent>
                      {RESTART_POLICIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ))}
              </div>

              {error && <Callout tone="error" size="sm">{error}</Callout>}
            </>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-[11px] text-fg-mute">
            {activeKeys.length === 0
              ? bulk ? 'Nothing ticked yet' : 'No changes'
              : `${activeKeys.length} limit(s) → ${targets.length} container(s)`}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={apply} disabled={busy || loading || activeKeys.length === 0}>
            {busy ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResourceField({ label, hint, bulk, enabled, onToggleEnabled, changed, children }: {
  label: string;
  hint: string;
  bulk: boolean;
  enabled: boolean;
  onToggleEnabled: () => void;
  changed: boolean;
  children: ReactNode;
}) {
  return (
    <div className={bulk && !enabled ? 'opacity-60' : undefined}>
      <div className="flex items-center gap-1.5">
        {bulk && <RowCheckbox checked={enabled} onToggle={onToggleEnabled} title={`Apply ${label}`} />}
        <p className="text-[11px] text-fg-mute">
          {label}
          {changed && <span className="ml-1 text-acc">•</span>}
        </p>
      </div>
      <div className="mt-1">{children}</div>
      <p className="mt-1 text-[11px] text-fg-mute/80">{hint}</p>
    </div>
  );
}
