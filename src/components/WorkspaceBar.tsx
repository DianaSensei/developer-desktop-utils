// Workspace bar — bộ chọn workspace + dãy tab tool của workspace đang dùng.
//
// Thay cho OpenToolsStrip (tab "trong phiên", mất khi khởi động lại, và không
// bao giờ render trên app desktop vì chỉ nằm trong header dạng web). Giờ dựng
// được ở cả hai chỗ: dải titlebar hợp nhất (macOS overlay / Windows-Linux
// custom chrome) và header thường (bản web) — `size` chọn chiều cao cho khớp.
//
// Tab TÀI LIỆU, không phải nút chọn chế độ — nên tab đang mở lấy đúng màu của
// mặt làm việc (`--card`), không phải accent. Accent để dành cho "đang chọn
// chế độ" (tab nhóm, Segmented) — hai nghĩa khác nhau, hai cách thể hiện.

import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOD_KEY, IS_MAC } from '@/lib/platform';
import { useLocale } from '@/contexts/LocaleContext';
import { useWorkspaces, workspaceLabel } from '@/contexts/WorkspaceContext';
import { useLiveConnections } from '@/lib/liveConnections';
import { MAX_WORKSPACES } from '@/lib/workspaces';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ContextMenu, useContextMenu } from '@/components/ui/context-menu';
import { requestCommandPalette } from '@/components/CommandPalette';

export interface WorkspaceBarProps {
  /** `titlebar` = dải 38px của chrome tự vẽ; `header` = header 50px bản web. */
  size?: 'titlebar' | 'header';
  /**
   * Hiện khi chưa có gì để chuyển qua lại — ít hơn hai tab VÀ chỉ một
   * workspace. Đó là danh tính tool đang mở; không có nó hàng header trống trơn.
   */
  fallback?: ReactNode;
}

const shortcut = (keys: string) => (IS_MAC ? `${MOD_KEY}${keys}` : `${MOD_KEY}+${keys}`);

export function WorkspaceBar({ size = 'header', fallback = null }: WorkspaceBarProps) {
  const {
    workspaces, active, tabs, activeToolId, openTool, closeTool, closeOtherTools, moveTool,
  } = useWorkspaces();
  const { t } = useLocale();
  const liveIds = useLiveConnections();
  const menu = useContextMenu();
  const listRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Tab đang mở luôn nằm trong tầm nhìn khi dãy tab tràn ngang.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeToolId, tabs.length]);

  if (tabs.length < 2 && workspaces.length < 2) return <>{fallback}</>;

  const compact = size === 'titlebar';
  const h = compact ? 'h-6' : 'h-ctl';

  // Mũi tên trái/phải đi giữa các tab — mẫu tablist chuẩn của ARIA.
  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTool(tabs[index].featureId);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nodes = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      nodes?.[next]?.focus();
    }
  }

  return (
    // `data-tauri-drag-region="false"`: titlebar cha là vùng kéo cửa sổ
    // ("deep"). Tab là <div role="tab"> chứ không phải <button>/<a>, nên phải
    // nói rõ nó không phải vùng kéo — nếu không, nhấn chuột lên tab là kéo
    // cả cửa sổ thay vì chuyển tab.
    <div className="flex min-w-0 items-center gap-1" data-tauri-drag-region="false">
      <WorkspaceSwitcher compact={compact} />
      <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden />
      <div
        ref={listRef}
        role="tablist"
        aria-label={t('shell.workspace.tabsLabel', { name: workspaceLabel(active, workspaces.indexOf(active), (n) => t('shell.workspace.defaultName', { n })) })}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tool, i) => {
          const Icon = tool.icon;
          const on = tool.featureId === activeToolId;
          // Đang ở màn không phải tab (Settings) thì tab đầu nhận focus Tab-key,
          // để bàn phím vẫn vào được dãy tab.
          const focusable = on || (i === 0 && !tabs.some((x) => x.featureId === activeToolId));
          const live = liveIds.includes(tool.featureId);
          const hint = i < 8 ? ` (${shortcut(String(i + 1))})` : '';
          return (
            <div
              key={tool.featureId}
              role="tab"
              tabIndex={focusable ? 0 : -1}
              aria-selected={on}
              title={`${tool.label}${hint}`}
              draggable
              onDragStart={(e) => {
                setDragId(tool.featureId);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragId && dragId !== tool.featureId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                // Vị trí trong danh sách ĐẦY ĐỦ của workspace, không phải trong
                // dãy đang hiện (đã lọc tool bị tắt) — hai chỉ số lệch nhau.
                if (dragId) moveTool(dragId, active.toolIds.indexOf(tool.featureId));
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => openTool(tool.featureId)}
              // Chuột giữa đóng tab — như mọi trình duyệt/IDE.
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTool(tool.featureId);
                }
              }}
              onContextMenu={(e) =>
                menu.open(e, [
                  { icon: <X className="h-3.5 w-3.5" />, label: t('shell.workspace.closeTab', { label: tool.label }), onClick: () => closeTool(tool.featureId) },
                  { label: t('shell.workspace.closeOthers'), onClick: () => closeOtherTools(tool.featureId), disabled: tabs.length < 2 },
                ])
              }
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                'group inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm border text-xs leading-none transition-colors',
                h,
                compact ? 'px-2' : 'px-2.5',
                'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                on
                  ? 'border-line bg-card font-medium text-fg'
                  : 'border-transparent text-fg-mute hover:bg-card/60 hover:text-fg',
                dragId === tool.featureId && 'opacity-50',
              )}
            >
              {live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title={t('shell.titlebar.running')} />}
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[10rem] truncate">{tool.label}</span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTool(tool.featureId);
                }}
                aria-label={t('shell.workspace.closeTab', { label: tool.label })}
                title={t('shell.workspace.closeTab', { label: tool.label })}
                className={cn(
                  '-mr-1 grid h-4 w-4 shrink-0 place-items-center rounded-xs text-fg-mute transition-opacity hover:bg-fg/10 hover:text-fg',
                  // Tab đang mở luôn hiện nút đóng — không phải đi rê chuột tìm.
                  on ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={requestCommandPalette}
        title={t('shell.workspace.openTool', { shortcut: shortcut('K') })}
        aria-label={t('shell.workspace.openTool', { shortcut: shortcut('K') })}
        className={cn(
          'grid shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-card/60 hover:text-fg',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          compact ? 'h-6 w-6' : 'h-ctl w-ctl',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} />}
    </div>
  );
}

function WorkspaceSwitcher({ compact }: { compact: boolean }) {
  const { workspaces, active, switchWorkspace, deleteWorkspace, promptCreateWorkspace, promptRenameWorkspace } =
    useWorkspaces();
  const { t } = useLocale();
  const nameOf = (i: number) => workspaceLabel(workspaces[i], i, (n) => t('shell.workspace.defaultName', { n }));
  const activeIndex = workspaces.indexOf(active);
  const activeName = nameOf(activeIndex);

  return (
    <DropdownMenu className="shrink-0">
      <DropdownMenuTrigger
        title={t('shell.workspace.switcher', { name: activeName })}
        aria-label={t('shell.workspace.switcher', { name: activeName })}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm px-2 text-xs font-semibold leading-none text-fg transition-colors hover:bg-card/60',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          compact ? 'h-6' : 'h-ctl',
        )}
      >
        <Layers className="h-3.5 w-3.5 shrink-0 text-acc" />
        <span className="max-w-[9rem] truncate">{activeName}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-fg-mute" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>{t('shell.workspace.menuLabel')}</DropdownMenuLabel>
        {workspaces.map((ws, i) => (
          <DropdownMenuItem
            key={ws.id}
            active={ws.id === active.id}
            onClick={() => switchWorkspace(ws.id)}
            icon={<Check className={cn('h-3.5 w-3.5 shrink-0', ws.id === active.id ? 'opacity-100' : 'opacity-0')} />}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{nameOf(i)}</span>
              <span className="shrink-0 text-[11px] text-fg-mute">
                {t('shell.workspace.tabCount', { n: ws.toolIds.length })}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-mute">
                {IS_MAC ? `${MOD_KEY}⌥${i + 1}` : `${MOD_KEY}+Alt+${i + 1}`}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={promptCreateWorkspace}
          disabled={workspaces.length >= MAX_WORKSPACES}
        >
          {t('shell.workspace.new')}
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => promptRenameWorkspace(active.id)}>
          {t('shell.workspace.rename')}
        </DropdownMenuItem>
        {workspaces.length > 1 && (
          <DropdownMenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => deleteWorkspace(active.id)}>
            {t('shell.workspace.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
