import { useEffect, useState } from 'react';
import { KeyRound, Trash2, Pencil, Plus, X, Save, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Field } from '@/components/ui/tool-section';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { ViewHeader } from '@/components/ui/view-header';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import type { RedisConnection, KeyValue } from './types';
import { redisApi } from './types';
import { MathConfirmDialog } from './MathConfirmDialog';

interface KeyDetailViewProps {
  conn: RedisConnection;
  db: number;
  keyName: string;
  onBack: () => void;
  onDeleted: () => void;
  onRenamed: (newKey: string) => void;
}

function ttlToSeconds(ttlMs: number): number | null {
  return ttlMs < 0 ? null : Math.ceil(ttlMs / 1000);
}

export function KeyDetailView({ conn, db, keyName, onBack, onDeleted, onRenamed }: KeyDetailViewProps) {
  const [value, setValue] = useState<KeyValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const v = await redisApi.getKey(conn.id, db, keyName);
      setValue(v);
      if (v.type === 'none') onDeleted();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [conn.id, db, keyName]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteKey = async () => {
    await redisApi.deleteKeys(conn.id, db, [keyName]);
    onDeleted();
  };

  // Mutations update `value` in place instead of re-fetching the whole key —
  // a hash/list/set/zset can hold up to VALUE_CAP (2000) entries, and
  // re-running HSCAN/SSCAN/etc. after every single field edit made editing a
  // large collection field-by-field noticeably slow. It also catches
  // failures here so a rejected HSET/SADD/etc. surfaces as an error instead
  // of an unhandled promise rejection with no visible feedback.
  const runMutation = async (apply: () => Promise<void>) => {
    try {
      await apply();
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const ttlMs = value && value.type !== 'none' ? value.ttlMs : -1;

  return (
    <div className="tool-full-height">
      <ViewHeader
        icon={KeyRound}
        title={keyName}
        subtitle={value && value.type !== 'none' ? value.type : undefined}
        onBack={onBack}
        actions={(
          <>
            <CopyButton value={keyName} label="Copy key" variant="outline" size="sm" />
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}><Pencil className="h-3.5 w-3.5 mr-1.5" /> Rename</Button>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete</Button>
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          </>
        )}
      />

      <div className="tool-scrollable px-5 py-4 space-y-4">
        {loading && !value && <LoadingRow />}
        {error && <Callout tone="error">{error}</Callout>}

        {value && value.type !== 'none' && (
          <>
            <TtlRow
              seconds={ttlToSeconds(ttlMs)}
              onSet={(seconds) => runMutation(async () => {
                await redisApi.setTtl(conn.id, db, keyName, seconds);
                setValue((prev) => (prev && prev.type !== 'none' ? { ...prev, ttlMs: seconds != null ? seconds * 1000 : -1 } : prev));
              })}
            />

            {value.type === 'string' && (
              <StringEditor
                initial={value.value}
                onSave={(v) => runMutation(async () => {
                  await redisApi.setString(conn.id, db, keyName, v, ttlToSeconds(ttlMs));
                  setValue((prev) => (prev && prev.type === 'string' ? { ...prev, value: v } : prev));
                })}
              />
            )}
            {value.type === 'hash' && (
              <HashEditor
                fields={value.fields}
                truncated={value.truncated}
                onSetField={(f, v) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['HSET', keyName, f, v]);
                  setValue((prev) => {
                    if (!prev || prev.type !== 'hash') return prev;
                    const idx = prev.fields.findIndex(([ff]) => ff === f);
                    const fields: [string, string][] = idx === -1
                      ? [...prev.fields, [f, v]]
                      : prev.fields.map((entry, i) => (i === idx ? [f, v] as [string, string] : entry));
                    return { ...prev, fields };
                  });
                })}
                onDeleteField={(f) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['HDEL', keyName, f]);
                  setValue((prev) => (prev && prev.type === 'hash' ? { ...prev, fields: prev.fields.filter(([ff]) => ff !== f) } : prev));
                })}
              />
            )}
            {value.type === 'list' && (
              <ListEditor
                items={value.items}
                truncated={value.truncated}
                onPush={(v, front) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, [front ? 'LPUSH' : 'RPUSH', keyName, v]);
                  setValue((prev) => (prev && prev.type === 'list' ? { ...prev, items: front ? [v, ...prev.items] : [...prev.items, v] } : prev));
                })}
                onRemove={(v) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['LREM', keyName, '1', v]);
                  setValue((prev) => {
                    if (!prev || prev.type !== 'list') return prev;
                    const idx = prev.items.indexOf(v);
                    if (idx === -1) return prev;
                    const items = [...prev.items];
                    items.splice(idx, 1);
                    return { ...prev, items };
                  });
                })}
              />
            )}
            {value.type === 'set' && (
              <SetEditor
                members={value.members}
                truncated={value.truncated}
                onAdd={(v) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['SADD', keyName, v]);
                  setValue((prev) => (prev && prev.type === 'set' && !prev.members.includes(v) ? { ...prev, members: [...prev.members, v] } : prev));
                })}
                onRemove={(v) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['SREM', keyName, v]);
                  setValue((prev) => (prev && prev.type === 'set' ? { ...prev, members: prev.members.filter((m) => m !== v) } : prev));
                })}
              />
            )}
            {value.type === 'zset' && (
              <ZsetEditor
                members={value.members}
                truncated={value.truncated}
                onSet={(member, score) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['ZADD', keyName, String(score), member]);
                  // Not re-sorted: the initial fetch comes from ZSCAN, whose
                  // order isn't guaranteed to be score-sorted, so sorting
                  // only on edit would make the list suddenly reorder itself
                  // in a way a plain Refresh wouldn't reproduce.
                  setValue((prev) => {
                    if (!prev || prev.type !== 'zset') return prev;
                    const idx = prev.members.findIndex(([m]) => m === member);
                    const members: [string, number][] = idx === -1
                      ? [...prev.members, [member, score]]
                      : prev.members.map((entry, i) => (i === idx ? [member, score] as [string, number] : entry));
                    return { ...prev, members };
                  });
                })}
                onRemove={(member) => runMutation(async () => {
                  await redisApi.exec(conn.id, db, ['ZREM', keyName, member]);
                  setValue((prev) => (prev && prev.type === 'zset' ? { ...prev, members: prev.members.filter(([m]) => m !== member) } : prev));
                })}
              />
            )}
            {value.type === 'unsupported' && (
              <Callout tone="info">
                Editing type <span className="font-mono">{value.redisType}</span> isn't supported here yet — use the CLI Console (e.g. <span className="font-mono">XRANGE {keyName} - +</span> for a stream).
              </Callout>
            )}
          </>
        )}
      </div>

      <MathConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete key?"
        description={`Permanently remove "${keyName}" from db${db}. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={deleteKey}
      />

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initial={keyName}
        onRename={async (newKey) => {
          await redisApi.renameKey(conn.id, db, keyName, newKey);
          onRenamed(newKey);
        }}
      />
    </div>
  );
}

// ── TTL ────────────────────────────────────────────────────────────────────

function TtlRow({ seconds, onSet }: { seconds: number | null; onSet: (seconds: number | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(seconds != null ? String(seconds) : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setInput(seconds != null ? String(seconds) : ''); }, [seconds]);

  // Blank input means "no expiry" (PERSIST); anything else — including "0" —
  // is a real TTL in seconds. `Number(input) || null` used to treat "0" the
  // same as blank because 0 is falsy, so typing 0 silently persisted the key
  // instead of expiring it immediately.
  const parseInput = (): number | null => {
    const trimmed = input.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  const apply = async (next: number | null) => {
    setBusy(true);
    try { await onSet(next); setEditing(false); } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <span className="text-xs text-fg-mute w-16 shrink-0">TTL</span>
      {editing ? (
        <>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="seconds"
            className="h-ctl w-32 font-mono text-xs"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') apply(parseInput()); if (e.key === 'Escape') setEditing(false); }}
          />
          <Button size="sm" className="h-ctl" disabled={busy} onClick={() => apply(parseInput())}>Set</Button>
          <Button size="sm" variant="outline" className="h-ctl" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
        </>
      ) : (
        <>
          <span className="text-xs font-mono">{seconds != null ? `${seconds.toLocaleString()}s` : 'no expiry'}</span>
          <Button size="sm" variant="outline" className="h-ctl ml-auto" onClick={() => setEditing(true)}>Edit</Button>
          {seconds != null && (
            <Button size="sm" variant="outline" className="h-ctl" disabled={busy} onClick={() => apply(null)}>Persist</Button>
          )}
        </>
      )}
    </div>
  );
}

// ── String ───────────────────────────────────────────────────────────────────

function StringEditor({ initial, onSave }: { initial: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(initial), [initial]);
  const dirty = draft !== initial;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-mute">Value · {draft.length.toLocaleString()} chars</span>
        <div className="flex items-center gap-1.5">
          <CopyButton value={draft} label="Copy" variant="outline" size="sm" />
          <Button size="sm" disabled={!dirty || busy} onClick={async () => { setBusy(true); try { await onSave(draft); } finally { setBusy(false); } }}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="font-mono text-sm min-h-40 resize-y"
      />
    </div>
  );
}

// ── Hash ─────────────────────────────────────────────────────────────────────

function HashEditor({ fields, truncated, onSetField, onDeleteField }: {
  fields: [string, string][];
  truncated: boolean;
  onSetField: (field: string, value: string) => Promise<void>;
  onDeleteField: (field: string) => Promise<void>;
}) {
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');

  return (
    <div className="space-y-2">
      {truncated && <Callout tone="warning" size="sm">Showing the first 2000 fields — this hash has more.</Callout>}
      <DataTable>
        <Thead><Tr><Th>Field</Th><Th>Value</Th><Th className="w-8" /></Tr></Thead>
        <Tbody>
          {fields.map(([f, v]) => (
            <Tr key={f} className="group">
              <Td mono>{f}</Td>
              <Td mono>
                <Input
                  defaultValue={v}
                  className="h-ctl font-mono text-xs"
                  onBlur={(e) => { if (e.target.value !== v) void onSetField(f, e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </Td>
              <Td align="right">
                <button className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity" title="Delete field" onClick={() => void onDeleteField(f)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </DataTable>
      <div className="flex gap-1.5">
        <Input value={newField} onChange={(e) => setNewField(e.target.value)} placeholder="field" className="h-ctl font-mono text-xs" />
        <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value" className="h-ctl font-mono text-xs" />
        <Button
          size="sm" variant="outline" disabled={!newField.trim()}
          onClick={async () => { await onSetField(newField.trim(), newValue); setNewField(''); setNewValue(''); }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function ListEditor({ items, truncated, onPush, onRemove }: {
  items: string[];
  truncated: boolean;
  onPush: (value: string, front: boolean) => Promise<void>;
  onRemove: (value: string) => Promise<void>;
}) {
  const [newValue, setNewValue] = useState('');

  return (
    <div className="space-y-2">
      {truncated && <Callout tone="warning" size="sm">Showing the first 2000 items — this list has more.</Callout>}
      <p className="text-[11px] text-fg-mute">Delete removes the first matching value (<span className="font-mono">LREM 1</span>) — not safe with duplicate values.</p>
      <DataTable>
        <Thead><Tr><Th className="w-12">#</Th><Th>Value</Th><Th className="w-8" /></Tr></Thead>
        <Tbody>
          {items.map((v, i) => (
            <Tr key={i} className="group">
              <Td numeric className="text-fg-mute">{i}</Td>
              <Td mono>{v}</Td>
              <Td align="right">
                <button className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity" title="Remove" onClick={() => void onRemove(v)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </DataTable>
      <div className="flex gap-1.5">
        <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value" className="h-ctl font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={!newValue} onClick={async () => { await onPush(newValue, false); setNewValue(''); }}>Push end</Button>
        <Button size="sm" variant="outline" disabled={!newValue} onClick={async () => { await onPush(newValue, true); setNewValue(''); }}>Push front</Button>
      </div>
    </div>
  );
}

// ── Set ──────────────────────────────────────────────────────────────────────

function SetEditor({ members, truncated, onAdd, onRemove }: {
  members: string[];
  truncated: boolean;
  onAdd: (v: string) => Promise<void>;
  onRemove: (v: string) => Promise<void>;
}) {
  const [newMember, setNewMember] = useState('');

  return (
    <div className="space-y-2">
      {truncated && <Callout tone="warning" size="sm">Showing the first 2000 members — this set has more.</Callout>}
      <DataTable>
        <Thead><Tr><Th>Member</Th><Th className="w-8" /></Tr></Thead>
        <Tbody>
          {members.map((m) => (
            <Tr key={m} className="group">
              <Td mono>{m}</Td>
              <Td align="right">
                <button className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity" title="Remove" onClick={() => void onRemove(m)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </DataTable>
      <div className="flex gap-1.5">
        <Input value={newMember} onChange={(e) => setNewMember(e.target.value)} placeholder="member" className="h-ctl font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={!newMember.trim()} onClick={async () => { await onAdd(newMember.trim()); setNewMember(''); }}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Sorted set ────────────────────────────────────────────────────────────────

function ZsetEditor({ members, truncated, onSet, onRemove }: {
  members: [string, number][];
  truncated: boolean;
  onSet: (member: string, score: number) => Promise<void>;
  onRemove: (member: string) => Promise<void>;
}) {
  const [newMember, setNewMember] = useState('');
  const [newScore, setNewScore] = useState('0');

  return (
    <div className="space-y-2">
      {truncated && <Callout tone="warning" size="sm">Showing the first 2000 members — this sorted set has more.</Callout>}
      <DataTable>
        <Thead><Tr><Th>Member</Th><Th align="right">Score</Th><Th className="w-8" /></Tr></Thead>
        <Tbody>
          {members.map(([m, s]) => (
            <Tr key={m} className="group">
              <Td mono>{m}</Td>
              <Td align="right">
                <Input
                  defaultValue={s}
                  className="h-ctl w-24 font-mono text-xs text-right ml-auto"
                  onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== s) void onSet(m, n); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </Td>
              <Td align="right">
                <button className="text-fg-mute hover:text-bad opacity-0 group-hover:opacity-100 transition-opacity" title="Remove" onClick={() => void onRemove(m)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </DataTable>
      <div className="flex gap-1.5">
        <Input value={newMember} onChange={(e) => setNewMember(e.target.value)} placeholder="member" className="h-ctl font-mono text-xs" />
        <Input value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder="score" className="h-ctl w-24 font-mono text-xs" />
        <Button
          size="sm" variant="outline" disabled={!newMember.trim() || !Number.isFinite(Number(newScore))}
          onClick={async () => { await onSet(newMember.trim(), Number(newScore)); setNewMember(''); setNewScore('0'); }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Rename ───────────────────────────────────────────────────────────────────

function RenameDialog({ open, onOpenChange, initial, onRename }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: string; onRename: (newKey: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setName(initial); setError(null); } }, [open, initial]);

  const submit = async () => {
    if (!name.trim() || name === initial) { onOpenChange(false); return; }
    setBusy(true);
    setError(null);
    try {
      await onRename(name.trim());
      onOpenChange(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Rename key</DialogTitle></DialogHeader>
        <Field label="New name" htmlFor="rd-rename">
          <Input
            id="rd-rename" value={name} autoFocus className="font-mono text-sm"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </Field>
        {error && <Callout tone="error" size="sm">{error}</Callout>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Renaming…' : 'Rename'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
