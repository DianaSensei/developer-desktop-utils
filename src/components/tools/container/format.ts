/** Human-readable byte size, shared by Images/Volumes lists and the details
 *  dialogs — was duplicated per-view before. Docker uses `-1` for "not
 *  available" (e.g. a volume's UsageData.Size when the driver doesn't report
 *  it) — rendered as an em dash rather than a nonsense negative size. */
export function formatBytes(n: number | undefined | null): string {
  if (n === undefined || n === null || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
