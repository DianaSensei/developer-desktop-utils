// Manage environments and their {{variables}}. Pick an environment on the left,
// edit its name and variable table on the right. The active environment's
// variables are substituted into URLs, headers, body, and auth at send time.

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KeyValueEditor } from './KeyValueEditor';
import type { ApiStore } from './store';

interface Props {
  store: ApiStore;
  open: boolean;
  onClose: () => void;
}

export function EnvironmentEditor({ store, open, onClose }: Props) {
  const { environments } = store;
  const [selectedId, setSelectedId] = useState<string | null>(environments[0]?.id ?? null);

  // Keep a valid selection as environments are added/removed.
  useEffect(() => {
    if (selectedId && environments.some((e) => e.id === selectedId)) return;
    setSelectedId(environments[0]?.id ?? null);
  }, [environments, selectedId]);

  const selected = environments.find((e) => e.id === selectedId) ?? null;
  const activeCollection = store.collections.find((c) => c.id === store.activeCollectionId) ?? null;
  const collectionEnvs = environments.filter((e) => e.collectionId === store.activeCollectionId);
  const globalEnvs = environments.filter((e) => !e.collectionId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Environments</DialogTitle>
        </DialogHeader>

        <div className="flex h-[26rem]">
          {/* list — grouped by scope */}
          <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-r py-1">
            <Section
              title={activeCollection?.name ?? 'Collection'}
              disabled={!store.activeCollectionId}
              onAdd={() => setSelectedId(store.addEnvironment(store.activeCollectionId))}
            >
              {collectionEnvs.map((e) => (
                <EnvRow key={e.id} env={e} active={store.activeEnvId === e.id} selected={selectedId === e.id} onClick={() => setSelectedId(e.id)} />
              ))}
            </Section>
            <Section title="Global" onAdd={() => setSelectedId(store.addEnvironment(null))}>
              {globalEnvs.map((e) => (
                <EnvRow key={e.id} env={e} active={store.activeEnvId === e.id} selected={selectedId === e.id} onClick={() => setSelectedId(e.id)} />
              ))}
            </Section>
          </div>

          {/* editor */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {selected.collectionId ? (activeCollection?.name ?? 'Collection') : 'Global'}
                  </span>
                  <Input
                    value={selected.name}
                    onChange={(e) => store.updateEnvironment(selected.id, { name: e.target.value })}
                    className="h-8 text-sm font-medium"
                  />
                  <Button
                    variant={store.activeEnvId === selected.id ? 'secondary' : 'outline'}
                    className="h-8 shrink-0 text-xs"
                    onClick={() => store.setActiveEnvId(store.activeEnvId === selected.id ? null : selected.id)}
                  >
                    {store.activeEnvId === selected.id ? 'Active' : 'Set active'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
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
                />
                <p className="text-[11px] text-muted-foreground">
                  Reference a variable anywhere with <code className="rounded bg-muted px-1">{'{{name}}'}</code>.
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
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <button
          onClick={onAdd}
          disabled={disabled}
          title={`New ${title} environment`}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
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
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
      <span className="truncate">{env.name}</span>
    </button>
  );
}
