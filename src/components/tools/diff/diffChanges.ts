// The exact changes inside @codemirror/merge's chunks, as a list with
// line:column positions on both sides — what the Diff tool's "Changes" panel
// shows and jumps to. Pure: chunks and documents in, rows out.

import type { Chunk } from '@codemirror/merge';
import type { Text } from '@codemirror/state';

/**
 * How the merge view diffs. The package default (`scanLimit: 500`) gives up
 * on precision for anything beyond a few hundred lines and returns ONE chunk
 * spanning from the first to the last change — every line in between shows
 * as changed. A higher scan limit keeps character-precise chunks for
 * documents of thousands of lines; the timeout keeps a pathological input
 * from freezing the UI (the result is then marked imprecise, see
 * `allPrecise`).
 */
export const DIFF_CONFIG = { scanLimit: 20_000, timeout: 300 } as const;

export type ChangeKind = 'insert' | 'delete' | 'replace';

export interface DiffChange {
  kind: ChangeKind;
  /** Absolute offsets in the original (A) and modified (B) documents. */
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  /** 1-based line and column where the change starts on each side. */
  lineA: number;
  colA: number;
  lineB: number;
  colB: number;
  removed: string;
  added: string;
}

/** Flattens every chunk's character-level changes, in document order. */
export function listChanges(chunks: readonly Chunk[], a: Text, b: Text, limit = Infinity): DiffChange[] {
  const out: DiffChange[] = [];
  for (const chunk of chunks) {
    for (const ch of chunk.changes) {
      if (out.length >= limit) return out;
      const fromA = chunk.fromA + ch.fromA, toA = chunk.fromA + ch.toA;
      const fromB = chunk.fromB + ch.fromB, toB = chunk.fromB + ch.toB;
      const la = a.lineAt(Math.min(fromA, a.length)), lb = b.lineAt(Math.min(fromB, b.length));
      out.push({
        kind: fromA === toA ? 'insert' : fromB === toB ? 'delete' : 'replace',
        fromA, toA, fromB, toB,
        lineA: la.number, colA: fromA - la.from + 1,
        lineB: lb.number, colB: fromB - lb.from + 1,
        removed: a.sliceString(fromA, toA),
        added: b.sliceString(fromB, toB),
      });
    }
  }
  return out;
}

/** False when the diff hit its time limit and fell back to coarse chunks. */
export const allPrecise = (chunks: readonly Chunk[]) => chunks.every((c) => c.precise);

/** One-line preview of changed text: whitespace made visible, long runs cut. */
export function previewText(s: string, max = 60): string {
  const shown = s.replace(/\n/g, '↵').replace(/\t/g, '⇥').replace(/ /g, '·');
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}
