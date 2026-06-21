// Data-driven runs (Postman/Bruno "Run with data file"): parse a CSV or JSON
// file into a list of rows, where each row is a map of variable name → value
// that's bound for one iteration of the runner.

import type { VarMap } from './types';

export type DataRow = VarMap;

// Parse a CSV string into objects keyed by the header row. Handles quoted
// fields, embedded commas/quotes ("" → "), and CRLF/LF line endings.
function parseCsv(text: string): DataRow[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow; the following \n (if any) ends the row
    } else {
      field += c;
    }
  }
  // flush trailing field/row if the file doesn't end with a newline
  if (field !== '' || row.length) pushRow();

  // drop fully-empty trailing rows
  const cleaned = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (cleaned.length < 1) return [];

  const headers = cleaned[0].map((h) => h.trim());
  return cleaned.slice(1).map((cells) => {
    const obj: DataRow = {};
    headers.forEach((h, i) => { if (h) obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
}

// Coerce any JSON scalar to the string form used for {{var}} substitution;
// objects/arrays are JSON-stringified so they still interpolate sensibly.
function toStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

function parseJsonRows(text: string): DataRow[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((entry) => {
    const obj: DataRow = {};
    if (entry && typeof entry === 'object') {
      for (const [k, v] of Object.entries(entry as Record<string, unknown>)) obj[k] = toStr(v);
    }
    return obj;
  });
}

// Parse a data file by extension (falls back to sniffing: '[' or '{' → JSON).
// Throws a friendly error on malformed input.
export function parseDataFile(name: string, text: string): DataRow[] {
  const isJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text);
  try {
    const rows = isJson ? parseJsonRows(text) : parseCsv(text);
    if (rows.length === 0) throw new Error('No data rows found.');
    return rows;
  } catch (e) {
    throw new Error(`Couldn't parse ${isJson ? 'JSON' : 'CSV'} data file: ${(e as Error).message}`);
  }
}

// The set of variable names a data file provides (union of all row keys), for
// display in the runner.
export function dataColumns(rows: DataRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}
