import { useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, Search, Plus, Radio, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import type { RabbitConnection, ExchangeInfo, ExchangeAmqpInfo } from './types';
import { rabbitApi } from './types';
import { rabbitMgmt } from './api';
import { useRabbitData } from './useRabbitData';
import { knownNamesStore, useKnownNames } from './knownNamesStore';
import { ViewHeader } from '@/components/ui/view-header';

interface ExchangeListViewProps {
  conn: RabbitConnection;
  refreshKey: number;
  onRefresh: () => void;
  onSelectExchange: (name: string) => void;
}

// Cap rendered rows so a cluster with very many exchanges doesn't choke the DOM.
const LIST_RENDER_CAP = 500;

export function ExchangeListView(props: ExchangeListViewProps) {
  if (props.conn.amqpOnly) return <AmqpExchangeListView {...props} />;
  return <MgmtExchangeListView {...props} />;
}

function MgmtExchangeListView({ conn, refreshKey, onRefresh, onSelectExchange }: ExchangeListViewProps) {
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const exchanges = useRabbitData<ExchangeInfo[]>(() => rabbitMgmt.listExchanges(conn), [conn.id, refreshKey]);

  const f = filter.trim().toLowerCase();
  const rows = (exchanges.data ?? [])
    .filter((e) => (e.name || '(default)').toLowerCase().includes(f))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = rows.slice(0, LIST_RENDER_CAP);

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Radio}
        title="Exchanges"
        subtitle={`vhost ${conn.vhost}${exchanges.data ? ` · ${exchanges.data.length}` : ''}`}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New exchange</Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search exchanges…" className="pl-8 h-8 text-sm" />
        </div>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {exchanges.loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {exchanges.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{exchanges.error}</span>
          </div>
        )}
        {exchanges.data && (
          rows.length === 0
            ? <p className="text-sm text-muted-foreground">{f ? 'No matching exchanges.' : 'No exchanges.'}</p>
            : (
              <>
                <div className="overflow-x-auto rounded-xl border border-border/50">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20 border-b border-border/50">
                      <tr>
                        <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Name</th>
                        <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Type</th>
                        <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Durable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {shown.map((e) => (
                        <tr key={e.name || '(default)'} className="hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => onSelectExchange(e.name)}>
                          <td className="px-3.5 py-2.5 font-mono">{e.name || '(AMQP default)'}</td>
                          <td className="px-3.5 py-2.5">{e.type ?? '—'}</td>
                          <td className="px-3.5 py-2.5">{e.durable ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > shown.length && (
                  <p className="mt-2 text-[11px] text-muted-foreground">Showing first {LIST_RENDER_CAP} of {rows.length.toLocaleString()} — search to narrow.</p>
                )}
              </>
            )
        )}
      </div>

      <CreateExchangeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        conn={conn}
        onCreated={(name) => { exchanges.reload(); onSelectExchange(name); }}
      />
    </div>
  );
}

// ── AMQP-only: typed names + passive-declare existence ────────────────────────

function AmqpExchangeListView({ conn, refreshKey, onRefresh, onSelectExchange }: ExchangeListViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [adding, setAdding] = useState('');
  const names = useKnownNames(conn.id).exchanges;

  const info = useRabbitData<ExchangeAmqpInfo[]>(
    () => names.length ? rabbitApi.amqpExchangesInfo(conn.id, names) : Promise.resolve([]),
    [conn.id, names.join(' '), refreshKey],
  );
  const byName = new Map((info.data ?? []).map((i) => [i.name, i]));

  const addName = () => {
    const n = adding.trim();
    if (!n) return;
    knownNamesStore.addExchange(conn.id, n);
    setAdding('');
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Radio}
        title="Exchanges"
        subtitle={`AMQP-only · vhost ${conn.vhost} · ${names.length} tracked`}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New exchange</Button>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={info.loading}>
              {info.loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} Refresh
            </Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <div className="flex gap-2 max-w-md">
          <Input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addName(); }}
            placeholder="Track an existing exchange by name…"
            className="h-8 text-sm font-mono"
          />
          <Button variant="outline" size="sm" onClick={addName} disabled={!adding.trim()}>Track</Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          AMQP can't list exchanges, so add the names you want to work with. Existence comes from a passive declare; type/bindings aren't queryable over AMQP.
        </p>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {info.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive mb-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="break-words">{info.error}</span>
          </div>
        )}
        {names.length === 0
          ? <p className="text-sm text-muted-foreground">No exchanges tracked yet. Add one above or create a new exchange.</p>
          : (
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <table className="w-full text-xs">
                <thead className="bg-muted/20 border-b border-border/50">
                  <tr>
                    <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-3.5 py-2 text-left font-medium text-muted-foreground">Exists</th>
                    <th className="px-3.5 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {names.map((name) => {
                    const i = byName.get(name);
                    return (
                      <tr key={name} className="group hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => onSelectExchange(name)}>
                        <td className="px-3.5 py-2.5 font-mono">{name}</td>
                        <td className="px-3.5 py-2.5">
                          {!i ? <span className="text-muted-foreground">—</span>
                            : i.exists ? <span className="text-emerald-600 dark:text-emerald-400">yes</span>
                            : i.error ? <span className="text-destructive" title={i.error}>error</span>
                            : <span className="text-amber-600 dark:text-amber-400">not found</span>}
                        </td>
                        <td className="px-3.5 py-2.5 text-right">
                          <button
                            className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Stop tracking (does not delete the exchange)"
                            onClick={(e) => { e.stopPropagation(); knownNamesStore.removeExchange(conn.id, name); }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <CreateExchangeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        conn={conn}
        onCreated={(name) => { info.reload(); onSelectExchange(name); }}
      />
    </div>
  );
}

const EXCHANGE_TYPES = ['direct', 'fanout', 'topic', 'headers'] as const;

export function CreateExchangeDialog({ open, onOpenChange, conn, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RabbitConnection; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('direct');
  const [durable, setDurable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) { setError('Exchange name is required'); return; }
    setBusy(true);
    setError(null);
    try {
      if (conn.amqpOnly) {
        await rabbitApi.amqpDeclareExchange(conn.id, name.trim(), type, durable, false, false);
        knownNamesStore.addExchange(conn.id, name.trim());
      } else {
        await rabbitMgmt.createExchange(conn, name.trim(), type, durable);
      }
      onCreated(name.trim());
      onOpenChange(false);
      setName('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); setError(null); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New exchange</DialogTitle>
          <DialogDescription>
            {conn.amqpOnly ? 'Declare an exchange over AMQP and track it by name.' : `Create an exchange in vhost ${conn.vhost}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rb-newex" className="text-xs">Name</Label>
            <Input
              id="rb-newex" value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              placeholder="my.exchange" autoFocus className="mt-1 font-mono text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXCHANGE_TYPES.map((t) => (<SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label className="cursor-pointer text-xs">Durable</Label>
            <Switch checked={durable} onCheckedChange={setDurable} aria-label="Durable" />
          </div>
          {error && <p className="text-sm text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
