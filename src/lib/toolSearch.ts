/**
 * Tool search shared by the sidebar and ⌘K, so both give the same results.
 */

export interface SearchableTool {
  label: string;
  description: string;
  keywords?: string[];
}

/**
 * Searches label, description and keywords ("epoch" finds Date/Time).
 * Every word of a multi-word query must match somewhere (AND), not
 * necessarily adjacent.
 */
export function toolMatchesQuery(tool: SearchableTool, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [tool.label, tool.description, ...(tool.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/**
 * How well a matching tool fits, for ordering results: lower is better.
 * The label beats keywords and description, and a label that starts with
 * the query beats one that only contains it — so "js" puts JSON first.
 */
export function toolMatchRank(tool: SearchableTool, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = tool.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/[\s/·&-]+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if ((tool.keywords ?? []).some((k) => k.toLowerCase().startsWith(q))) return 3;
  return 4;
}

/** Matching tools, best first; ties keep the input order. */
export function searchTools<T extends SearchableTool>(tools: T[], query: string): T[] {
  return tools
    .filter((t) => toolMatchesQuery(t, query))
    .map((t, i) => ({ t, i, r: toolMatchRank(t, query) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}
