import {
  Binary,
  Braces,
  CaseSensitive,
  Clock,
  Dices,
  FileCode2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TOOL_DEFS, TOOL_DEF_MAP, DEFAULT_TOOL_ORDER, type ToolDef } from '@/lib/toolDefs';

/**
 * Groups related tools into single sidebar entries.
 *
 * - A group needs at least two tools; large tools (API Client, Mock Server,
 *   Time Tracker...) stand alone and render as before.
 * - Search results list tools, not groups: typing "cron" shows Cron itself.
 *
 * Navigation only: no tool is removed and no route changes.
 */

export interface ToolGroup {
  id: string;
  /** Sidebar label; shorter than tool labels since it covers several tools. */
  label: string;
  icon: LucideIcon;
  /** In sub-tab order; the first is the target when the group is clicked. */
  toolIds: string[];
}

/** Real groups only (2+ tools). Tools not listed here stand alone. */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'g-text',
    label: 'Text',
    icon: CaseSensitive,
    toolIds: ['text-transform', 'text-counter', 'deduplicate'],
  },
  {
    id: 'g-json',
    label: 'JSON & Data',
    icon: Braces,
    toolIds: ['json', 'data-converter'],
  },
  {
    id: 'g-format',
    label: 'Format',
    icon: FileCode2,
    toolIds: ['sql-formatter', 'markdown'],
  },
  {
    id: 'g-encode',
    label: 'Encode & Hash',
    icon: Binary,
    toolIds: ['base64', 'jwt'],
  },
  {
    id: 'g-time',
    label: 'Time',
    icon: Clock,
    toolIds: ['unix-time', 'cron-generator'],
  },
  {
    id: 'g-generate',
    label: 'Generate',
    icon: Dices,
    toolIds: ['generator', 'qrcode', 'lucky-wheel'],
  },
];

/** Tool id → its group. Standalone tools are absent. */
export const GROUP_OF_TOOL = new Map<string, ToolGroup>(
  TOOL_GROUPS.flatMap((g) => g.toolIds.map((id) => [id, g] as const)),
);

/**
 * A sidebar entry: a standalone tool or a group. `tools` is never empty and
 * holds enabled tools only.
 */
export interface NavEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  /** A real group (2+ enabled tools) or a standalone tool. */
  isGroup: boolean;
  tools: ToolDef[];
}

export interface BuildNavOptions {
  /** Enabled tool ids. Disabled tools appear nowhere. */
  enabledIds: Set<string>;
  /** User's drag-and-drop order; DEFAULT_TOOL_ORDER when empty. */
  order?: string[];
  /** Favorite tool ids, in the order they were marked. */
  favorites?: string[];
}

/**
 * Builds the sidebar entries when not searching. Rules, applied in order:
 *
 *   1. A group takes the position of its earliest member in the user's
 *      order, so existing orders keep working without migration.
 *   2. Favorites come first; a group is a favorite if any member is.
 *   3. A group with one enabled tool collapses into that tool's own entry.
 */
export function buildNavEntries({
  enabledIds,
  order = [],
  favorites = [],
}: BuildNavOptions): NavEntry[] {
  const effectiveOrder = order.length ? order : DEFAULT_TOOL_ORDER;
  const rank = new Map(effectiveOrder.map((id, i) => [id, i]));
  // Tools missing from the saved order (added later) go last.
  const rankOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;

  const seen = new Set<string>();
  const entries: Array<NavEntry & { sort: number; fav: number }> = [];

  for (const def of TOOL_DEFS) {
    if (!enabledIds.has(def.id) || seen.has(def.id)) continue;

    const group = GROUP_OF_TOOL.get(def.id);
    const members = group
      ? group.toolIds.filter((id) => enabledIds.has(id))
      : [def.id];

    for (const id of members) seen.add(id);

    const tools = members
      .map((id) => TOOL_DEF_MAP.get(id))
      .filter((t): t is ToolDef => Boolean(t));
    if (!tools.length) continue;

    // A group with one tool collapses to a single entry (rule 3).
    const isGroup = Boolean(group) && tools.length > 1;

    const favIdx = members
      .map((id) => favorites.indexOf(id))
      .filter((i) => i >= 0);

    entries.push({
      key: isGroup ? group!.id : tools[0].id,
      label: isGroup ? group!.label : tools[0].label,
      icon: isGroup ? group!.icon : tools[0].icon,
      isGroup,
      tools,
      sort: Math.min(...members.map(rankOf)),
      fav: favIdx.length ? Math.min(...favIdx) : -1,
    });
  }

  entries.sort((a, b) => {
    const aFav = a.fav >= 0;
    const bFav = b.fav >= 0;
    if (aFav !== bFav) return aFav ? -1 : 1;
    if (aFav && bFav) return a.fav - b.fav;
    return a.sort - b.sort;
  });

  return entries.map(({ sort: _sort, fav: _fav, ...entry }) => entry);
}

/** Number of favorite entries at the top, for the divider. */
export function countFavoriteEntries(entries: NavEntry[], favorites: string[]): number {
  return entries.filter((e) => e.tools.some((t) => favorites.includes(t.id))).length;
}

/**
 * Reorders a flat list of tool ids so group members are adjacent, at the
 * earliest member's position (rule 1 of `buildNavEntries`). Used by the
 * Settings tool list, which includes disabled tools and no favorites.
 */
export function clusterToolOrder(ids: string[]): string[] {
  const present = new Set(ids);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const group = GROUP_OF_TOOL.get(id);
    const members = group ? group.toolIds.filter((mid) => present.has(mid)) : [id];
    for (const mid of members) {
      if (seen.has(mid)) continue;
      seen.add(mid);
      result.push(mid);
    }
  }
  return result;
}
