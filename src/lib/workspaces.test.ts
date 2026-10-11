import { describe, expect, it } from 'vitest';
import {
  MAX_TABS,
  MAX_WORKSPACES,
  activeWorkspace,
  closeOtherTools,
  closeTool,
  createWorkspace,
  deleteWorkspace,
  initialWorkspaceState,
  moveTool,
  parseWorkspaceState,
  renameWorkspace,
  switchWorkspace,
  visitTool,
  type WorkspaceState,
} from '@/lib/workspaces';

function withTabs(...ids: string[]): WorkspaceState {
  return ids.reduce(visitTool, initialWorkspaceState());
}

describe('visitTool', () => {
  it('appends new tools in visit order and marks the latest active', () => {
    const s = withTabs('json', 'jwt');
    expect(activeWorkspace(s).toolIds).toEqual(['json', 'jwt']);
    expect(activeWorkspace(s).activeToolId).toBe('jwt');
  });

  it('revisiting an open tool neither duplicates nor reorders it', () => {
    const s = visitTool(withTabs('json', 'jwt'), 'json');
    expect(activeWorkspace(s).toolIds).toEqual(['json', 'jwt']);
    expect(activeWorkspace(s).activeToolId).toBe('json');
  });

  it('never opens Settings as a tab', () => {
    const s = visitTool(withTabs('json'), 'settings');
    expect(activeWorkspace(s).toolIds).toEqual(['json']);
  });

  it('evicts the oldest tab once the cap is passed, never the one just opened', () => {
    const ids = Array.from({ length: MAX_TABS + 1 }, (_, i) => `t${i}`);
    const s = withTabs(...ids);
    expect(activeWorkspace(s).toolIds).toHaveLength(MAX_TABS);
    expect(activeWorkspace(s).toolIds[0]).toBe('t1');
    expect(activeWorkspace(s).toolIds.at(-1)).toBe(`t${MAX_TABS}`);
  });
});

describe('closeTool', () => {
  it('closing the active tab hands focus to its right neighbour, then left', () => {
    let s = visitTool(withTabs('a', 'b', 'c'), 'b');
    const r1 = closeTool(s, 'b');
    expect(r1.next).toBe('c');
    s = r1.state;
    const r2 = closeTool(s, 'c');
    expect(r2.next).toBe('a');
  });

  it('closing a background tab keeps the active one and asks for no navigation', () => {
    const r = closeTool(withTabs('a', 'b'), 'a');
    expect(r.next).toBeNull();
    expect(activeWorkspace(r.state).activeToolId).toBe('b');
  });

  it('closeOtherTools leaves only the given tab', () => {
    const s = closeOtherTools(withTabs('a', 'b', 'c'), 'b');
    expect(activeWorkspace(s).toolIds).toEqual(['b']);
  });
});

describe('moveTool', () => {
  it('moves a tab to a new index', () => {
    const s = moveTool(withTabs('a', 'b', 'c'), 'c', 0);
    expect(activeWorkspace(s).toolIds).toEqual(['c', 'a', 'b']);
  });
});

describe('workspaces', () => {
  it('create switches to the new workspace, seeded with the tool on screen', () => {
    const s = createWorkspace(withTabs('a', 'b'), ' Backend ', 'b');
    expect(s.workspaces).toHaveLength(2);
    expect(activeWorkspace(s).name).toBe('Backend');
    expect(activeWorkspace(s).toolIds).toEqual(['b']);
  });

  it('tabs opened after switching land in the new workspace only', () => {
    let s = createWorkspace(withTabs('a'), 'Two', 'a');
    s = visitTool(s, 'c');
    expect(activeWorkspace(s).toolIds).toEqual(['a', 'c']);
    s = switchWorkspace(s, s.workspaces[0].id);
    expect(activeWorkspace(s).toolIds).toEqual(['a']);
  });

  it('stops creating at the workspace cap', () => {
    let s = initialWorkspaceState();
    for (let i = 0; i < MAX_WORKSPACES + 3; i++) s = createWorkspace(s, `w${i}`, null);
    expect(s.workspaces).toHaveLength(MAX_WORKSPACES);
  });

  it('rename trims, delete falls back to the previous workspace, last one is kept', () => {
    let s = createWorkspace(initialWorkspaceState(), 'x', null);
    const id = s.activeId;
    s = renameWorkspace(s, id, '  Daily  ');
    expect(activeWorkspace(s).name).toBe('Daily');
    s = deleteWorkspace(s, id);
    expect(s.workspaces).toHaveLength(1);
    expect(s.activeId).toBe(s.workspaces[0].id);
    expect(deleteWorkspace(s, s.activeId)).toBe(s);
  });
});

describe('parseWorkspaceState', () => {
  it('round-trips a saved state', () => {
    const s = createWorkspace(withTabs('a', 'b'), 'Two', 'b');
    expect(parseWorkspaceState(JSON.stringify(s))).toEqual(s);
  });

  it('rejects garbage and repairs a dangling activeId / activeToolId', () => {
    expect(parseWorkspaceState(null)).toBeNull();
    expect(parseWorkspaceState('{nope')).toBeNull();
    expect(parseWorkspaceState('{"workspaces":[]}')).toBeNull();
    const repaired = parseWorkspaceState(
      JSON.stringify({
        activeId: 'gone',
        workspaces: [{ id: 'w1', name: 'A', toolIds: ['a', 'a', 'b'], activeToolId: 'zzz' }],
      }),
    )!;
    expect(repaired.activeId).toBe('w1');
    expect(repaired.workspaces[0].toolIds).toEqual(['a', 'b']);
    expect(repaired.workspaces[0].activeToolId).toBe('a');
  });
});
