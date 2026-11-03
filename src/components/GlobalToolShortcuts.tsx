// Opens a tool from anywhere in the app with the key combo the user gave it
// (Settings → Keyboard Shortcuts; model in lib/toolShortcuts.ts). Listens in
// the capture phase so the binding wins over a tool's own shortcut, which
// Settings warns about when assigning. Render once inside <Router> and the
// Feature/Workspace providers.

import { useEffect, useMemo, useRef } from 'react';
import { useFeatures } from '@/contexts/FeatureContext';
import { useWorkspaces } from '@/contexts/WorkspaceContext';
import { useSharedSetting } from '@/hooks/useSharedSetting';
import { allTools } from '@/lib/toolRegistry';
import {
  TOOL_SHORTCUTS_KEY, comboFromEvent, serializeCombo, shortcutIndex, type ToolShortcutMap,
} from '@/lib/toolShortcuts';

/** Marks the element recording a new shortcut; keys pressed there are not run. */
export const RECORDER_ATTR = 'data-shortcut-recorder';

export function useToolShortcuts() {
  return useSharedSetting<ToolShortcutMap>(TOOL_SHORTCUTS_KEY, {});
}

export function GlobalToolShortcuts() {
  const [map] = useToolShortcuts();
  const { isFeatureEnabled, toggleFeature } = useFeatures();
  const { openTool } = useWorkspaces();
  const index = useMemo(() => shortcutIndex(map), [map]);
  const latest = useRef({ index, isFeatureEnabled, toggleFeature, openTool });
  latest.current = { index, isFeatureEnabled, toggleFeature, openTool };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.getModifierState?.('AltGraph')) return;
      const { index: idx, isFeatureEnabled: enabled, toggleFeature: toggle, openTool: open } = latest.current;
      if (idx.size === 0) return;
      const target = e.target as Element | null;
      if (target?.closest?.(`[${RECORDER_ATTR}]`)) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const toolId = idx.get(serializeCombo(combo));
      if (!toolId || !allTools.some((t) => t.featureId === toolId)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      // Like the command palette: a turned-off tool is turned on, then opened.
      if (toolId !== 'settings' && !enabled(toolId)) toggle(toolId);
      open(toolId);
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  return null;
}
