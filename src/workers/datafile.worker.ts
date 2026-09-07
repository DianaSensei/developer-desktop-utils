// Parses a Runner data file (CSV/JSON) off the main thread. A 100k-row CSV
// takes real time to walk character-by-character (parseDataFile) and to
// derive its column list — doing that synchronously in the dialog's onClick
// handler would freeze the UI for the whole parse. The parsing logic itself
// lives in datafile.ts (pure, no DOM) so it can be unit-tested without a
// worker and reused here unchanged.

import { parseDataFile } from '@/components/tools/apiclient/datafile';

const TRUSTED_MESSAGE_ORIGINS = new Set<string>([self.location.origin]);

function isRequest(v: unknown): v is { name: string; text: string } {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as { name?: unknown; text?: unknown };
  return typeof m.name === 'string' && typeof m.text === 'string';
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!TRUSTED_MESSAGE_ORIGINS.has(event.origin)) return;
  const { data } = event;
  if (!isRequest(data)) return;
  try {
    const parsed = parseDataFile(data.name, data.text);
    self.postMessage({ type: 'result', parsed });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error)?.message || String(err) });
  }
};
