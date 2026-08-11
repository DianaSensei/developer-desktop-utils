// Data-driven runs (Postman/Bruno "Run with data file"): parse a CSV or JSON
// file into a list of rows, where each row is a map of variable name → value
// that's bound for one iteration of the runner.

import type { VarMap } from './types';

export type DataRow = VarMap;

// Excel and many other exporters prefix UTF-8 files with a byte-order mark.
// Left in place it becomes part of the first header, so `id` silently arrives as
// `﻿id` and {{id}} never resolves.
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// Delimiters we recognise. Comma is the default; spreadsheets in locales that
// use a comma decimal separator export semicolons, and tab-separated exports are
// common enough to be worth handling.
const DELIMITERS = [',', ';', '\t'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

// Pick the delimiter by counting unquoted occurrences in the header line — the
// one that splits it into the most fields wins.
export function sniffDelimiter(text: string): Delimiter {
  let headerLine = '';
  let inQuotes = false;
  for (const c of text) {
    if (c === '"') inQuotes = !inQuotes;
    if (c === '\n' && !inQuotes) break;
    headerLine += c;
  }
  let best: Delimiter = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const c of headerLine) {
      if (c === '"') quoted = !quoted;
      else if (c === d && !quoted) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

// Parse a CSV string into objects keyed by the header row. Handles quoted
// fields, embedded delimiters/quotes ("" → "), and CRLF/LF line endings.
function parseCsv(text: string, delimiter: Delimiter): DataRow[] {
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
    } else if (c === delimiter) {
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

// What a parsed data file provides, alongside the rows themselves.
export interface ParsedDataFile {
  rows: DataRow[];
  format: 'csv' | 'json';
  /** Only meaningful for CSV. */
  delimiter?: Delimiter;
  /** Column names in file order (JSON: key order of the first row). */
  columns: string[];
}

// Parse a data file by extension (falls back to sniffing: '[' or '{' → JSON).
// Throws a friendly error on malformed input.
export function parseDataFile(name: string, raw: string): ParsedDataFile {
  const text = stripBom(raw);
  const isJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text);
  try {
    if (isJson) {
      const rows = parseJsonRows(text);
      if (rows.length === 0) throw new Error('No data rows found.');
      return { rows, format: 'json', columns: dataColumns(rows) };
    }
    const delimiter = sniffDelimiter(text);
    const rows = parseCsv(text, delimiter);
    if (rows.length === 0) throw new Error('No data rows found.');
    return { rows, format: 'csv', delimiter, columns: dataColumns(rows) };
  } catch (e) {
    throw new Error(`Couldn't parse ${isJson ? 'JSON' : 'CSV'} data file: ${(e as Error).message}`);
  }
}

// The set of variable names a data file provides (union of all row keys), in
// first-seen order, for display in the runner.
export function dataColumns(rows: DataRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

export const DELIMITER_LABEL: Record<Delimiter, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
};
