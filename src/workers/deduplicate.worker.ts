type DedupeMode = 'preserve' | 'sort';

interface DedupeResult {
  output: string;
  original: number;
  unique: number;
  removed: number;
}

self.onmessage = ({ data }: MessageEvent<{ input: string; mode: DedupeMode }>) => {
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
