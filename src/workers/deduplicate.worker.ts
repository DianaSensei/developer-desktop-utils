// `export {}` bắt buộc TypeScript coi file này là MODULE thay vì script toàn
// cục — không có `import`/`export` nào thì `tsc` từ chối `import
// '@/workers/deduplicate.worker'` trong test với lỗi "File is not a module".
// Không đổi hành vi lúc chạy (Worker thật cũng không quan tâm module hay
// script) — chỉ để `tsc --noEmit` (chạy trong `npm run build`) qua được.
export {};

type DedupeMode = 'preserve' | 'sort';

interface DedupeResult {
  output: string;
  original: number;
  unique: number;
  removed: number;
}

// A dedicated worker has no `event.origin` to check (it is always empty, and the
// port is only reachable from the page that constructed the worker), so validate
// the shape instead: an unexpected message is dropped rather than destructured.
function isRequest(v: unknown): v is { input: string; mode: DedupeMode } {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as { input?: unknown; mode?: unknown };
  return typeof m.input === 'string' && (m.mode === 'preserve' || m.mode === 'sort');
}

self.onmessage = ({ data }: MessageEvent<unknown>) => {
  if (!isRequest(data)) return;
  const { input, mode } = data;
  const lines = input.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const unique = mode === 'sort' ? [...new Set(lines)].sort() : [...new Set(lines)];
  const result: DedupeResult = {
    output: unique.join('\n'),
    original: lines.length,
    unique: unique.length,
    removed: lines.length - unique.length,
  };
  self.postMessage(result);
};
