/**
 * Workspace — một bộ tab tool có tên, lưu bền qua các lần mở app.
 *
 * Thay cho "Open tools" chỉ-trong-phiên trước đây (useOpenTools): dải đó mất
 * sạch mỗi lần khởi động lại, và trên app desktop nó còn không bao giờ được
 * render (chỉ nằm trong header dạng web). Người dùng làm việc liên tục trên
 * vài tool cùng lúc — API Client + JSON + JWT + Base64 khi debug backend, Task
 * Tracker + Unix Time cho việc hằng ngày — và phải tìm lại từng tool qua
 * sidebar/⌘K mỗi lần chuyển qua lại. Workspace giữ đúng bộ đó, mỗi bộ một
 * tên, chuyển qua lại bằng một phím.
 *
 * File này THUẦN: chỉ có kiểu dữ liệu và các phép biến đổi trạng thái, không
 * React, không router, không storage — để test được từng quy tắc một cách
 * trực tiếp. `WorkspaceContext` lo phần nối với điều hướng và lưu trữ.
 */

export interface Workspace {
  id: string;
  /** Rỗng nghĩa là workspace mặc định chưa đặt tên — hiển thị tên theo ngôn ngữ. */
  name: string;
  /** Thứ tự tab, trái sang phải. */
  toolIds: string[];
  /** Tool đang mở lần cuối trong workspace này — đích khi chuyển về. */
  activeToolId: string | null;
}

export interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string;
}

/**
 * Trần số tab mỗi workspace. Mở thêm tool khi đã đầy sẽ đẩy tab cũ nhất ra —
 * đủ cho một bộ làm việc thật, không biến thành sidebar thứ hai.
 */
export const MAX_TABS = 12;

/** Số workspace tối đa — ⌘⌥1…9 phủ đúng chừng này. */
export const MAX_WORKSPACES = 9;

/** Màn hình của shell, không phải "việc" — không chiếm tab. */
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

/** Mở một tool: thêm tab vào workspace đang dùng (nếu chưa có) và đánh dấu nó đang mở. */
export function visitTool(state: WorkspaceState, toolId: string): WorkspaceState {
  if (NON_TAB_TOOLS.has(toolId)) return state;
  const ws = activeWorkspace(state);
  if (ws.activeToolId === toolId && ws.toolIds.includes(toolId)) return state;
  return updateActive(state, (w) => {
    let toolIds = w.toolIds.includes(toolId) ? w.toolIds : [...w.toolIds, toolId];
    if (toolIds.length > MAX_TABS) {
      // Đẩy tab cũ nhất ra, nhưng không bao giờ là tab vừa mở.
      const victim = toolIds.find((id) => id !== toolId)!;
      toolIds = toolIds.filter((id) => id !== victim);
    }
    return { ...w, toolIds, activeToolId: toolId };
  });
}

/**
 * Đóng một tab. Trả về cả trạng thái mới lẫn tool nên chuyển tới nếu tab vừa
 * đóng là tab đang mở — tab bên phải nó, hết thì bên trái, như trình duyệt.
 *
 * `isVisible`: tab nào thanh tab thực sự hiện (tool đã tắt vẫn nằm trong
 * `toolIds` nhưng bị ẩn). Tab kế tiếp phải là tab hiện được — chuyển tới một
 * tool đã tắt là rơi vào route "không khớp" và bị đẩy về trang mặc định.
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

/** Kéo-thả: đưa `toolId` tới vị trí `toIndex` trong dãy tab. */
export function moveTool(state: WorkspaceState, toolId: string, toIndex: number): WorkspaceState {
  return updateActive(state, (w) => {
    if (!w.toolIds.includes(toolId)) return w;
    const rest = w.toolIds.filter((id) => id !== toolId);
    const at = Math.max(0, Math.min(toIndex, rest.length));
    return { ...w, toolIds: [...rest.slice(0, at), toolId, ...rest.slice(at)] };
  });
}

/**
 * Tạo workspace mới và chuyển sang nó. Mang theo tool đang mở làm tab đầu
 * tiên: một workspace trống trơn không có gì để hiện, và người dùng thường tạo
 * workspace ngay lúc đang đứng ở tool đầu tiên của bộ mới.
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

/** Xoá một workspace. Workspace cuối cùng không xoá được — luôn phải có chỗ để tab rơi vào. */
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
 * Đọc trạng thái đã lưu, chịu được dữ liệu hỏng/cũ: bất cứ thứ gì không đúng
 * hình thì bỏ, không bao giờ để app khởi động vào một workspace không tồn tại.
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
