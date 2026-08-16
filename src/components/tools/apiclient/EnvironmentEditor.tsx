// Manage environments and their {{variables}}. Pick an environment on the left,
// edit its name and variable table on the right. The active environment's
// variables are substituted into URLs, headers, body, and auth at send time.

import { useEffect, useState } from 'react';
import { Download, Layers, Plus, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionLabel } from '@/components/ui/section-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { StatusDot } from '@/components/ui/status-dot';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { KeyValueEditor } from './KeyValueEditor';
import { pickJsonFile, saveJsonFile } from './fileio';
import { exportEnvironmentNative, exportEnvironmentPostman, importEnvironment as parseEnvironmentFile } from './environments-io';
import type { Environment } from './types';
import type { ApiStore } from './store';

interface Props {
  store: ApiStore;
  open: boolean;
  onClose: () => void;
}

// The list on the left can have either an environment or the active
// collection's shared "Collection Variables" bag selected.
type Selection = { kind: 'env'; id: string } | { kind: 'collectionVars' } | null;

export function EnvironmentEditor({ store, open, onClose }: Props) {
  const { environments } = store;
  const [selection, setSelection] = useState<Selection>(
    environments[0] ? { kind: 'env', id: environments[0].id } : null,
  );
  const [error, setError] = useState<string | null>(null);

  // Keep a valid selection as environments are added/removed.
  useEffect(() => {
    if (selection?.kind === 'collectionVars') return;
    if (selection?.kind === 'env' && environments.some((e) => e.id === selection.id)) return;
    setSelection(environments[0] ? { kind: 'env', id: environments[0].id } : null);
  }, [environments, selection]);

  const selected = selection?.kind === 'env' ? environments.find((e) => e.id === selection.id) ?? null : null;
  const activeCollection = store.collections.find((c) => c.id === store.activeCollectionId) ?? null;
  const collectionEnvs = environments.filter((e) => e.collectionId === store.activeCollectionId);
  const globalEnvs = environments.filter((e) => !e.collectionId);

  const handleImport = async () => {
    setError(null);
    try {
      const text = await pickJsonFile();
      if (!text) return;
      const env = parseEnvironmentFile(text);
      const id = store.importEnvironment(env);
      setSelection({ kind: 'env', id });
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
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle>Environments</DialogTitle>
          <IconButton onClick={handleImport} title="Import environment (Postman or this app's export)" className="mr-6">
            <Upload className="h-4 w-4" />
          </IconButton>
        </DialogHeader>
        {error && <Callout tone="error" size="sm" className="mx-4 mt-3">{error}</Callout>}

        <div className="flex h-[26rem]">
          {/* list — grouped by scope */}
          <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-r py-1">
            {activeCollection && (
              <div className="mb-2">
                <button
                  onClick={() => setSelection({ kind: 'collectionVars' })}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/60',
                    selection?.kind === 'collectionVars' && 'bg-accent',
                  )}
                >
                  <Layers className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">Collection Variables</span>
                </button>
              </div>
            )}
            <Section
              title={activeCollection?.name ?? 'Collection'}
              disabled={!store.activeCollectionId}
              onAdd={() => setSelection({ kind: 'env', id: store.addEnvironment(store.activeCollectionId) })}
            >
              {collectionEnvs.map((e) => (
                <EnvRow key={e.id} env={e} active={store.activeEnvId === e.id} selected={selection?.kind === 'env' && selection.id === e.id} onClick={() => setSelection({ kind: 'env', id: e.id })} />
              ))}
            </Section>
            <Section title="Global" onAdd={() => setSelection({ kind: 'env', id: store.addEnvironment(null) })}>
              {globalEnvs.map((e) => (
                <EnvRow key={e.id} env={e} active={store.activeEnvId === e.id} selected={selection?.kind === 'env' && selection.id === e.id} onClick={() => setSelection({ kind: 'env', id: e.id })} />
              ))}
            </Section>
          </div>

          {/* editor */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {selection?.kind === 'collectionVars' && activeCollection ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {activeCollection.name}
                  </span>
                  <span className="text-sm font-medium">Collection Variables</span>
                </div>
                <KeyValueEditor
                  rows={activeCollection.variables ?? []}
                  onChange={(variables) => store.setCollectionVariables(activeCollection.id, variables)}
                  keyPlaceholder="Variable"
                  valuePlaceholder="Value"
                />
                <p className="text-[11px] text-muted-foreground">
                  Shared defaults for every request in this collection, regardless of which
                  environment is active. An environment variable with the same name still
                  overrides it.
                </p>
              </div>
            ) : selected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {selected.collectionId ? (activeCollection?.name ?? 'Collection') : 'Global'}
                  </span>
                  <Input
                    value={selected.name}
                    onChange={(e) => store.updateEnvironment(selected.id, { name: e.target.value })}
                    className="h-ctl text-sm font-medium"
                  />
                  <Button
                    variant={store.activeEnvId === selected.id ? 'secondary' : 'outline'}
                    className="h-ctl shrink-0 text-xs"
                    onClick={() => store.setActiveEnvId(store.activeEnvId === selected.id ? null : selected.id)}
                  >
                    {store.activeEnvId === selected.id ? 'Active' : 'Set active'}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      title="Export environment"
                      className="flex h-ctl w-ctl shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                    className="h-ctl w-ctl shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => store.deleteEnvironment(selected.id)}
                    title="Delete environment"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <KeyValueEditor
                  rows={selected.variables}
                  onChange={(variables) => store.updateEnvironment(selected.id, { variables })}
                  keyPlaceholder="Variable"
                  valuePlaceholder="Value"
                  masked={(row) => !!row.secret}
                  secretToggle
                />
                <p className="text-[11px] text-muted-foreground">
                  Reference a variable anywhere with <code className="rounded bg-muted px-1">{'{{name}}'}</code>.{' '}
                  Click the lock icon to mark a value secret — it stays masked here and is left out of
                  generated code, exports, and history the same way the Vault is.
                </p>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Create an environment to add variables.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, onAdd, disabled, children }: {
  title: string; onAdd: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between px-3 py-1">
        <SectionLabel className="min-w-0 truncate">{title}</SectionLabel>
        <IconButton size="sm" onClick={onAdd} disabled={disabled} title={`New ${title} environment`} className="h-6 w-6">
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      {children}
    </div>
  );
}

function EnvRow({ env, active, selected, onClick }: {
  env: { id: string; name: string }; active: boolean; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/60',
        selected && 'bg-accent',
      )}
    >
      {active && <StatusDot tone="live" size="xs" />}
      <span className="truncate">{env.name}</span>
    </button>
  );
}
