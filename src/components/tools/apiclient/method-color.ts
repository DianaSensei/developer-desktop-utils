// Per-method color tokens shared across sidebar, address bar, tabs, and history.
// Three scales:
//   methodColor      — text color only (labels, dropdowns)
//   methodBg         — subtle background tint for the method selector area
//   methodBadgeStyle — full pill: bg + text, for sidebar tree badges

import type { HttpMethod } from './types';

const TEXT: Record<HttpMethod, string> = {
  GET:     'text-emerald-600 dark:text-emerald-400',
  POST:    'text-amber-600  dark:text-amber-400',
  PUT:     'text-blue-600   dark:text-blue-400',
  PATCH:   'text-violet-600 dark:text-violet-400',
  DELETE:  'text-red-600    dark:text-red-400',
  HEAD:    'text-muted-foreground',
  OPTIONS: 'text-muted-foreground',
};

// Subtle tint behind the method selector in the address bar — no text color.
const BG: Record<HttpMethod, string> = {
  GET:     'bg-emerald-50 dark:bg-emerald-950/50',
  POST:    'bg-amber-50   dark:bg-amber-950/50',
  PUT:     'bg-blue-50    dark:bg-blue-950/50',
  PATCH:   'bg-violet-50  dark:bg-violet-950/50',
  DELETE:  'bg-red-50     dark:bg-red-950/50',
  HEAD:    'bg-transparent',
  OPTIONS: 'bg-transparent',
};

// Full pill badge for the sidebar tree — bg + text color in one token.
const BADGE: Record<HttpMethod, string> = {
  GET:     'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  POST:    'bg-amber-100   dark:bg-amber-900/40   text-amber-700   dark:text-amber-400',
  PUT:     'bg-blue-100    dark:bg-blue-900/40    text-blue-700    dark:text-blue-400',
  PATCH:   'bg-violet-100  dark:bg-violet-900/40  text-violet-700  dark:text-violet-400',
  DELETE:  'bg-red-100     dark:bg-red-900/40     text-red-700     dark:text-red-400',
  HEAD:    'bg-muted/60 text-muted-foreground',
  OPTIONS: 'bg-muted/60 text-muted-foreground',
};

export const methodColor      = (m: HttpMethod): string => TEXT[m]  ?? 'text-foreground';
export const methodBg         = (m: HttpMethod): string => BG[m]   ?? 'bg-transparent';
export const methodBadgeStyle = (m: HttpMethod): string => BADGE[m] ?? 'bg-muted/60 text-foreground';
