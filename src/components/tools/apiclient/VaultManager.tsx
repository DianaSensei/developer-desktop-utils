// The Vault — a local-only secret store kept separate from environments
// (Postman-style). Values are masked by default, never included in
// collection/Postman export or generated code snippets, and can't be read or
// overwritten by pre/post-request scripts. Reference a secret anywhere a
// request field accepts {{ }} with `{{vault.name}}`; it is only resolved into
// the actual outgoing request at send time (see engine.ts).

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KeyValueEditor } from './KeyValueEditor';
import type { ApiStore } from './store';

export function VaultManager({ store, open, onClose }: { store: ApiStore; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Vault</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <p className="text-[11px] text-muted-foreground">
            Local-only secrets, separate from environments. Reference one anywhere with{' '}
            <code className="rounded bg-muted px-1">{'{{vault.name}}'}</code>. Vault values are masked in the UI,
            excluded from collection/Postman export and generated code, and invisible to pre/post-request scripts —
            they're only resolved into the request actually sent.
          </p>
          <KeyValueEditor
            rows={store.vault}
            onChange={store.setVault}
            keyPlaceholder="Secret name"
            valuePlaceholder="Secret value"
            bulkEdit={false}
            masked
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
