import { useEffect, useMemo, useState } from 'react';
import { Wrench, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { ViewHeader } from '@/components/ui/view-header';
import { Tabs } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import type { RedisConnection } from './types';
import { redisApi } from './types';
import { useRedisData } from './useRedisData';
import { MathConfirmDialog } from './MathConfirmDialog';

interface AdminViewProps {
  conn: RedisConnection;
}

type AdminTab = 'clients' | 'slowlog' | 'config';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function AdminView({ conn }: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>('clients');

  return (
    <div className="tool-full-height">
      <ViewHeader icon={Wrench} title="Admin" subtitle={conn.name} />
      <Tabs
        tabs={[
          { id: 'clients', label: 'Clients' },
          { id: 'slowlog', label: 'Slow Log' },
          { id: 'config', label: 'Config' },
        ]}
        active={tab}
        onSelect={(id) => setTab(id as AdminTab)}
        className="px-5"
      />
      <div className="tool-scrollable px-5 py-4">
        {tab === 'clients' && <ClientsTab conn={conn} />}
        {tab === 'slowlog' && <SlowLogTab conn={conn} />}
        {tab === 'config' && <ConfigTab conn={conn} />}
      </div>
    </div>
  );
}

// ── Clients ──────────────────────────────────────────────────────────────────

// Field set varies by Redis version; show the common ones first, then
// whatever else the server reports, so the table stays useful across
// versions without hardcoding a schema.
const PREFERRED_CLIENT_FIELDS = ['id', 'addr', 'laddr', 'name', 'age', 'idle', 'db', 'cmd', 'resp'];

function ClientsTab({ conn }: { conn: RedisConnection }) {
  const { data, loading, error, reload } = useRedisData(() => redisApi.clientList(conn.id), [conn.id]);
  const rows = data ?? [];

  const columns = useMemo(() => {
    const seen = new Set<string>();
    rows.forEach((r) => Object.keys(r).forEach((k) => seen.add(k)));
    const ordered = PREFERRED_CLIENT_FIELDS.filter((k) => seen.has(k));
    const rest = Array.from(seen).filter((k) => !ordered.includes(k)).sort();
    return [...ordered, ...rest];
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-mute">{rows.length.toLocaleString()} connected client(s)</p>
        <Button variant="outline" size="sm" busy={loading} onClick={reload}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>
      {loading && !data && <LoadingRow />}
      {error && <Callout tone="error">{error}</Callout>}
      {rows.length > 0 && (
        <DataTable>
          <Thead><Tr>{columns.map((c) => <Th key={c} className="whitespace-nowrap">{c}</Th>)}</Tr></Thead>
          <Tbody>
            {rows.map((r, i) => (
              <Tr key={i}>
                {columns.map((c) => <Td key={c} mono className="whitespace-nowrap">{r[c] ?? '—'}</Td>)}
              </Tr>
            ))}
          </Tbody>
        </DataTable>
      )}
    </div>
  );
}

// ── Slow Log ─────────────────────────────────────────────────────────────────

function formatMicros(us: number): string {
  if (us < 1000) return `${us} µs`;
  return `${(us / 1000).toFixed(1)} ms`;
}

function SlowLogTab({ conn }: { conn: RedisConnection }) {
  const { data, loading, error, reload } = useRedisData(() => redisApi.slowlog(conn.id, 128), [conn.id]);
  const rows = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-mute">Most recent {rows.length.toLocaleString()} slow command(s)</p>
        <Button variant="outline" size="sm" busy={loading} onClick={reload}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>
      {loading && !data && <LoadingRow />}
      {error && <Callout tone="error">{error}</Callout>}
      {!loading && rows.length === 0 && !error && <p className="text-sm text-fg-mute">No slow commands recorded.</p>}
      {rows.length > 0 && (
        <DataTable>
          <Thead>
            <Tr><Th>When</Th><Th align="right">Duration</Th><Th>Command</Th><Th>Client</Th></Tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-fg-mute">{new Date(r.timestamp * 1000).toLocaleString()}</Td>
                <Td align="right" numeric>{formatMicros(r.durationMicros)}</Td>
                <Td mono className="max-w-md truncate" title={r.command.join(' ')}>{r.command.join(' ') || '—'}</Td>
                <Td mono className="text-fg-mute whitespace-nowrap">{r.clientName || r.clientAddr || '—'}</Td>
              </Tr>
            ))}
          </Tbody>
        </DataTable>
      )}
    </div>
  );
}

// ── Config ───────────────────────────────────────────────────────────────────

function ConfigTab({ conn }: { conn: RedisConnection }) {
  const [filter, setFilter] = useState('');
  const pattern = useDebounced(filter.trim(), 300) || '*';
  const { data, loading, error, reload } = useRedisData(() => redisApi.configGet(conn.id, pattern), [conn.id, pattern]);
  const rows = data ?? [];

  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingSet, setPendingSet] = useState<{ param: string; value: string } | null>(null);
  const [setError, setSetError] = useState<string | null>(null);

  const startEdit = (param: string, value: string) => { setEditingParam(param); setEditValue(value); setSetError(null); };
  const commitEdit = (param: string, original: string) => {
    if (editValue === original) { setEditingParam(null); return; }
    setPendingSet({ param, value: editValue });
  };
  const applySet = async () => {
    if (!pendingSet) return;
    try {
      await redisApi.configSet(conn.id, pendingSet.param, pendingSet.value);
      setSetError(null);
      setEditingParam(null);
      reload();
    } catch (e) {
      setSetError(String(e instanceof Error ? e.message : e));
    } finally {
      setPendingSet(null);
    }
  };

  return (
    <div className="space-y-3">
      <Callout tone="warning" size="sm">
        Changes here run <span className="font-mono">CONFIG SET</span> live against the whole server — every client
        is affected, not just this connection — and are lost on restart unless the server's own config file is
        updated separately (<span className="font-mono">CONFIG REWRITE</span>).
      </Callout>
      <div className="flex items-center justify-between gap-2">
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter, e.g. maxmemory*" className="h-ctl text-sm font-mono max-w-sm" />
        <Button variant="outline" size="sm" busy={loading} onClick={reload}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
      </div>
      {loading && !data && <LoadingRow />}
      {error && <Callout tone="error">{error}</Callout>}
      {setError && <Callout tone="error">{setError}</Callout>}
      {!loading && rows.length === 0 && !error && <p className="text-sm text-fg-mute">No config parameters match.</p>}
      {rows.length > 0 && (
        <DataTable>
          <Thead><Tr><Th>Parameter</Th><Th>Value</Th></Tr></Thead>
          <Tbody>
            {rows.map(([param, value]) => (
              <Tr key={param}>
                <Td mono className="whitespace-nowrap text-fg-mute">{param}</Td>
                <Td mono>
                  {editingParam === param ? (
                    <Input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(param, value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingParam(null);
                      }}
                      className="h-ctl font-mono text-xs"
                    />
                  ) : (
                    <button
                      className="text-left w-full truncate hover:underline decoration-dotted underline-offset-2"
                      title="Click to edit"
                      onClick={() => startEdit(param, value)}
                    >
                      {value || '(empty)'}
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </DataTable>
      )}

      <MathConfirmDialog
        open={pendingSet != null}
        onOpenChange={(o) => { if (!o) setPendingSet(null); }}
        title="Change server config?"
        description={pendingSet ? `CONFIG SET ${pendingSet.param} "${pendingSet.value}" — this changes live server behavior for every connected client.` : ''}
        confirmLabel="Apply"
        onConfirm={applySet}
      />
    </div>
  );
}
