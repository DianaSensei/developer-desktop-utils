// Paste a cURL command to create a request (Bruno's "Import cURL").

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { TextEditor } from '@/design-system';
import { hasSessionCredentials, looksLikeCmdFormat, parseCurl } from './curl';
import type { ApiStore } from './store';

export function ImportCurlDialog({ store, open, onClose }: { store: ApiStore; open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);

  // Live heads-up as the user pastes, independent of the Import click:
  // - cmd-format is a plain-text check (still useful even if the paste is
  //   incomplete/invalid so far).
  // - Credentials are checked off a real parse, swallowed here since a
  //   partial paste mid-edit isn't an error worth surfacing as one.
  const cmdFormat = useMemo(() => looksLikeCmdFormat(text), [text]);
  const hasCreds = useMemo(() => {
    if (!text.trim()) return false;
    try { return hasSessionCredentials(parseCurl(text)); } catch { return false; }
  }, [text]);

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
      <DialogContent size="lg" scrollable>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Import cURL</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div ref={editorWrapRef}>
            <TextEditor
              value={text}
              onChange={setText}
              placeholder={"curl -X POST https://api.example.com/login \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"user\":\"me\"}'"}
              className="min-h-[180px]"
            />
          </div>
          {cmdFormat && (
            <Callout tone="warning" size="sm" title="Looks like Windows cmd format">
              This parser only understands the bash/POSIX cURL format. In Chrome/Edge DevTools, use{' '}
              <strong className="text-fg">Copy → Copy as cURL (bash)</strong>, not "(cmd)" — the cmd version's{' '}
              <code className="rounded bg-bg-2 px-1">^</code> line continuations and quoting will likely mis-parse.
            </Callout>
          )}
          {hasCreds && (
            <Callout tone="info" size="sm" title="Includes a session credential">
              This command carries a Cookie, Authorization, or basic-auth value copied from that browser session —
              it's a snapshot, not a live login, so it can expire or be rotated independently of this request.
            </Callout>
          )}
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
