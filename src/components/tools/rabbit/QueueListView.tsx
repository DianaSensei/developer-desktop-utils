import { useEffect, useState } from 'react';
import { RefreshCw, Plus, Inbox, X } from 'lucide-react';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import type { RabbitConnection, QueueAmqpInfo } from './types';
import { rabbitApi } from './types';
import { rabbitMgmt, type PagedQueues } from './api';
import { useRabbitData } from './useRabbitData';
import { knownNamesStore, useKnownNames } from './knownNamesStore';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import { formatNumber } from './format';

interface QueueListViewProps {
  conn: RabbitConnection;
  refreshKey: number;
  onRefresh: () => void;
  onSelectQueue: (name: string) => void;
}

const PAGE_SIZE = 200;

/** Debounce a value so typing in the search box doesn't fire a request per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function QueueListView(props: QueueListViewProps) {
  if (props.conn.amqpOnly) return <AmqpQueueListView {...props} />;
  return <MgmtQueueListView {...props} />;
}

function MgmtQueueListView({ conn, refreshKey, onRefresh, onSelectQueue }: QueueListViewProps) {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  // Search is sent to the broker (server-side filter), debounced; reset to page 1.
  const name = useDebounced(filter.trim(), 300);
  useEffect(() => { setPage(1); }, [name]);

  const data = useRabbitData<PagedQueues>(
    () => rabbitMgmt.listQueuesPaged(conn, { page, pageSize: PAGE_SIZE, name: name || undefined }),
    [conn.id, refreshKey, page, name],
  );
  const result = data.data;
  const items = result?.items ?? [];
  const count = result ? (name ? result.filteredCount : result.totalCount) : null;

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Inbox}
        title="Queues"
        subtitle={`vhost ${conn.vhost}${count != null ? ` · ${count.toLocaleString()}${name ? ' matching' : ''}` : ''}`}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New queue</Button>
            <Button variant="outline" size="sm" busy={data.loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Search queues by name…" className="h-ctl text-sm" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {data.loading && !result && <LoadingRow />}
        {data.error && <Callout tone="error">{data.error}</Callout>}
        {result && (
          items.length === 0
            ? <p className="text-sm text-fg-mute">{name ? 'No matching queues.' : 'No queues yet.'}</p>
            : (
              <>
                <DataTable>
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th align="right">Ready</Th>
                      <Th align="right">Unacked</Th>
                      <Th align="right">Total</Th>
                      <Th align="right">Consumers</Th>
                      <Th>State</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {items.map((q) => (
                      <Tr key={q.name} interactive onClick={() => onSelectQueue(q.name)}>
                        <Td mono>{q.name}</Td>
                        <Td numeric>{formatNumber(q.messages_ready)}</Td>
                        <Td numeric>{formatNumber(q.messages_unacknowledged)}</Td>
                        <Td numeric>{formatNumber(q.messages)}</Td>
                        <Td numeric>{formatNumber(q.consumers)}</Td>
                        <Td>{q.state ?? '—'}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </DataTable>
                {result.pageCount > 1 && (
                  <div className="mt-3 flex items-center justify-between text-[11px] text-fg-mute">
                    <span>Page {result.page} of {result.pageCount.toLocaleString()}{data.loading ? ' · loading…' : ''}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-ctl" disabled={result.page <= 1 || data.loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
                      <Button variant="outline" size="sm" className="h-ctl" disabled={result.page >= result.pageCount || data.loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )
        )}
      </div>

      <CreateQueueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        conn={conn}
        onCreated={(name) => { data.reload(); onSelectQueue(name); }}
      />
    </div>
  );
}

// ── AMQP-only: typed names + passive-declare counts ───────────────────────────

function AmqpQueueListView({ conn, refreshKey, onRefresh, onSelectQueue }: QueueListViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [adding, setAdding] = useState('');
  const names = useKnownNames(conn.id).queues;

  const info = useRabbitData<QueueAmqpInfo[]>(
    () => names.length ? rabbitApi.amqpQueuesInfo(conn.id, names) : Promise.resolve([]),
    // NUL viết bằng escape, không nhúng byte thật — xem apiclient/cookies.ts.
    [conn.id, names.join('\u0000'), refreshKey],
  );
  const byName = new Map((info.data ?? []).map((i) => [i.name, i]));

  const addName = () => {
    const n = adding.trim();
    if (!n) return;
    knownNamesStore.addQueue(conn.id, n);
    setAdding('');
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={Inbox}
        title="Queues"
        subtitle={`AMQP-only · vhost ${conn.vhost} · ${names.length} tracked`}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New queue</Button>
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
            placeholder="Track an existing queue by name…"
            className="h-ctl text-sm font-mono"
          />
          <Button variant="outline" size="sm" onClick={addName} disabled={!adding.trim()}>Track</Button>
        </div>
        <p className="text-[11px] text-fg-mute mt-1.5">
          AMQP can't list queues, so add the names you want to work with. Counts come from a passive declare (existence + ready/consumers).
        </p>
      </div>

      <div className="tool-scrollable px-5 py-4">
        {info.error && <Callout tone="error" className="mb-3">{info.error}</Callout>}
        {names.length === 0
          ? <p className="text-sm text-fg-mute">No queues tracked yet. Add one above or create a new queue.</p>
          : (
            <DataTable>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Exists</Th>
                  <Th align="right">Ready</Th>
                  <Th align="right">Consumers</Th>
                  <Th className="w-8" />
                </Tr>
              </Thead>
              <Tbody>
                {names.map((name) => {
                  const i = byName.get(name);
                  return (
                    <Tr key={name} interactive className="group" onClick={() => onSelectQueue(name)}>
                      <Td mono>{name}</Td>
                      <Td>
                        {!i ? <Badge tone="neutral">—</Badge>
                          : i.exists ? <Badge tone="success">yes</Badge>
                          : i.error ? <Badge tone="danger" title={i.error}>error</Badge>
                          : <Badge tone="warning">not found</Badge>}
                      </Td>
                      <Td numeric>{i?.exists ? formatNumber(i.messages ?? 0) : '—'}</Td>
                      <Td numeric>{i?.exists ? formatNumber(i.consumers ?? 0) : '—'}</Td>
                      <Td align="right">
                        <button
                          className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Stop tracking (does not delete the queue)"
                          onClick={(e) => { e.stopPropagation(); knownNamesStore.removeQueue(conn.id, name); }}
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

      <CreateQueueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        conn={conn}
        onCreated={(name) => { info.reload(); onSelectQueue(name); }}
      />
    </div>
  );
}

export function CreateQueueDialog({ open, onOpenChange, conn, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RabbitConnection; onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [durable, setDurable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) { setError('Queue name is required'); return; }
    setBusy(true);
    setError(null);
    try {
      if (conn.amqpOnly) {
        await rabbitApi.amqpDeclareQueue(conn.id, name.trim(), durable, false);
        knownNamesStore.addQueue(conn.id, name.trim());
      } else {
        await rabbitMgmt.createQueue(conn, name.trim(), durable);
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
          <DialogTitle>New queue</DialogTitle>
          <DialogDescription>
            {conn.amqpOnly
              ? 'Declare a queue over AMQP and track it by name.'
              : `Create a queue in vhost ${conn.vhost} — e.g. a reply queue for request/response.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name" htmlFor="rb-newq">
            <Input
              id="rb-newq" value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              placeholder="test.reply" autoFocus className="font-mono text-sm"
            />
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
