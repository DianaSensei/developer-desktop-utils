import { useEffect, useState } from 'react';
import { RefreshCw, Plus, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Spinner, LoadingRow } from '@/components/ui/spinner';
import { Field } from '@/components/ui/tool-section';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import type { RedisConnection, KeySummary } from './types';
import { redisApi } from './types';
import { MathConfirmDialog } from './MathConfirmDialog';

interface KeysListViewProps {
  conn: RedisConnection;
  db: number;
  refreshKey: number;
  onRefresh: () => void;
  onSelectKey: (key: string) => void;
}

const PAGE_COUNT = 200;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Turns plain filter text into a SCAN MATCH pattern: a bare `user:1` becomes
 * a prefix match (`user:1*`) so typing without glob syntax still finds keys,
 * while a pattern that already uses glob metacharacters is passed through
 * untouched. */
function toScanPattern(filter: string): string {
  if (!filter) return '*';
  return /[*?[]/.test(filter) ? filter : `${filter}*`;
}

const TYPE_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info' | 'accent'> = {
  string: 'info',
  hash: 'accent',
  list: 'warning',
  set: 'success',
  zset: 'success',
};

function ttlLabel(ttlMs: number): string {
  if (ttlMs === -1) return '—';
  if (ttlMs === -2) return 'gone';
  const s = Math.ceil(ttlMs / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.ceil(s / 3600)}h`;
  return `${Math.ceil(s / 86400)}d`;
}

export function KeysListView({ conn, db, refreshKey, onRefresh, onSelectKey }: KeysListViewProps) {
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebounced(filter.trim(), 300);
  const pattern = toScanPattern(debouncedFilter);

  const [rows, setRows] = useState<KeySummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const loadPage = async (fromCursor: number, replace: boolean) => {
    (replace ? setLoading : setLoadingMore)(true);
    setError(null);
    try {
      const page = await redisApi.scanKeys(conn.id, db, fromCursor, pattern, PAGE_COUNT);
      const summaries = await redisApi.keySummary(conn.id, db, page.keys);
      setRows((prev) => (replace ? summaries : [...prev, ...summaries]));
      setCursor(page.cursor);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      (replace ? setLoading : setLoadingMore)(false);
    }
  };

  useEffect(() => {
    void loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, db, pattern, refreshKey]);

  const deletePending = async () => {
    if (!pendingDelete) return;
    await redisApi.deleteKeys(conn.id, db, [pendingDelete]);
    setRows((prev) => prev.filter((r) => r.key !== pendingDelete));
    setPendingDelete(null);
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={KeyRound}
        title="Keys"
        subtitle={`db${db} · ${rows.length.toLocaleString()}${cursor !== 0 ? '+' : ''} loaded`}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New key</Button>
            <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0">
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter by prefix or glob, e.g. user: or user:*" className="h-ctl text-sm font-mono" containerClassName="max-w-sm" />
      </div>

      <div className="tool-scrollable px-5 py-4">
        {loading && <LoadingRow />}
        {error && <Callout tone="error" className="mb-3">{error}</Callout>}
        {!loading && rows.length === 0 && !error && (
          <p className="text-sm text-fg-mute">No keys match this pattern.</p>
        )}
        {rows.length > 0 && (
          <>
            <DataTable>
              <Thead>
                <Tr>
                  <Th>Key</Th>
                  <Th>Type</Th>
                  <Th align="right">TTL</Th>
                  <Th className="w-8" />
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((r) => (
                  <Tr key={r.key} interactive className="group" onClick={() => onSelectKey(r.key)}>
                    <Td mono>{r.key}</Td>
                    <Td><Badge tone={TYPE_TONE[r.type] ?? 'neutral'}>{r.type}</Badge></Td>
                    <Td align="right" className="tabular-nums text-fg-mute">{ttlLabel(r.ttlMs)}</Td>
                    <Td align="right">
                      <button
                        className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete key"
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(r.key); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </DataTable>
            {cursor !== 0 && (
              <div className="mt-3 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => loadPage(cursor, false)} disabled={loadingMore}>
                  {loadingMore ? <Spinner size="sm" className="mr-1.5" /> : null}
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        conn={conn}
        db={db}
        onCreated={(key) => { onRefresh(); onSelectKey(key); }}
      />

      <MathConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title="Delete key?"
        description={`Permanently remove "${pendingDelete}" from db${db}. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={deletePending}
      />
    </div>
  );
}

function CreateKeyDialog({ open, onOpenChange, conn, db, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RedisConnection; db: number; onCreated: (key: string) => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!key.trim()) { setError('Key name is required'); return; }
    setBusy(true);
    setError(null);
    try {
      await redisApi.setString(conn.id, db, key.trim(), value, null);
      onCreated(key.trim());
      onOpenChange(false);
      setKey('');
      setValue('');
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
          <DialogTitle>New key</DialogTitle>
          <DialogDescription>
            Creates a string key. For other types (hash, list, set, zset), use the CLI Console — e.g. <span className="font-mono">HSET key field value</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Key" htmlFor="rd-newkey">
            <Input
              id="rd-newkey" value={key}
              onChange={(e) => { setKey(e.target.value); setError(null); }}
              placeholder="user:1001" autoFocus className="font-mono text-sm"
            />
          </Field>
          <Field label="Value">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') create(); }}
              placeholder="" className="font-mono text-sm min-h-24 resize-y"
            />
          </Field>
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
