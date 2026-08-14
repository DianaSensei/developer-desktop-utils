// Paste a cURL command to create a request (Bruno's "Import cURL").

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { TextEditor } from '@/design-system';
import { parseCurl } from './curl';
import type { ApiStore } from './store';

export function ImportCurlDialog({ store, open, onClose }: { store: ApiStore; open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);

  // CodeSurface doesn't expose an autoFocus prop (unlike the plain <textarea>
  // this replaced) — focus the CodeMirror content div directly once the
  // dialog has mounted it, so pasting a command still works immediately.
  useEffect(() => {
    if (!open) return;
    editorWrapRef.current?.querySelector<HTMLElement>('.cm-content')?.focus();
  }, [open]);

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
          <div ref={editorWrapRef}>
            <TextEditor
              value={text}
              onChange={setText}
              placeholder={"curl -X POST https://api.example.com/login \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"user\":\"me\"}'"}
              className="min-h-[180px]"
            />
          </div>
          {error && <Callout tone="error" size="sm">{error}</Callout>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleImport} disabled={!text.trim()}>Import</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
