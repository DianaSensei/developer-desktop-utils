import type { LucideIcon } from 'lucide-react';
import { DEFAULT_PLUGIN_ORDER, PLUGINS } from '@/platform';

/**
 * Tool metadata for the sidebar, Settings and search, derived from the
 * plugin registry (`src/plugins/<id>/plugin.ts` is the source of truth).
 * Keeps the `TOOL_DEFS` / `TOOL_DEF_MAP` / `DEFAULT_TOOL_ORDER` shape that
 * many modules read.
 */
export interface ToolDef {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /**
   * Extra search terms, e.g. "epoch" → Date/Time, "guid" → Generator,
   * "postman" → API Client.
   */
  keywords?: string[];
  /**
   * Experimental tool: badged wherever it is listed, and confirmed on every
   * visit through `ExperimentalGate` in App.tsx.
   */
  experimental?: boolean;
}

export const TOOL_DEFS: ToolDef[] = PLUGINS.map((p) => ({
  id: p.id,
  label: p.label,
  icon: p.icon,
  description: p.description,
  // Omit the fields when unset; tests distinguish absent from empty/false.
  ...(p.keywords.length > 0 ? { keywords: p.keywords } : {}),
  ...(p.experimental ? { experimental: true } : {}),
}));

export const TOOL_DEF_MAP = new Map(TOOL_DEFS.map((t) => [t.id, t]));

/**
 * Default sidebar order for new installs, from each manifest's `order`.
 */
export const DEFAULT_TOOL_ORDER: string[] = [...DEFAULT_PLUGIN_ORDER];
