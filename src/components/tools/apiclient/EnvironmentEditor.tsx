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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Environments</DialogTitle>
        </DialogHeader>

        <div className="flex h-[26rem]">
          {/* list */}
          <div className="flex w-52 shrink-0 flex-col border-r">
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {environments.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/60',
                    selectedId === e.id && 'bg-accent',
                  )}
                >
                  {store.activeEnvId === e.id && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                  <span className="truncate">{e.name}</span>
                </button>
              ))}
              {environments.length === 0 && (
                <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">No environments yet.</p>
              )}
            </div>
            <div className="border-t p-2">
              <Button
                variant="outline"
                className="h-8 w-full gap-1.5 text-xs"
                onClick={() => setSelectedId(store.addEnvironment())}
              >
                <Plus className="h-3.5 w-3.5" /> New environment
              </Button>
            </div>
          </div>

          {/* editor */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
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
