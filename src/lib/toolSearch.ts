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
