// Read-only-turned-manageable view of the current session's runtime variables
// (bru.setVar / pm.variables, plus the declarative Vars tab) — the one
// variable tier with no other UI to inspect it (environment vars have
// EnvironmentEditor, vault has VaultManager; runtime vars otherwise only
// surface via {{}} hover or console.log in a script). Reached from the
// status-bar "Vars" button.
//
// Runtime vars win over every other tier (Collection env, Global env,
// Collection Variables — see engine.ts's precedence comment) and, unlike
// those, have no "No Environment" equivalent to switch them off: a value a
// script set once keeps applying to every send until it's explicitly cleared
// here or the app restarts. That combination — highest precedence, nothing
// else can turn it off — is exactly what makes a stale one look like a value
// is "hardcoded" somewhere when a script gets edited to stop setting it.

import { Eraser, Trash2, Variable } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { Callout } from '@/components/ui/callout';
import { IconButton } from '@/components/ui/icon-button';
import type { VarMap } from './types';

interface Props {
  vars: VarMap;
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  onDeleteVar: (key: string) => void;
}

export function RuntimeVarsInspector({ vars, open, onClose, onClear, onDeleteVar }: Props) {
  const rows = Object.entries(vars).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" scrollable>
        <DialogHeader className="h-14 flex-row items-center justify-between space-y-0 border-b px-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><Variable className="h-4 w-4" /> Runtime Variables</DialogTitle>
          <IconButton size="xs" onClick={onClear} disabled={rows.length === 0} title="Clear all runtime variables">
            <Eraser className="h-3.5 w-3.5" />
          </IconButton>
        </DialogHeader>

        {rows.length > 0 && (
          <Callout tone="info" size="sm" className="mx-4 mt-3">
            These win over a Collection or Global environment and Collection Variables of the same
            name — even with &ldquo;No Environment&rdquo; selected — and stay set until cleared here
            or the app restarts. If a request still looks like it&rsquo;s using an old value after
            editing a script or switching environments, check here first.
          </Callout>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-fg-mute">
              No runtime variables set yet. They're created by <code className="rounded bg-bg-2 px-1">bru.setVar(...)</code>{' '}
              / <code className="rounded bg-bg-2 px-1">pm.variables.set(...)</code> in a script, or the request's declarative
              Vars tab, and last for this session only — they reset when the app restarts.
            </p>
          ) : (
            <DataTable>
              <Thead sticky>
                <Tr>
                  <Th>Name</Th>
                  <Th>Value</Th>
                  <Th className="w-8" />
                </Tr>
              </Thead>
              <Tbody zebra>
                {rows.map(([key, value]) => (
                  <Tr key={key}>
                    <Td mono>{key}</Td>
                    <Td mono className="break-all">{value}</Td>
                    <Td>
                      <IconButton size="xs" onClick={() => onDeleteVar(key)} title={`Clear ${key}`} className="text-fg-mute hover:text-bad">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </DataTable>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
