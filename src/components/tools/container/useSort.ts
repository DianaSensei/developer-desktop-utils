import { useMemo, useState } from 'react';
import type { SortDirection } from '@/components/ui/data-table';

/**
 * Client-side column sort for a table whose rows are already fully loaded
 * (every container-tool list view: containers, images, volumes, networks).
 * `getters` maps a column key to a value accessor; sorting is stable and
 * falls back to string comparison unless both values are numbers.
 */
export function useSort<T>(rows: T[], getters: Record<string, (row: T) => string | number>, defaultKey?: string) {
  // Cột và chiều nằm CHUNG một state, cập nhật bằng đúng MỘT setState thuần —
  // không phải hai state riêng đổi lồng vào nhau.
  //
  // Bản trước: `setSortKey(prev => { ...; setSortDir(...); return prev; })` —
  // gọi `setSortDir` như một SIDE EFFECT bên trong hàm cập nhật của
  // `setSortKey`. Dưới `React.StrictMode` (bật ở main.tsx), React cố ý gọi
  // hàm cập nhật state HAI LẦN ở môi trường dev để bắt đúng loại lỗi này —
  // nên `setSortDir` bị gọi hai lần mỗi cú click, tự đảo hai lần và triệt
  // tiêu nhau: bấm cột đã sort không bao giờ chuyển sang giảm dần được, dù
  // code "nhìn" thì đúng logic. Gộp lại thành một state, một setState thuần
  // là cách duy nhất tắt được lớp bẫy này, không phải né StrictMode.
  const [sort, setSort] = useState<{ key: string | null; dir: SortDirection }>({
    key: defaultKey ?? null,
    dir: 'asc',
  });

  const sorted = useMemo(() => {
    const getter = sort.key ? getters[sort.key] : null;
    if (!getter) return rows;
    const withIndex = rows.map((row, index) => ({ row, index }));
    withIndex.sort((a, b) => {
      const av = getter(a.row);
      const bv = getter(b.row);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
      return a.index - b.index; // stable tie-break
    });
    return withIndex.map((w) => w.row);
    // `getters` is deliberately excluded: callers pass a fresh object literal
    // every render, so including it would make this memo never hit — but its
    // closures (e.g. a size map still loading in) can change independently of
    // `rows`/`sort`, so skip the memo instead of risking a stale sort order.
    // Sorting a docker-scale list (rarely thousands of rows) on every render
    // is cheap enough that this isn't a real perf cost.
  }, [rows, sort.key, sort.dir, getters]);

  const toggleSort = (key: string) => {
    setSort((prev) => (
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    ));
  };

  const directionFor = (key: string): SortDirection | null => (sort.key === key ? sort.dir : null);

  return { sorted, toggleSort, directionFor };
}
