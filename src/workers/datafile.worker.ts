// Parses a Runner data file (CSV/JSON) off the main thread. A 100k-row CSV
// takes real time to walk character-by-character (parseDataFile) and to
// derive its column list — doing that synchronously in the dialog's onClick
// handler would freeze the UI for the whole parse. The parsing logic itself
// lives in datafile.ts (pure, no DOM) so it can be unit-tested without a
// worker and reused here unchanged.

import { parseDataFile } from '@/components/tools/apiclient/datafile';

// A dedicated worker is delivered messages with an EMPTY origin: the spec
// gives `worker.postMessage()` an empty-string origin, and the port is only
// reachable from the page that constructed the worker (checksum.worker.ts
// carries the same note, and the app's three other workers validate shape
// alone for exactly this reason). '' therefore has to be in this set —
// accepting only `self.location.origin`, as the first version of this guard
// did, silently dropped every message and the parse simply never ran. The
// same-origin entry stays for any engine that does populate the field.
const TRUSTED_MESSAGE_ORIGINS = new Set<string>(['', self.location.origin]);

/** Exported for its own test: this predicate is the whole security boundary. */
export const isTrustedOrigin = (origin: string): boolean => TRUSTED_MESSAGE_ORIGINS.has(origin);

function isRequest(v: unknown): v is { name: string; text: string } {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as { name?: unknown; text?: unknown };
  return typeof m.name === 'string' && typeof m.text === 'string';
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isTrustedOrigin(event.origin)) return;
  const { data } = event;
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
