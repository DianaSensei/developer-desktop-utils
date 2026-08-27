// Manage environments and their {{variables}}. Pick an environment on the left,
// edit its name and variable table on the right. The active environment's
// variables are substituted into URLs, headers, body, and auth at send time.
//
// Environments and Collection Variables are different *kinds* of things, not
// peers in one list: an environment is a swappable set you turn "Active" (Dev
// vs Prod), while Collection Variables is a single always-on bag of defaults
// for the whole collection. Showing "Collection Variables" as a row above the
// environment list made it look like a third environment, so it's a separate
// tab instead — picking it can't be confused with picking an environment.

import { useEffect, useState } from 'react';
import { Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionLabel } from '@/components/ui/section-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { StatusDot } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { KeyValueEditor } from './KeyValueEditor';
import { pickJsonFile, saveJsonFile } from './fileio';
import { exportEnvironmentNative, exportEnvironmentPostman, importEnvironment as parseEnvironmentFile } from './environments-io';
import type { Environment, KeyValue } from './types';
import type { ApiStore } from './store';

interface Props {
  store: ApiStore;
  open: boolean;
  onClose: () => void;
}

type Tab = 'environments' | 'collectionVars';

// How many variables actually take effect — matches the substitution rule
// (enabled + non-empty key) rather than the raw row count, so the badge next
// to an environment reflects what it really contributes, not stray/disabled
// rows left over from editing.
const varCount = (vars: KeyValue[] = []): number =>
  vars.filter((v) => v.enabled && v.key.trim() !== '').length;

export function EnvironmentEditor({ store, open, onClose }: Props) {
  const { environments } = store;
  const [tab, setTab] = useState<Tab>('environments');
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(environments[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Filters the *rows* of whichever environment/collection-vars is open on
  // the right — separate from `query` above, which filters the left list of
  // environments. Reset on every selection change so a filter left over from
  // one environment doesn't silently hide rows when you switch to another.
  const [varFilter, setVarFilter] = useState('');
  useEffect(() => { setVarFilter(''); }, [selectedEnvId, tab]);

  // Keep a valid environment selected as environments are added/removed.
  useEffect(() => {
    if (selectedEnvId && environments.some((e) => e.id === selectedEnvId)) return;
    setSelectedEnvId(environments[0]?.id ?? null);
  }, [environments, selectedEnvId]);

  // Reset the filter each time the dialog is reopened, so a search left over
  // from a previous visit doesn't silently hide environments the user expects
  // to see.
  useEffect(() => { if (open) setQuery(''); }, [open]);

  const activeCollection = store.collections.find((c) => c.id === store.activeCollectionId) ?? null;

  // The Collection Variables tab only makes sense with a collection open —
  // fall back if the active collection disappears while the dialog is open.
  useEffect(() => {
    if (tab === 'collectionVars' && !activeCollection) setTab('environments');
  }, [tab, activeCollection]);

  const selected = environments.find((e) => e.id === selectedEnvId) ?? null;
  const collectionEnvs = environments.filter((e) => e.collectionId === store.activeCollectionId);
  const globalEnvs = environments.filter((e) => !e.collectionId);

  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);
  const filteredCollectionEnvs = collectionEnvs.filter((e) => matches(e.name));
  const filteredGlobalEnvs = globalEnvs.filter((e) => matches(e.name));

  const tabDefs: TabDef[] = [
    {
      id: 'environments',
      label: 'Environments',
      badge: environments.length > 0 ? <Badge pill size="xs" className="ml-1">{environments.length}</Badge> : undefined,
    },
    ...(activeCollection ? [{
      id: 'collectionVars',
      label: 'Collection Variables',
      badge: varCount(activeCollection.variables) > 0
        ? <Badge pill size="xs" className="ml-1">{varCount(activeCollection.variables)}</Badge>
        : undefined,
    }] : []),
  ];

  const handleImport = async () => {
    setError(null);
    try {
      const text = await pickJsonFile();
      if (!text) return;
      const env = parseEnvironmentFile(text);
      const id = store.importEnvironment(env);
      setTab('environments');
      setSelectedEnvId(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleExport = async (env: Environment, format: 'postman' | 'native') => {
    setError(null);
    try {
      const json = format === 'postman' ? exportEnvironmentPostman(env) : exportEnvironmentNative(env);
      const suffix = format === 'postman' ? '.postman_environment.json' : '.environment.json';
      await saveJsonFile(`${env.name || 'environment'}${suffix}`, json);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* full, not xl: the fixed 240px list eats a fifth of xl's 768px before
          the variable table (name/value/secret-toggle/delete) even starts —
          the same two-pane shape as Runner, which already uses full. */}
      <DialogContent size="full" scrollable>
        {/* h-14 + pr-12, not py-3 + mr-6: DialogContent pins its own close X at
            `right-4 top-4` as a 24px box, so its centre is a fixed 28px from
            the top and right. A 56px header centres this button on the same
            line, at the same 24px size, and pr-12 leaves an 8px gap before the
            X — instead of a 34px button sitting 7px higher than the 24px one
            next to it. */}
        <DialogHeader className="h-14 flex-row items-center justify-between space-y-0 border-b px-4 pr-12">
          <DialogTitle>Environments</DialogTitle>
          <IconButton size="xs" onClick={handleImport} title="Import environment (Postman or this app's export)">
            <Upload className="h-3.5 w-3.5" />
          </IconButton>
        </DialogHeader>
        {error && <Callout tone="error" size="sm" className="mx-4 mt-3">{error}</Callout>}

        {/* The one thing every confused-user report about this dialog comes
            back to: which of these four wins. Stated once, up front, instead
            of split across two tooltips and a footnote paragraph each editor
            used to carry on its own. */}
        <Callout tone="info" size="sm" className="mx-4 mt-3">
          An <strong className="text-fg">environment</strong> is a swappable set of
          variables (Dev vs Prod) — mark one &ldquo;Active&rdquo; to use it.{' '}
          <strong className="text-fg">Collection Variables</strong> are always-on
          defaults for the whole collection; an active environment&rsquo;s
          variable with the same name wins. Use either with{' '}
          <code className="rounded bg-bg-2 px-1">{'{{name}}'}</code> in a request.
        </Callout>

        <Tabs tabs={tabDefs} active={tab} onSelect={(id) => setTab(id as Tab)} className="px-4" />

        {tab === 'collectionVars' && activeCollection ? (
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-3xl space-y-4">
              <div>
                <h3 className="text-sm font-medium">Collection Variables</h3>
                <p className="text-[11px] text-fg-mute">
                  Shared defaults for every request in <strong className="text-fg">{activeCollection.name}</strong>,
                  regardless of which environment is active — a variable of the same name in the
                  active environment still wins.
                </p>
              </div>
              <VarFilterBox rows={activeCollection.variables ?? []} value={varFilter} onChange={setVarFilter} />
              <KeyValueEditor
                rows={activeCollection.variables ?? []}
                onChange={(variables) => store.setCollectionVariables(activeCollection.id, variables)}
                keyPlaceholder="Variable"
                valuePlaceholder="Value"
                filterQuery={varFilter}
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* list — environments only, grouped by scope */}
            <div className="flex w-60 shrink-0 flex-col border-r">
              {/* Search stays outside the scrolling list — a filter box that
                  scrolls out of view is a filter box the user forgets is on,
                  left wondering why an environment they know exists is
                  "missing". */}
              <div className="border-b p-1.5">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search environments"
                  className="h-ctl text-xs"
                />
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                <Section
                  title={activeCollection?.name ?? 'Collection'}
                  disabled={!store.activeCollectionId}
                  empty={filteredCollectionEnvs.length === 0}
                  emptyText={q ? 'No matches' : 'No environments'}
                  onAdd={() => setSelectedEnvId(store.addEnvironment(store.activeCollectionId))}
                >
                  {filteredCollectionEnvs.map((e) => (
                    <EnvRow key={e.id} env={e} active={store.activeEnvId === e.id} selected={selectedEnvId === e.id} onClick={() => setSelectedEnvId(e.id)} />
                  ))}
                </Section>
                <Section
                  title="Global"
                  empty={filteredGlobalEnvs.length === 0}
                  emptyText={q ? 'No matches' : 'No environments'}
                  onAdd={() => setSelectedEnvId(store.addEnvironment(null))}
                >
                  {filteredGlobalEnvs.map((e) => (
                    <EnvRow key={e.id} env={e} active={store.activeEnvId === e.id} selected={selectedEnvId === e.id} onClick={() => setSelectedEnvId(e.id)} />
                  ))}
                </Section>
              </div>
            </div>

            {/* editor */}
            <div className="min-w-0 flex-1 overflow-y-auto p-4">
              {selected ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="max-w-[30%] shrink truncate rounded bg-bg-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-mute"
                      title={selected.collectionId ? (activeCollection?.name ?? 'Collection') : 'Global'}
                    >
                      {selected.collectionId ? (activeCollection?.name ?? 'Collection') : 'Global'}
                    </span>
                    <Input
                      value={selected.name}
                      onChange={(e) => store.updateEnvironment(selected.id, { name: e.target.value })}
                      className="h-ctl min-w-0 flex-1 text-sm font-medium"
                    />
                    <Button
                      variant={store.activeEnvId === selected.id ? 'secondary' : 'outline'}
                      className="h-ctl shrink-0 text-xs"
                      onClick={() => store.setActiveEnvId(store.activeEnvId === selected.id ? null : selected.id)}
                      title={store.activeEnvId === selected.id
                        ? 'This is the active environment — its variables are applied to requests. Click to deactivate.'
                        : 'Make this the active environment: its variables will be applied to requests, overriding Collection Variables.'}
                    >
                      {store.activeEnvId === selected.id ? 'Active' : 'Set active'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-ctl w-ctl shrink-0 text-fg-mute"
                      onClick={() => {
                        const id = store.duplicateEnvironment(selected.id);
                        if (id) setSelectedEnvId(id);
                      }}
                      title="Duplicate environment"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        title="Export environment"
                        className="flex h-ctl w-ctl shrink-0 items-center justify-center rounded-md text-fg-mute transition-colors hover:bg-acc hover:text-fg"
                      >
                        <Download className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExport(selected, 'postman')}>Export (Postman)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExport(selected, 'native')}>Export (DevTool)</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-ctl w-ctl shrink-0 text-fg-mute hover:text-bad"
                      onClick={() => store.deleteEnvironment(selected.id)}
                      title="Delete environment"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <VarFilterBox rows={selected.variables} value={varFilter} onChange={setVarFilter} />
                  <KeyValueEditor
                    rows={selected.variables}
                    onChange={(variables) => store.updateEnvironment(selected.id, { variables })}
                    keyPlaceholder="Variable"
                    valuePlaceholder="Value"
                    masked={(row) => !!row.secret}
                    secretToggle
                    filterQuery={varFilter}
                  />
                  <p className="text-[11px] text-fg-mute">
                    Click the lock icon to mark a value secret — it stays masked here and is left out
                    of generated code, exports, and history the same way the Vault is.
                  </p>
                </div>
              ) : (
                // "Create an environment" with nothing to click left the user
                // hunting for the + beside a section caption. Put the action here.
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <p className="max-w-[22rem] text-xs text-fg-mute">
                    No environments yet. An environment is a set of variables you can switch on and
                    off — e.g. one for Dev, one for Prod — without editing your requests.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setSelectedEnvId(store.addEnvironment(store.activeCollectionId))}
                  >
                    <Plus className="h-3.5 w-3.5" /> New environment
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Every line in the left list — section captions and each environment row —
// is laid out on these two classes, so their labels share one left edge. The
// 12px slot always exists, holding the active dot or nothing; before this the
// rows with a dot started 20px right of the captions and the column read as
// ragged.
//
// Hover is a neutral tint (bg-bg-2), not accent — hover:bg-acc/60 read as a
// second, near-identical "selected" state next to the actual selected row's
// solid bg-acc, and at that opacity over default text it also cleared AA by
// less margin than either state should. Same fix as Sidebar's row selection.
const LIST_ROW = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-2/60';
const LIST_SLOT = 'flex w-3 shrink-0 items-center justify-center';

function Section({ title, onAdd, disabled, empty, emptyText = 'No environments', children }: {
  title: string; onAdd: () => void; disabled?: boolean; empty?: boolean; emptyText?: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between py-1 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={LIST_SLOT} aria-hidden />
          <SectionLabel className="min-w-0 truncate" title={title}>{title}</SectionLabel>
        </div>
        <IconButton size="xs" onClick={onAdd} disabled={disabled} title={`New ${title} environment`}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      {/* An empty section used to render a caption, a +, and then nothing —
          which reads as broken rather than as "there is nothing here yet". */}
      {empty
        ? <p className="py-1 pl-8 pr-3 text-[11px] text-fg-mute/70">{emptyText}</p>
        : children}
    </div>
  );
}

// Small rounded count pill — only shown once there's something to count, so a
// freshly-created (still-empty) environment doesn't carry a distracting "0"
// everywhere in the list.
function VarCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return <Badge pill size="xs" className="shrink-0">{count}</Badge>;
}

function EnvRow({ env, active, selected, onClick }: {
  env: { id: string; name: string; variables?: KeyValue[] }; active: boolean; selected: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={cn(LIST_ROW, selected && 'bg-acc-tint text-acc-ink')}>
      <span className={LIST_SLOT}>{active && <StatusDot tone="live" size="xs" title="Active environment" />}</span>
      <span className="min-w-0 flex-1 truncate">{env.name}</span>
      <VarCountBadge count={varCount(env.variables)} />
    </button>
  );
}

// Below this many rows, the table alone is easy enough to scan — the search
// box would just be one more thing on screen for a handful of variables. Past
// it (an environment carrying dozens of vars), finding one by eye gets slow
// enough that the box earns its place.
const VAR_FILTER_THRESHOLD = 8;

function VarFilterBox({ rows, value, onChange }: { rows: KeyValue[]; value: string; onChange: (v: string) => void }) {
  if (rows.length <= VAR_FILTER_THRESHOLD) return null;
  return <SearchInput value={value} onChange={onChange} placeholder="Filter variables" className="h-ctl text-xs" />;
}
