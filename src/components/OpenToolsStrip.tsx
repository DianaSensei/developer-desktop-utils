// "Open tools" — a browser-tab-style strip of the tools visited this app
// session, so switching back to one you were just using doesn't mean
// re-searching for it in the sidebar or ⌘K every time. Distinct from
// Favorites (hand-picked, persisted) and Recent-via-sidebar-order: this is
// purely "what have I had open since I launched the app", and purely
// in-memory — see useOpenTools.ts.
//
// Rendered once, above the routed tool content, regardless of which
// titlebar-chrome variant is active (see App.tsx) — so it never has to be
// duplicated across the macOS-overlay / Windows-Linux-custom-chrome /
// merged-titlebar-off header variants.

import type * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allTools, toolPath } from '@/lib/toolRegistry';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useLiveConnections } from '@/lib/liveConnections';
import { useOpenTools } from '@/hooks/useOpenTools';

export interface OpenToolsStripProps {
  /**
   * Dựng KHÔNG có dải bao ngoài (không viền dưới, không nền, không đệm dọc) để
   * đặt thẳng vào hàng header. Đây là cách bỏ được một dải chrome nguyên vẹn:
   * trước đây strip là band riêng nằm dưới header, nên đỉnh cửa sổ có hai dải
   * chồng nhau nói gần như cùng một chuyện ("tool nào đang mở").
   */
  inline?: boolean;
  /**
   * Hiện khi có ÍT HƠN hai tab (không có gì để chuyển qua lại). Ở chế độ
   * `inline`, chỗ này là danh tính tool đang mở — nếu không thì hàng header
   * trống trơn, không nói đang ở đâu.
   */
  fallback?: React.ReactNode;
}

export function OpenToolsStrip({ inline = false, fallback = null }: OpenToolsStripProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isFeatureEnabled } = useFeatures();
  const { t } = useLocale();
  const liveIds = useLiveConnections();

  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const { openIds, closeTool } = useOpenTools(activeTool.featureId);

  // A tool the user disabled after opening it drops out of the strip rather
  // than sitting there as a dead tab a click can't reach.
  const tabs = openIds
    .map((id) => allTools.find((tool) => tool.featureId === id))
    .filter((tool): tool is (typeof allTools)[number] => !!tool && isFeatureEnabled(tool.featureId));

  // Nothing to switch back TO with zero or one tab open — stay out of the
  // way instead of showing a strip with just the tool already on screen.
  if (tabs.length < 2) return <>{fallback}</>;

  return (
    <div
      role="tablist"
      aria-label={t('shell.openTools.label')}
      className={cn(
        'flex shrink-0 items-center gap-1 overflow-x-auto',
        inline ? 'min-w-0' : 'z-20 border-b border-line bg-chrome px-2 py-1',
      )}
    >
      {tabs.map((tool) => {
        const Icon = tool.icon;
        const on = tool.path === location.pathname;
        const live = liveIds.includes(tool.featureId);
        return (
          <div
            key={tool.featureId}
            role="tab"
            tabIndex={0}
            aria-selected={on}
            onClick={() => navigate(toolPath(tool.featureId))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(toolPath(tool.featureId)); }
            }}
            className={cn(
              // Tab TÀI LIỆU, không phải nút chọn chế độ — nên tab đang mở lấy
              // đúng màu của MẶT LÀM VIỆC (`--card`) chứ không phải màu accent.
              // Nhờ vậy nó đọc ra là tờ giấy đang nằm trên cùng, nối liền với
              // nội dung bên dưới, y như tab trong IDE. Accent để dành cho
              // "đang chọn chế độ" (tab nhóm bên cạnh) — hai nghĩa khác nhau,
              // hai cách thể hiện khác nhau, mỗi cách dùng nhất quán.
              'group inline-flex h-ctl shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 text-xs leading-none transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
              on
                ? 'border-line bg-card font-medium text-fg'
                : 'border-transparent text-fg-mute hover:bg-card/60 hover:text-fg',
            )}
          >
            {live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title={t('shell.titlebar.running')} />}
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[10rem] truncate">{tool.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTool(tool.featureId); }}
              aria-label={t('shell.openTools.close', { label: tool.label })}
              title={t('shell.openTools.close', { label: tool.label })}
              className="-mr-1 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm text-fg-mute/50 opacity-0 transition-opacity hover:bg-fg/10 hover:text-fg focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
