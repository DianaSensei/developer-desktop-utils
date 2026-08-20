import { useMemo, useState } from 'react';
import type { SortDirection } from '@/components/ui/data-table';

/**
 * Client-side column sort for a table whose rows are already fully loaded
 * (every container-tool list view: containers, images, volumes, networks).
 * `getters` maps a column key to a value accessor; sorting is stable and
 * falls back to string comparison unless both values are numbers.
 */
export function useSort<T>(rows: T[], getters: Record<string, (row: T) => string | number>, defaultKey?: string) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const sorted = useMemo(() => {
    const getter = sortKey ? getters[sortKey] : null;
    if (!getter) return rows;
    const withIndex = rows.map((row, index) => ({ row, index }));
    withIndex.sort((a, b) => {
      const av = getter(a.row);
      const bv = getter(b.row);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
      return a.index - b.index; // stable tie-break
    });
    return withIndex.map((w) => w.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  };

  const directionFor = (key: string): SortDirection | null => (sortKey === key ? sortDir : null);

  return { sorted, toggleSort, directionFor };
}
