// Paste a cURL command to create a request (Bruno's "Import cURL").

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { parseCurl } from './curl';
import type { ApiStore } from './store';

export function ImportCurlDialog({ store, open, onClose }: { store: ApiStore; open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    setError(null);
    try {
      const req = parseCurl(text);
      if (!req.url.trim()) { setError('No URL found in the cURL command.'); return; }
      const collectionId = store.activeCollectionId ?? store.collections[0]?.id;
      if (!collectionId) { setError('Create a collection first.'); return; }
      store.addRequest(collectionId, req);
      setText('');
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Could not parse the cURL command.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Import cURL</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"curl -X POST https://api.example.com/login \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"user\":\"me\"}'"}
            className="min-h-[180px] font-mono text-xs"
            spellCheck={false}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleImport} disabled={!text.trim()}>Import</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
