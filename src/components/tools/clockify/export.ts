// Export time entries to CSV / JSON. Works in both the Tauri desktop app
// (native save dialog + fs plugin) and the web build (Blob download).

import type { Project, Tag, TimeEntry } from './store';
import { fmtHM, pad, timeOfDay, toDateInput, weekdayShort } from './time';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const MS_HOUR = 3_600_000;

/** Context needed to resolve ids → human-readable names for a row. */
export interface ExportContext {
  projectById: (id: string | null) => Project | undefined;
  tagById: (id: string) => Tag | undefined;
}

/** A single flattened, export-friendly view of a time entry. */
export interface ExportRow {
  date: string;
  weekday: string;
  description: string;
  subtask: string;
  project: string;
  tags: string;
  start: string;
  end: string;
  durationHm: string;
  durationDecimal: number;
  source: string;
}

/** Flatten entries into export rows, resolving project/tag names. Only completed entries. */
export function buildRows(entries: TimeEntry[], ctx: ExportContext): ExportRow[] {
  return entries
    .filter((e) => e.end !== null)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((e) => {
      const ms = (e.end as number) - e.start;
      return {
        date: toDateInput(e.start),
        weekday: weekdayShort(e.start),
        description: e.description.trim() || 'Untitled',
        subtask: e.subtask ?? '',
        project: ctx.projectById(e.projectId)?.name ?? '',
        tags: e.tagIds.map((id) => ctx.tagById(id)?.name).filter(Boolean).join(' '),
        start: timeOfDay(e.start, false),
        end: timeOfDay(e.end as number, false),
        durationHm: fmtHM(ms),
        durationDecimal: Math.round((ms / MS_HOUR) * 100) / 100,
        source: e.source,
      };
    });
}

const CSV_HEADERS = [
  'Date', 'Weekday', 'Description', 'Subtask', 'Project', 'Tags',
  'Start', 'End', 'Duration', 'Hours', 'Source',
] as const;

function csvCell(value: string | number | boolean): string {
  const s = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  // Quote when the cell contains a comma, quote, or newline (RFC 4180).
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [r.date, r.weekday, r.description, r.subtask, r.project, r.tags, r.start, r.end, r.durationHm, r.durationDecimal, r.source]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

export function toJson(rows: ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

/** Suggested filename stem, e.g. "time-entries-2026-06-24". */
export function exportFilename(ext: 'csv' | 'json'): string {
  const d = new Date();
  return `time-entries-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ext}`;
}

/** Save `text` to a file the user picks, locked to the given extension. */
export async function saveExport(suggestedName: string, ext: 'csv' | 'json', text: string): Promise<void> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return;
  }

  const mime = ext === 'csv' ? 'text/csv' : 'application/json';
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}
