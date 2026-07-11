import { useCallback, useRef } from 'react';
import { storageGet, storageSet, wasFreshInstall } from '@/lib/persistentStore';
import { TOOL_GUIDE_VERSIONS } from '@/lib/toolGuides';
import { TOOL_DEFS } from '@/lib/toolDefs';

const SEEN_KEY = 'devtool-guide-seen-versions';

function currentVersion(toolId: string): number {
  return TOOL_GUIDE_VERSIONS[toolId] ?? 1;
}

function loadSeen(): Record<string, number> {
  try {
    const raw = storageGet(SEEN_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to a fresh map below
  }

  // No seen map yet. An existing install (upgrading to a version that ships
  // this tracking) gets every currently-known tool backfilled as "seen" at
  // its current version, so the upgrade doesn't retroactively pop a guide
  // for every tool they already know. A brand-new install starts empty, so
  // each tool's first-ever open naturally shows its guide once.
  const seeded: Record<string, number> = {};
  if (!wasFreshInstall()) {
    for (const tool of TOOL_DEFS) seeded[tool.id] = currentVersion(tool.id);
    seeded.settings = currentVersion('settings');
  }
  storageSet(SEEN_KEY, JSON.stringify(seeded));
  return seeded;
}

/**
 * Tracks which version of each tool's "how to use" guide the user has last
 * seen, so a tool whose guide content changed (dev bumped its entry in
 * TOOL_GUIDE_VERSIONS) auto-shows its guide once, the next time that tool is
 * opened.
 */
export function useToolGuideTracking() {
  const seenRef = useRef<Record<string, number> | null>(null);
  if (seenRef.current === null) seenRef.current = loadSeen();

  const shouldAutoShow = useCallback((toolId: string) => {
    return (seenRef.current![toolId] ?? 0) < currentVersion(toolId);
  }, []);

  const markSeen = useCallback((toolId: string) => {
    const seen = seenRef.current!;
    const version = currentVersion(toolId);
    if (seen[toolId] === version) return;
    seen[toolId] = version;
    storageSet(SEEN_KEY, JSON.stringify(seen));
  }, []);

  return { shouldAutoShow, markSeen };
}
