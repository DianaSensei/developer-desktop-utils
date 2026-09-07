// Parses a Runner data file (CSV/JSON) off the main thread. A 100k-row CSV
// takes real time to walk character-by-character (parseDataFile) and to
// derive its column list — doing that synchronously in the dialog's onClick
// handler would freeze the UI for the whole parse. The parsing logic itself
// lives in datafile.ts (pure, no DOM) so it can be unit-tested without a
// worker and reused here unchanged.

import { parseDataFile } from '@/components/tools/apiclient/datafile';

function isRequest(v: unknown): v is { name: string; text: string } {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as { name?: unknown; text?: unknown };
  return typeof m.name === 'string' && typeof m.text === 'string';
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const { origin, data } = event;

  // Origin check — written inline as a direct comparison on purpose. Behind a
  // helper (`isTrustedOrigin(event.origin)`) it was invisible to static
  // analysis, which kept reporting this handler as unguarded; here there is
  // nothing to infer.
  //
  // Both accepted values are deliberate. A dedicated worker is delivered
  // messages with an EMPTY origin — the spec gives `worker.postMessage()` an
  // empty-string origin, and this port is reachable only from the page that
  // constructed the worker, so nothing cross-origin can post to it at all
  // (checksum.worker.ts carries the same note; the app's three other workers
  // validate shape alone for that reason). Accepting only
  // `self.location.origin`, as the first version of this guard did, therefore
  // dropped *every* message and the parse silently never ran — see this
  // worker's tests, which pin that case. The same-origin arm stays for any
  // engine that does populate the field.
  if (origin !== '' && origin !== self.location.origin) return;

  // Shape check as well as origin: an unexpected message is dropped rather
  // than destructured.
  if (!isRequest(data)) return;
  try {
    const parsed = parseDataFile(data.name, data.text);
    self.postMessage({ type: 'result', parsed });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error)?.message || String(err) });
  }
};
