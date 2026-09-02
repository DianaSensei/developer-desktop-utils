import { useState } from 'react';
import { RefreshCw, Plus, Radio, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Field } from '@/components/ui/tool-section';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
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
import { SearchInput } from '@/components/ui/search-input';

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
            <Button variant="outline" size="sm" busy={exchanges.loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search exchanges…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {exchanges.loading && <LoadingRow />}
        {exchanges.error && <Callout tone="error">{exchanges.error}</Callout>}
        {exchanges.data && (
          rows.length === 0
            ? <p className="text-sm text-fg-mute">{f ? 'No matching exchanges.' : 'No exchanges.'}</p>
            : (
              <>
                <DataTable>
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Type</Th>
                      <Th>Durable</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {shown.map((e) => (
                      <Tr key={e.name || '(default)'} interactive onClick={() => onSelectExchange(e.name)}>
                        <Td mono>{e.name || '(AMQP default)'}</Td>
                        <Td>{e.type ?? '—'}</Td>
                        <Td>{e.durable ? 'Yes' : 'No'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </DataTable>
                {rows.length > shown.length && (
                  <p className="mt-2 text-[11px] text-fg-mute">Showing first {LIST_RENDER_CAP} of {rows.length.toLocaleString()} — search to narrow.</p>
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
            {/* `busy` xoay chính icon Refresh. Cách cũ là tráo hẳn sang <Spinner>,
                  mà hai glyph không cùng bề rộng nên nút NHẤY một cái đúng vào
                  khoảnh khắc người dùng vừa bấm nó. */}
            <Button variant="outline" size="sm" onClick={onRefresh} busy={info.loading}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
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
            className="h-ctl text-sm font-mono"
          />
          <Button variant="outline" size="sm" onClick={addName} disabled={!adding.trim()}>Track</Button>
        </div>
        <p className="text-[11px] text-fg-mute mt-1.5">
          AMQP can't list exchanges, so add the names you want to work with. Existence comes from a passive declare; type/bindings aren't queryable over AMQP.
        </p>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {info.error && <Callout tone="error" className="mb-3">{info.error}</Callout>}
        {names.length === 0
          ? <p className="text-sm text-fg-mute">No exchanges tracked yet. Add one above or create a new exchange.</p>
          : (
            <DataTable>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Exists</Th>
                  <Th className="w-8" />
                </Tr>
              </Thead>
              <Tbody>
                {names.map((name) => {
                  const i = byName.get(name);
                  return (
                    <Tr key={name} interactive className="group" onClick={() => onSelectExchange(name)}>
                      <Td mono>{name}</Td>
                      <Td>
                        {!i ? <Badge tone="neutral">—</Badge>
                          : i.exists ? <Badge tone="success">yes</Badge>
                          : i.error ? <Badge tone="danger" title={i.error}>error</Badge>
                          : <Badge tone="warning">not found</Badge>}
                      </Td>
                      <Td align="right">
                        <button
                          className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Stop tracking (does not delete the exchange)"
                          onClick={(e) => { e.stopPropagation(); knownNamesStore.removeExchange(conn.id, name); }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </DataTable>
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
          <Field label="Name" htmlFor="rb-newex">
            <Input
              id="rb-newex" value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              placeholder="my.exchange" autoFocus className="font-mono text-sm"
            />
          </Field>
          <Field label="Type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-ctl text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXCHANGE_TYPES.map((t) => (<SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label className="cursor-pointer text-xs">Durable</Label>
            <Switch checked={durable} onCheckedChange={setDurable} aria-label="Durable" />
          </div>
          {error && <Callout tone="error" size="sm">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
