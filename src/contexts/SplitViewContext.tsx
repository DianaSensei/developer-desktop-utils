// Side-by-side tools: one workspace can show a second tool in a right-hand
// pane. The URL always belongs to the focused pane, so everything that reads
// the route (sidebar highlight, tab strip, header, ⌘K "current tool") follows
// focus, and opening a tool from anywhere replaces the focused pane's tool.
//
// State only; ToolHost.tsx lays the panes out. Lives above the header so the
// tab context menu and the header's split button can drive it.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistentState } from '@/hooks/usePersistentState';
import { toolPath } from '@/lib/toolRegistry';
import { getRecentTools } from '@/lib/recentTools';
import { IS_MAC } from '@/lib/platform';
import { useWorkspaces } from './WorkspaceContext';

export type Pane = 'left' | 'right';

interface SplitState {
  /** Tool in the right pane; null = no split. */
  right: string | null;
  /** Left pane width, percent. */
  ratio: number;
}

interface SplitViewValue {
  /** Tool in the left pane (the only pane without a split). */
  leftId: string | null;
  rightId: string | null;
  focused: Pane;
  ratio: number;
  setRatio: (ratio: number) => void;
  /** Shows `toolId` in the right pane and focuses it. */
  openToSide: (toolId: string) => void;
  closeSplit: () => void;
  /** Closes one pane; the other tool fills the window. */
  closePane: (pane: Pane) => void;
  /** Split with the most recently used other tab, or close the split. */
  toggleSplit: () => void;
  /** Swaps the two panes' tools. */
  swap: () => void;
  /** Focus a pane (clicking into it): its tool becomes the current route. */
  focusPane: (pane: Pane) => void;
  /** Where each tool was last, so focusing a pane restores its query string. */
  rememberLocation: (toolId: string, path: string) => void;
}

const SplitViewContext = createContext<SplitViewValue | null>(null);

export const MIN_RATIO = 25;
export const MAX_RATIO = 75;

export function SplitViewProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { activeToolId, active, tabs } = useWorkspaces();
  const [split, setSplit] = usePersistentState<SplitState>('devtool-split-view', { right: null, ratio: 50 });
  const [leftId, setLeftId] = useState<string | null>(activeToolId || null);
  const [focused, setFocused] = useState<Pane>('left');
  const locations = useRef(new Map<string, string>());
  const rightId = split.right && split.right !== leftId ? split.right : null;

  // The route changed (sidebar, ⌘K, a tab, a deep link): show that tool in
  // the focused pane, or just focus the pane that already has it.
  useEffect(() => {
    if (!activeToolId) return;
    if (rightId && activeToolId === rightId) { setFocused('right'); return; }
    if (activeToolId === leftId) { setFocused('left'); return; }
    if (rightId && focused === 'right') setSplit((s) => ({ ...s, right: activeToolId }));
    else setLeftId(activeToolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToolId]);

  // Switching workspace, or closing the right pane's tab, ends the split.
  const tabIds = useMemo(() => new Set(tabs.map((t) => t.featureId)), [tabs]);
  useEffect(() => {
    if (split.right && !tabIds.has(split.right)) setSplit((s) => ({ ...s, right: null }));
  }, [tabIds, split.right, setSplit]);
  const workspaceId = useRef(active.id);
  useEffect(() => {
    if (workspaceId.current === active.id) return;
    workspaceId.current = active.id;
    setSplit((s) => (s.right ? { ...s, right: null } : s));
  }, [active.id, setSplit]);

  const go = useCallback((toolId: string) => {
    navigate(locations.current.get(toolId) ?? toolPath(toolId));
  }, [navigate]);

  const openToSide = useCallback((toolId: string) => {
    if (toolId === leftId) {
      // Splitting the current tool: put the previous tab on the left instead.
      const other = tabs.find((t) => t.featureId !== toolId)?.featureId;
      if (!other) return;
      setLeftId(other);
    }
    setSplit((s) => ({ ...s, right: toolId }));
    setFocused('right');
    go(toolId);
  }, [leftId, tabs, setSplit, go]);

  const closeSplit = useCallback(() => {
    const keep = focused === 'right' && rightId ? rightId : leftId;
    setSplit((s) => ({ ...s, right: null }));
    setFocused('left');
    if (keep) {
      setLeftId(keep);
      go(keep);
    }
  }, [focused, rightId, leftId, setSplit, go]);

  const closePane = useCallback((pane: Pane) => {
    const keep = pane === 'left' ? rightId : leftId;
    setSplit((s) => ({ ...s, right: null }));
    setFocused('left');
    if (keep) {
      setLeftId(keep);
      go(keep);
    }
  }, [leftId, rightId, setSplit, go]);

  const swap = useCallback(() => {
    if (!rightId || !leftId) return;
    setLeftId(rightId);
    setSplit((s) => ({ ...s, right: leftId }));
    setFocused((f) => (f === 'left' ? 'right' : 'left'));
  }, [leftId, rightId, setSplit]);

  const toggleSplit = useCallback(() => {
    if (rightId) { closeSplit(); return; }
    const open = new Set(tabs.map((t) => t.featureId));
    const other = getRecentTools().find((id) => id !== leftId && open.has(id))
      ?? tabs.find((t) => t.featureId !== leftId)?.featureId;
    if (other) openToSide(other);
  }, [rightId, closeSplit, tabs, leftId, openToSide]);

  // ⌘\ / Ctrl+\ toggles the split, from anywhere.
  const toggleRef = useRef(toggleSplit);
  toggleRef.current = toggleSplit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.shiftKey || e.code !== 'Backslash') return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const focusPane = useCallback((pane: Pane) => {
    if (pane === focusedRef.current) return;
    const id = pane === 'left' ? leftId : rightId;
    if (!id) return;
    setFocused(pane);
    go(id);
  }, [leftId, rightId, go]);

  const rememberLocation = useCallback((toolId: string, path: string) => {
    locations.current.set(toolId, path);
  }, []);

  const setRatio = useCallback((ratio: number) => {
    setSplit((s) => ({ ...s, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) }));
  }, [setSplit]);

  const value = useMemo<SplitViewValue>(() => ({
    leftId, rightId, focused: rightId ? focused : 'left', ratio: split.ratio,
    setRatio, openToSide, closeSplit, closePane, toggleSplit, swap, focusPane, rememberLocation,
  }), [leftId, rightId, focused, split.ratio, setRatio, openToSide, closeSplit, closePane, toggleSplit, swap, focusPane, rememberLocation]);

  return <SplitViewContext.Provider value={value}>{children}</SplitViewContext.Provider>;
}

/** Null outside a SplitViewProvider (tests rendering a piece of the shell). */
export function useSplitView(): SplitViewValue | null {
  return useContext(SplitViewContext);
}
