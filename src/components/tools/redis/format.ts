/** Parse Redis `INFO` output into `{ section: { key: value } }`. */
export function parseInfo(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = 'Other';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      current = line.slice(1).trim() || 'Other';
      sections[current] ??= {};
      continue;
    }
    const i = line.indexOf(':');
    if (i === -1) continue;
    sections[current] ??= {};
    sections[current][line.slice(0, i)] = line.slice(i + 1);
  }
  return sections;
}

export function formatUptime(seconds?: string | number): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && m) parts.push(`${m}m`);
  return parts.length ? parts.join(' ') : '<1m';
}

export function formatBytesHuman(human?: string): string {
  return human?.trim() || '—';
}

export function formatNumber(n?: string | number | null): string {
  if (n == null) return '—';
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString() : String(n);
}

export function hitRate(hits?: string, misses?: string): string {
  const h = Number(hits ?? 0);
  const m = Number(misses ?? 0);
  const total = h + m;
  if (!total) return '—';
  return `${((h / total) * 100).toFixed(1)}%`;
}
