// Runs user-supplied regular expressions off the main thread so a pathological
// pattern (catastrophic backtracking / ReDoS) freezes only this worker — which
// the UI terminates after a timeout — instead of locking up the whole app.

// `export {}` bắt buộc TypeScript coi file này là MODULE thay vì script toàn
// cục — xem ghi chú cùng nội dung trong `deduplicate.worker.ts`.
export {};

interface RegexRequest {
  id: number;
  pattern: string;
  flags: string;
  input: string;
  replacement: string;
  doReplace: boolean;
}

interface SerializedMatch {
  index: number;
  groups: (string | undefined)[]; // [fullMatch, group1, group2, ...]
}

interface RegexResponse {
  id: number;
  matches: SerializedMatch[];
  replaceOutput: string;
  error: string;
}

const MAX_MATCHES = 500;

// A dedicated worker has no `event.origin` to check (it is always empty, and the
// port is only reachable from the page that constructed the worker), so validate
// the shape instead: an unexpected message is dropped rather than destructured.
function isRegexRequest(v: unknown): v is RegexRequest {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Partial<RegexRequest>;
  return typeof m.id === 'number' && Number.isFinite(m.id)
    && typeof m.pattern === 'string' && typeof m.flags === 'string'
    && typeof m.input === 'string' && typeof m.replacement === 'string'
    && typeof m.doReplace === 'boolean';
}

self.onmessage = ({ data }: MessageEvent<unknown>) => {
  if (!isRegexRequest(data)) return;
  const { id, pattern, flags, input, replacement, doReplace } = data;
  const res: RegexResponse = { id, matches: [], replaceOutput: '', error: '' };

  if (!pattern) {
    self.postMessage(res);
    return;
  }

  try {
    const matches: SerializedMatch[] = [];
    if (flags.includes('g') || flags.includes('y')) {
      const re = new RegExp(pattern, flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(input)) !== null) {
        matches.push({ index: m.index, groups: Array.from(m) });
        if (m.index === re.lastIndex) re.lastIndex++;
        if (matches.length >= MAX_MATCHES) break;
      }
    } else {
      const m = new RegExp(pattern, flags).exec(input);
      if (m) matches.push({ index: m.index, groups: Array.from(m) });
    }
    res.matches = matches;

    if (doReplace) {
      res.replaceOutput = input.replace(new RegExp(pattern, flags), replacement);
    }
  } catch (err) {
    res.error = err instanceof Error ? err.message : 'Invalid regex';
  }

  self.postMessage(res);
};
