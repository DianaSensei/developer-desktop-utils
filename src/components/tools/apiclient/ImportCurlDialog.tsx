// Paste a cURL command to create a request (Bruno's "Import cURL").

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { TextEditor } from '@/design-system';
import { hasSessionCredentials, looksLikeCmdFormat, parseCurl } from './curl';
import type { ApiStore } from './store';
import { t } from './i18n';

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
      if (!req.url.trim()) { setError(t('curl.noUrl')); return; }
      const collectionId = store.activeCollectionId ?? store.collections[0]?.id;
      if (!collectionId) { setError(t('curl.createCollection')); return; }
      store.addRequest(collectionId, req);
      setText('');
      onClose();
    } catch (e) {
      setError((e as Error).message || t('curl.parseFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" scrollable>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{t('side.importCurl')}</DialogTitle>
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
            <Callout tone="warning" size="sm" title={t('curl.cmdTitle')}>
              {t('curl.cmdA')}{' '}
              <strong className="text-fg">Copy → Copy as cURL (bash)</strong>{t('curl.cmdB')}{' '}
              <code className="rounded bg-bg-2 px-1">^</code> {t('curl.cmdC')}
            </Callout>
          )}
          {hasCreds && (
            <Callout tone="info" size="sm" title={t('curl.credTitle')}>
              {t('curl.credBody')}
            </Callout>
          )}
          {error && <Callout tone="error" size="sm">{error}</Callout>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
            <Button size="sm" onClick={handleImport} disabled={!text.trim()}>{t('import')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
