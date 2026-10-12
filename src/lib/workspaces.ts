/**
 * Workspaces: named sets of tool tabs that persist across launches, so the
 * set of tools used together (e.g. API Client, JSON, JWT) is one keystroke
 * away.
 *
 * Pure data and state transitions only (no React, router or storage), so
 * each rule is tested directly. `WorkspaceContext` wires it to navigation
 * and storage.
 */

export interface Workspace {
  id: string;
  /** Empty for an unnamed default workspace; the UI shows a localized name. */
  name: string;
  /** Tab order, left to right. */
  toolIds: string[];
  /** Last active tool here; restored when switching back. */
  activeToolId: string | null;
}

export interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string;
}

/**
 * Maximum tabs per workspace. Opening another tool evicts the oldest tab.
 */
export const MAX_TABS = 12;

/** Maximum workspaces; ⌘⌥1…9 covers them all. */
export const MAX_WORKSPACES = 9;

/** Shell screens, not tools; they never get a tab. */
const NON_TAB_TOOLS = new Set(['settings']);

let seq = 0;
export function newWorkspaceId(): string {
  seq += 1;
  return `ws-${Date.now().toString(36)}-${seq}`;
}

export function initialWorkspaceState(): WorkspaceState {
  const id = newWorkspaceId();
  return { workspaces: [{ id, name: '', toolIds: [], activeToolId: null }], activeId: id };
}

export function activeWorkspace(state: WorkspaceState): Workspace {
  return state.workspaces.find((w) => w.id === state.activeId) ?? state.workspaces[0];
}

function updateActive(state: WorkspaceState, fn: (w: Workspace) => Workspace): WorkspaceState {
  const current = activeWorkspace(state);
  return {
    ...state,
    workspaces: state.workspaces.map((w) => (w.id === current.id ? fn(w) : w)),
  };
}

/** Opens a tool: adds a tab to the active workspace if needed and activates it. */
export function visitTool(state: WorkspaceState, toolId: string): WorkspaceState {
  if (NON_TAB_TOOLS.has(toolId)) return state;
  const ws = activeWorkspace(state);
  if (ws.activeToolId === toolId && ws.toolIds.includes(toolId)) return state;
  return updateActive(state, (w) => {
    let toolIds = w.toolIds.includes(toolId) ? w.toolIds : [...w.toolIds, toolId];
    if (toolIds.length > MAX_TABS) {
      // Evict the oldest tab, never the one just opened.
      const victim = toolIds.find((id) => id !== toolId)!;
      toolIds = toolIds.filter((id) => id !== victim);
    }
    return { ...w, toolIds, activeToolId: toolId };
  });
}

/**
 * Closes a tab. Also returns the tool to switch to when the closed tab was
 * active: the tab to its right, else to its left, like a browser.
 *
 * `isVisible` tells which tabs are shown (disabled tools stay in `toolIds`
 * but are hidden); the next tab must be a visible one.
 */
export function closeTool(
  state: WorkspaceState,
  toolId: string,
  isVisible: (toolId: string) => boolean = () => true,
): { state: WorkspaceState; next: string | null } {
  const ws = activeWorkspace(state);
  const idx = ws.toolIds.indexOf(toolId);
  if (idx === -1) return { state, next: null };
  const toolIds = ws.toolIds.filter((id) => id !== toolId);
  const wasActive = ws.activeToolId === toolId;
  const right = toolIds.slice(idx).find(isVisible);
  const left = toolIds.slice(0, idx).reverse().find(isVisible);
  const next = wasActive ? (right ?? left ?? null) : null;
  return {
    state: updateActive(state, (w) => ({
      ...w,
      toolIds,
      activeToolId: wasActive ? next : w.activeToolId,
    })),
    next,
  };
}

export function closeOtherTools(state: WorkspaceState, keepId: string): WorkspaceState {
  return updateActive(state, (w) => ({
    ...w,
    toolIds: w.toolIds.filter((id) => id === keepId),
    activeToolId: keepId,
  }));
}

/** Drag and drop: moves `toolId` to `toIndex`. */
export function moveTool(state: WorkspaceState, toolId: string, toIndex: number): WorkspaceState {
  return updateActive(state, (w) => {
    if (!w.toolIds.includes(toolId)) return w;
    const rest = w.toolIds.filter((id) => id !== toolId);
    const at = Math.max(0, Math.min(toIndex, rest.length));
    return { ...w, toolIds: [...rest.slice(0, at), toolId, ...rest.slice(at)] };
  });
}

/**
 * Creates a workspace and switches to it, starting with the current tool as
 * its first tab.
 */
export function createWorkspace(
  state: WorkspaceState,
  name: string,
  seedToolId: string | null,
): WorkspaceState {
  if (state.workspaces.length >= MAX_WORKSPACES) return state;
  const id = newWorkspaceId();
  const seeded = seedToolId && !NON_TAB_TOOLS.has(seedToolId) ? [seedToolId] : [];
  return {
    workspaces: [
      ...state.workspaces,
      { id, name: name.trim(), toolIds: seeded, activeToolId: seeded[0] ?? null },
    ],
    activeId: id,
  };
}

export function renameWorkspace(state: WorkspaceState, id: string, name: string): WorkspaceState {
  return {
    ...state,
    workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() } : w)),
  };
}

/** Deletes a workspace. The last one cannot be deleted. */
export function deleteWorkspace(state: WorkspaceState, id: string): WorkspaceState {
  if (state.workspaces.length <= 1) return state;
  const idx = state.workspaces.findIndex((w) => w.id === id);
  if (idx === -1) return state;
  const workspaces = state.workspaces.filter((w) => w.id !== id);
  const activeId =
    state.activeId === id ? workspaces[Math.max(0, idx - 1)].id : state.activeId;
  return { workspaces, activeId };
}

export function switchWorkspace(state: WorkspaceState, id: string): WorkspaceState {
  if (!state.workspaces.some((w) => w.id === id) || state.activeId === id) return state;
  return { ...state, activeId: id };
}

/**
 * Parses saved state, dropping anything malformed so the app never starts in
 * a workspace that does not exist.
 */
export function parseWorkspaceState(raw: string | null): WorkspaceState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<WorkspaceState>;
    if (!data || !Array.isArray(data.workspaces)) return null;
    const workspaces = data.workspaces
      .filter((w): w is Workspace => !!w && typeof w.id === 'string' && Array.isArray(w.toolIds))
      .slice(0, MAX_WORKSPACES)
      .map((w) => {
        const toolIds = [...new Set(w.toolIds.filter((id) => typeof id === 'string'))].slice(-MAX_TABS);
        return {
          id: w.id,
          name: typeof w.name === 'string' ? w.name : '',
          toolIds,
          activeToolId:
            typeof w.activeToolId === 'string' && toolIds.includes(w.activeToolId)
              ? w.activeToolId
              : (toolIds[0] ?? null),
        };
      });
    if (workspaces.length === 0) return null;
    const activeId = workspaces.some((w) => w.id === data.activeId) ? data.activeId! : workspaces[0].id;
    return { workspaces, activeId };
  } catch {
    return null;
  }
}
