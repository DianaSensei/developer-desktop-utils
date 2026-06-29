// Small display helpers shared across the RabbitMQ views.

export function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatNumber(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

/** Rate from a `*_details.rate` field → e.g. "12.0/s". */
export function formatRate(rate?: number): string {
  if (rate == null || !Number.isFinite(rate)) return '0/s';
  return `${rate.toFixed(rate >= 100 ? 0 : 1)}/s`;
}

/** Uptime in milliseconds → "3d 4h", "5h 12m", "2m". */
export function formatUptime(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function formatTimestamp(ms?: number): string {
  if (ms == null) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}
