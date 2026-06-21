// Tailwind text color per HTTP method — shared across the sidebar, request bar,
// and history so a method always reads the same color.

import type { HttpMethod } from './types';

const COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-amber-600 dark:text-amber-400',
  PUT: 'text-blue-600 dark:text-blue-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-destructive',
  HEAD: 'text-muted-foreground',
  OPTIONS: 'text-muted-foreground',
};

export const methodColor = (method: HttpMethod): string => COLORS[method] ?? 'text-foreground';
