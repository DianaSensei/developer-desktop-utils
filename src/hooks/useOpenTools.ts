import { useEffect, useState } from 'react';

// How many session tabs the strip keeps before evicting the oldest —
// enough to hold a real working set without turning into a second sidebar.
const MAX_OPEN_TOOLS = 8;

/**
 * Tracks which tools have been visited in this app session, in visit order,
 * for the "open tools" tab strip (App.tsx) — a set of quick-jump shortcuts
 * distinct from Favorites (hand-picked) and the sidebar's own order. Purely
 * in-memory: it resets on app restart because "this session" is exactly what
 * it means to track, not a persisted workspace.
 *
 * Settings is deliberately excluded — visiting it is usually incidental
 * (toggling a tool, checking for updates) rather than "work" worth pinning a
 * tab for, and CommandPalette already special-cases it the same way.
 */
export function useOpenTools(activeToolId: string) {
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    if (activeToolId === 'settings') return;
    setOpenIds((prev) => {
      if (prev.includes(activeToolId)) return prev;
      const next = [...prev, activeToolId];
      return next.length > MAX_OPEN_TOOLS ? next.slice(next.length - MAX_OPEN_TOOLS) : next;
    });
  }, [activeToolId]);

  const closeTool = (id: string) => setOpenIds((prev) => prev.filter((t) => t !== id));

  return { openIds, closeTool };
}
