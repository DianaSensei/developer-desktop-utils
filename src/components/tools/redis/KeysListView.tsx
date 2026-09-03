import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Callout } from '@/components/ui/callout';
import { Spinner, LoadingRow } from '@/components/ui/spinner';
import { Field } from '@/components/ui/tool-section';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { ViewHeader } from '@/components/ui/view-header';
import { SearchInput } from '@/components/ui/search-input';
import type { RedisConnection, KeySummary } from './types';
import { redisApi } from './types';
import { MathConfirmDialog } from './MathConfirmDialog';

type NewKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream';

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
  stream: 'accent',
};

const TYPE_FILTER_OPTIONS = ['all', 'string', 'hash', 'list', 'set', 'zset', 'stream'] as const;
type TypeFilter = (typeof TYPE_FILTER_OPTIONS)[number];

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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [rows, setRows] = useState<KeySummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, db, pattern, refreshKey]);

  const filteredRows = useMemo(
    () => (typeFilter === 'all' ? rows : rows.filter((r) => r.type === typeFilter)),
    [rows, typeFilter],
  );

  const deletePending = async () => {
    if (!pendingDelete) return;
    await redisApi.deleteKeys(conn.id, db, [pendingDelete]);
    setRows((prev) => prev.filter((r) => r.key !== pendingDelete));
    setPendingDelete(null);
  };

  const deleteSelected = async () => {
    const keys = Array.from(selected);
    if (keys.length === 0) return;
    await redisApi.deleteKeys(conn.id, db, keys);
    setRows((prev) => prev.filter((r) => !selected.has(r.key)));
    setSelected(new Set());
  };

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.key));
  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filteredRows.forEach((r) => next.delete(r.key));
        return next;
      }
      const next = new Set(prev);
      filteredRows.forEach((r) => next.add(r.key));
      return next;
    });
  };

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={KeyRound}
        title="Keys"
        subtitle={`db${db} · ${rows.length.toLocaleString()}${cursor !== 0 ? '+' : ''} loaded${typeFilter !== 'all' ? ` · ${filteredRows.length.toLocaleString()} shown` : ''}`}
        actions={(
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New key</Button>
            <Button variant="outline" size="sm" busy={loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="px-5 pt-3 shrink-0 flex items-center gap-2">
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter by prefix or glob, e.g. user: or user:*" className="h-ctl text-sm font-mono" containerClassName="max-w-sm flex-1" />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-ctl text-xs w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTER_OPTIONS.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t === 'all' ? 'All types' : t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="mx-5 mt-3 shrink-0 flex items-center justify-between gap-2 rounded-md border border-acc/30 bg-acc/5 px-3 py-2">
          <span className="text-xs text-fg-mute">{selected.size.toLocaleString()} selected</span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-ctl" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button size="sm" variant="destructive" className="h-ctl" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete {selected.size.toLocaleString()}
            </Button>
          </div>
        </div>
      )}

      <div className="tool-scrollable px-5 py-4">
        {loading && <LoadingRow />}
        {error && <Callout tone="error" className="mb-3">{error}</Callout>}
        {!loading && filteredRows.length === 0 && !error && (
          <p className="text-sm text-fg-mute">{rows.length === 0 ? 'No keys match this pattern.' : 'No keys match this type filter.'}</p>
        )}
        {filteredRows.length > 0 && (
          <>
            <DataTable>
              <Thead>
                <Tr>
                  <Th className="w-8">
                    <RowCheckbox checked={allVisibleSelected} onClick={toggleSelectAllVisible} title="Select all shown" />
                  </Th>
                  <Th>Key</Th>
                  <Th>Type</Th>
                  <Th align="right">TTL</Th>
                  <Th className="w-8" />
                </Tr>
              </Thead>
              <Tbody>
                {filteredRows.map((r) => (
                  <Tr key={r.key} interactive className="group" onClick={() => onSelectKey(r.key)}>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <RowCheckbox checked={selected.has(r.key)} onClick={() => toggleSelected(r.key)} title="Select key" />
                    </Td>
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

      <MathConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selected.size} keys?`}
        description={`Permanently remove ${selected.size.toLocaleString()} selected key(s) from db${db}. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={deleteSelected}
      />
    </div>
  );
}

/* Ô tick dùng chung — trước đây dựng tay ở đây, và cái tick BẬT RA đứt đoạn
   trong khi cái hộp quanh nó lại có transition. Xem `ui/checkbox.tsx`. */
function RowCheckbox({ checked, onClick, title }: { checked: boolean; onClick: () => void; title: string }) {
  return <Checkbox size="sm" checked={checked} onClick={onClick} title={title} />;
}

const NEW_KEY_TYPES: NewKeyType[] = ['string', 'hash', 'list', 'set', 'zset', 'stream'];

const TYPE_HELP: Record<NewKeyType, { label: string; placeholder: string; hint?: string }> = {
  string: { label: 'Value', placeholder: '' },
  hash: { label: 'Fields', placeholder: 'field = value\nanother field = another value' },
  list: { label: 'Values', placeholder: 'first value\nsecond value', hint: 'One value per line, pushed in order (RPUSH).' },
  set: { label: 'Members', placeholder: 'member1\nmember2' },
  zset: { label: 'Members', placeholder: '1 member1\n2 member2', hint: 'One "score member" per line.' },
  stream: { label: 'Fields', placeholder: 'field = value', hint: 'Adds one entry with an auto-generated ID (XADD key *).' },
};

function parseLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Builds the `redis_exec` args for a non-string key from the dialog's free-text
 * content, or returns a validation error to show inline. */
function buildCreateCommand(type: Exclude<NewKeyType, 'string'>, key: string, content: string): { cmd: string[] } | { error: string } {
  const lines = parseLines(content);
  if (lines.length === 0) return { error: 'Add at least one line' };

  if (type === 'hash' || type === 'stream') {
    const flat: string[] = [];
    for (const line of lines) {
      const idx = line.indexOf('=');
      if (idx === -1) return { error: `Line "${line}" is missing "=" — use field = value` };
      flat.push(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
    return { cmd: type === 'hash' ? ['HSET', key, ...flat] : ['XADD', key, '*', ...flat] };
  }
  if (type === 'list') return { cmd: ['RPUSH', key, ...lines] };
  if (type === 'set') return { cmd: ['SADD', key, ...lines] };

  // zset
  const flat: string[] = [];
  for (const line of lines) {
    const idx = line.indexOf(' ');
    if (idx === -1) return { error: `Line "${line}" is missing a score — use "score member"` };
    const score = line.slice(0, idx).trim();
    const member = line.slice(idx + 1).trim();
    if (!Number.isFinite(Number(score))) return { error: `"${score}" is not a valid score` };
    flat.push(score, member);
  }
  return { cmd: ['ZADD', key, ...flat] };
}

function CreateKeyDialog({ open, onOpenChange, conn, db, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RedisConnection; db: number; onCreated: (key: string) => void;
}) {
  const [type, setType] = useState<NewKeyType>('string');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const k = key.trim();
    if (!k) { setError('Key name is required'); return; }
    let cmd: string[] | null = null;
    if (type !== 'string') {
      const result = buildCreateCommand(type, k, value);
      if ('error' in result) { setError(result.error); return; }
      cmd = result.cmd;
    }
    setBusy(true);
    setError(null);
    try {
      if (cmd) {
        await redisApi.exec(conn.id, db, cmd);
      } else {
        await redisApi.setString(conn.id, db, k, value, null);
      }
      onCreated(k);
      onOpenChange(false);
      setKey('');
      setValue('');
      setType('string');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const help = TYPE_HELP[type];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); setError(null); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New key</DialogTitle>
          <DialogDescription>For a type not listed here (e.g. streams' full field set), use the CLI Console.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Key" htmlFor="rd-newkey">
              <Input
                id="rd-newkey" value={key}
                onChange={(e) => { setKey(e.target.value); setError(null); }}
                placeholder="user:1001" autoFocus className="font-mono text-sm"
              />
            </Field>
            <Field label="Type">
              <Select value={type} onValueChange={(v) => { setType(v as NewKeyType); setError(null); }}>
                <SelectTrigger className="h-ctl text-sm w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NEW_KEY_TYPES.map((t) => <SelectItem key={t} value={t} className="text-sm">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={help.label} hint={help.hint}>
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') create(); }}
              placeholder={help.placeholder} className="font-mono text-sm min-h-24 resize-y"
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
