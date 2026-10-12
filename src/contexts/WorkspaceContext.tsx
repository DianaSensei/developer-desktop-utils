import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { allTools, toolPath } from '@/lib/toolRegistry';
import { storageGet, storageSet } from '@/lib/persistentStore';
import { useFeatures } from '@/contexts/FeatureContext';
import { IS_MAC } from '@/lib/platform';
import { WorkspaceNameDialog } from '@/components/WorkspaceNameDialog';
import {
  activeWorkspace,
  closeOtherTools as closeOtherToolsIn,
  closeTool as closeToolIn,
  createWorkspace as createWorkspaceIn,
  deleteWorkspace as deleteWorkspaceIn,
  initialWorkspaceState,
  moveTool as moveToolIn,
  parseWorkspaceState,
  renameWorkspace as renameWorkspaceIn,
  switchWorkspace as switchWorkspaceIn,
  visitTool,
  type Workspace,
  type WorkspaceState,
} from '@/lib/workspaces';

const STORAGE_KEY = 'devtool-workspaces';

type Tool = (typeof allTools)[number];

interface WorkspaceContextValue {
  workspaces: Workspace[];
  active: Workspace;
  /** Active workspace tabs, without disabled or missing tools. */
  tabs: Tool[];
  activeToolId: string;
  openTool: (toolId: string) => void;
  closeTool: (toolId: string) => void;
  closeOtherTools: (toolId: string) => void;
  moveTool: (toolId: string, toIndex: number) => void;
  switchWorkspace: (id: string) => void;
  createWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  /** Opens the naming dialog, then creates a workspace with the current tool. */
  promptCreateWorkspace: () => void;
  promptRenameWorkspace: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

/**
 * Connects the pure model in lib/workspaces.ts to the router and storage.
 * Must be inside <Router> and FeatureProvider. Every navigation to a tool
 * records it in the active workspace, so every way of opening a tool
 * (sidebar, ⌘K, deep link, group tabs) works without extra calls.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isFeatureEnabled } = useFeatures();

  const [state, setState] = useState<WorkspaceState>(
    () => parseWorkspaceState(storageGet(STORAGE_KEY)) ?? initialWorkspaceState(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    storageSet(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const activeToolId = allTools.find((t) => t.path === location.pathname)?.featureId ?? '';
  const activeToolIdRef = useRef(activeToolId);
  activeToolIdRef.current = activeToolId;

  // Depends on the URL only, not activeId: switching workspaces changes
  // activeId and navigates in quick succession, and reacting to activeId
  // would record the old tool in the new workspace. Keyed on
  // `location.key` so re-opening the same path (after closing its tab)
  // still runs.
  useEffect(() => {
    if (!activeToolId) return;
    setState((s) => visitTool(s, activeToolId));
  }, [activeToolId, location.key]);

  const active = activeWorkspace(state);

  const tabs = useMemo(
    () =>
      active.toolIds
        .map((id) => allTools.find((t) => t.featureId === id))
        .filter((t): t is Tool => !!t && isFeatureEnabled(t.featureId)),
    [active.toolIds, isFeatureEnabled],
  );

  const openTool = useCallback((toolId: string) => navigate(toolPath(toolId)), [navigate]);

  const closeTool = useCallback(
    (toolId: string) => {
      const { state: next, next: target } = closeToolIn(stateRef.current, toolId, isFeatureEnabled);
      setState(next);
      if (target) navigate(toolPath(target));
    },
    [navigate, isFeatureEnabled],
  );

  // Navigate to the kept tab; the URL decides what is shown.
  const closeOtherTools = useCallback(
    (toolId: string) => {
      setState((s) => closeOtherToolsIn(s, toolId));
      if (toolId !== activeToolIdRef.current) navigate(toolPath(toolId));
    },
    [navigate],
  );
  const moveTool = useCallback(
    (toolId: string, toIndex: number) => setState((s) => moveToolIn(s, toolId, toIndex)),
    [],
  );

  const goToWorkspace = useCallback(
    (next: WorkspaceState) => {
      const target = activeWorkspace(next).activeToolId;
      if (target && isFeatureEnabled(target)) {
        setState(next);
        navigate(toolPath(target));
        return;
      }
      // The URL did not change, so record the current tool here or the
      // tab bar would be empty.
      setState(activeToolIdRef.current ? visitTool(next, activeToolIdRef.current) : next);
    },
    [navigate, isFeatureEnabled],
  );

  const switchWorkspace = useCallback(
    (id: string) => goToWorkspace(switchWorkspaceIn(stateRef.current, id)),
    [goToWorkspace],
  );

  const createWorkspace = useCallback(
    (name: string) => setState((s) => createWorkspaceIn(s, name, activeToolId || null)),
    [activeToolId],
  );

  const renameWorkspace = useCallback(
    (id: string, name: string) => setState((s) => renameWorkspaceIn(s, id, name)),
    [],
  );

  const deleteWorkspace = useCallback(
    (id: string) => goToWorkspace(deleteWorkspaceIn(stateRef.current, id)),
    [goToWorkspace],
  );

  // The naming dialog lives here because ⌘K opens it too and the tab bar
  // is not always rendered.
  const [naming, setNaming] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null);
  const promptCreateWorkspace = useCallback(() => setNaming({ mode: 'create' }), []);
  const promptRenameWorkspace = useCallback((id: string) => setNaming({ mode: 'rename', id }), []);

  // ── Shortcuts ─────────────────────────────────────────────────────────
  //   ⌘1…⌘8        Nth tab          (Ctrl on Windows/Linux)
  //   ⌘9           last tab
  //   ⌘⇧[ / ⌘⇧]    previous / next  (also Ctrl+PageUp/PageDown)
  //   ⌘⌥1…⌘⌥9      Nth workspace
  // Ctrl+Tab is left to the API Client's request tabs. Matched on `e.code`
  // because ⌥ changes `e.key` on macOS (⌥1 → ¡).
  const latest = useRef({ tabs, activeToolId, workspaces: state.workspaces, openTool, switchWorkspace });
  latest.current = { tabs, activeToolId, workspaces: state.workspaces, openTool, switchWorkspace };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.getModifierState?.('AltGraph')) return;
      const { tabs: list, activeToolId: current, workspaces, openTool: open, switchWorkspace: sw } = latest.current;
      const digit = /^Digit([1-9])$/.exec(e.code);

      if (digit && e.altKey && !e.shiftKey) {
        const ws = workspaces[Number(digit[1]) - 1];
        if (!ws) return;
        e.preventDefault();
        sw(ws.id);
        return;
      }
      if (digit && !e.altKey && !e.shiftKey) {
        if (list.length === 0) return;
        const n = Number(digit[1]);
        const tool = n === 9 ? list[list.length - 1] : list[n - 1];
        if (!tool) return;
        e.preventDefault();
        open(tool.featureId);
        return;
      }

      const step =
        e.shiftKey && !e.altKey && e.code === 'BracketLeft' ? -1
        : e.shiftKey && !e.altKey && e.code === 'BracketRight' ? 1
        : !IS_MAC && !e.shiftKey && e.key === 'PageUp' ? -1
        : !IS_MAC && !e.shiftKey && e.key === 'PageDown' ? 1
        : 0;
      if (step && list.length > 1) {
        e.preventDefault();
        const idx = list.findIndex((t) => t.featureId === current);
        const next = list[(idx + step + list.length) % list.length];
        open(next.featureId);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces: state.workspaces,
      active,
      tabs,
      activeToolId,
      openTool,
      closeTool,
      closeOtherTools,
      moveTool,
      switchWorkspace,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      promptCreateWorkspace,
      promptRenameWorkspace,
    }),
    [state.workspaces, active, tabs, activeToolId, openTool, closeTool, closeOtherTools, moveTool,
      switchWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, promptCreateWorkspace,
      promptRenameWorkspace],
  );

  const renaming = naming?.mode === 'rename' ? state.workspaces.find((w) => w.id === naming.id) : undefined;

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {naming && (
        <WorkspaceNameDialog
          mode={naming.mode}
          initialName={renaming?.name ?? ''}
          onCancel={() => setNaming(null)}
          onSubmit={(name) => {
            if (naming.mode === 'create') createWorkspace(name);
            else renameWorkspace(naming.id, name);
            setNaming(null);
          }}
        />
      )}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaces(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaces must be used within a WorkspaceProvider');
  return ctx;
}

/** Display name; an unnamed default workspace gets a localized name. */
export function workspaceLabel(ws: Workspace, index: number, fallback: (n: number) => string): string {
  return ws.name || fallback(index + 1);
}
