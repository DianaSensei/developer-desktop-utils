// Read-only view of the current session's runtime variables (bru.setVar /
// pm.variables, plus the declarative Vars tab) — the one variable tier with no
// other UI to inspect it (environment vars have EnvironmentEditor, vault has
// VaultManager; runtime vars otherwise only surface via {{}} hover or
// console.log in a script). Reached from the status-bar "Vars" button.

import { Variable } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import type { VarMap } from './types';

interface Props {
  vars: VarMap;
  open: boolean;
  onClose: () => void;
}

export function RuntimeVarsInspector({ vars, open, onClose }: Props) {
  const rows = Object.entries(vars).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2"><Variable className="h-4 w-4" /> Runtime Variables</DialogTitle>
        </DialogHeader>

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
                </Tr>
              </Thead>
              <Tbody zebra>
                {rows.map(([key, value]) => (
                  <Tr key={key}>
                    <Td mono>{key}</Td>
                    <Td mono className="break-all">{value}</Td>
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
