// Ranking for ⌘P "Go to File". Every whitespace-separated token must match
// the file somewhere; the file name outranks the folder path, a prefix
// outranks a substring, and a loose in-order subsequence ("edst" →
// "editor/store.ts") still counts, last.

export interface RankableFile {
  path: string;
  rel: string;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

function scoreToken(name: string, rel: string, token: string): number {
  if (name === token) return 120;
  if (name.startsWith(token)) return 100;
  if (name.includes(token)) return 70;
  if (rel.includes(token)) return 40;
  if (isSubsequence(token, name)) return 25;
  if (isSubsequence(token, rel)) return 10;
  return 0;
}

export function rankFiles<T extends RankableFile>(files: T[], query: string, limit = 50): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return files.slice(0, limit);
  const scored: { file: T; score: number }[] = [];
  for (const file of files) {
    const rel = file.rel.toLowerCase();
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    let score = 0;
    for (const t of tokens) {
      const s = scoreToken(name, rel, t);
      if (s === 0) { score = 0; break; }
      score += s;
    }
    if (score > 0) scored.push({ file, score });
  }
  // Shallower paths first on ties; stable otherwise so rows don't shuffle.
  scored.sort((a, b) => b.score - a.score || a.file.rel.length - b.file.rel.length);
  return scored.slice(0, limit).map((s) => s.file);
}
