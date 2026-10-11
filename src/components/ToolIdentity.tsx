import { Link, useLocation } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allTools, toolPath } from '@/lib/toolRegistry';
import { TOOL_DEF_MAP } from '@/lib/toolDefs';
import { GROUP_OF_TOOL } from '@/lib/toolGroups';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useLiveConnections } from '@/lib/liveConnections';

/**
 * Danh tính tool đang mở: icon + (tab các tool cùng nhóm | tên tool).
 *
 * Trước đây khối này được viết HAI LẦN gần nguyên văn trong App.tsx — một bản
 * cho titlebar hợp nhất (desktop), một bản cho header bản web — chỉ khác kích
 * thước, và đã bắt đầu trôi lệch. Giờ một component, `size` chọn kích thước.
 * Hiện làm `fallback` của WorkspaceBar: lúc chưa có gì để chuyển qua lại thì
 * hàng header vẫn nói đang ở đâu.
 */
export function ToolIdentity({ size }: { size: 'titlebar' | 'header' }) {
  const location = useLocation();
  const { isFeatureEnabled } = useFeatures();
  const { t } = useLocale();
  const liveIds = useLiveConnections();

  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const ActiveIcon = activeTool.icon;
  // Tool đang mở có nằm trong nhóm nhiều tool không? Nếu có, hiện tab con thay
  // vì tên tool — để thấy được các tool anh em mà không phải quay lại sidebar.
  const activeGroup = GROUP_OF_TOOL.get(activeTool.featureId);
  const groupTabs = (activeGroup?.toolIds ?? [])
    .filter((id) => isFeatureEnabled(id))
    .map((id) => TOOL_DEF_MAP.get(id))
    .filter((def): def is NonNullable<typeof def> => !!def);

  const compact = size === 'titlebar';

  return (
    <div className={cn('flex min-w-0 items-center', compact ? 'gap-3' : 'gap-2.5')}>
      {/* Không chấm live ở đây: icon này nằm ngoài tablist bên cạnh (badge cố
          định, không phải tab bấm được), và tab đang chọn đã tự có chấm live —
          hai chấm cho cùng một tool là thừa. */}
      <div
        key={activeTool.path}
        className={cn(
          'relative flex shrink-0 items-center justify-center rounded-md border border-acc/15 bg-acc/10',
          'motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-spring',
          compact ? 'h-6 w-6' : 'h-ctl w-ctl',
        )}
      >
        <ActiveIcon className={cn('text-acc', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      </div>
      {groupTabs.length > 1 ? (
        <div
          key={`${activeTool.path}-tabs`}
          role="tablist"
          aria-label={activeGroup!.label}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 overflow-x-auto rounded-md bg-sunk',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft',
            compact ? 'h-6 p-0.5' : 'h-ctl p-1',
          )}
        >
          {groupTabs.map((def) => {
            const p = toolPath(def.id);
            const on = p === location.pathname;
            const live = liveIds.includes(def.id);
            return (
              <Link
                key={def.id}
                to={p}
                role="tab"
                aria-selected={on}
                className={cn(
                  // rounded-md: cùng hình "đang chọn" dùng ở mọi nơi khác.
                  'inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-md leading-none transition-colors',
                  'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                  compact ? 'px-2 text-xs' : 'px-3.5 text-sm',
                  // Pill accent đặc → `shadow-btn` (RULES.md), không `shadow-soft`.
                  on ? 'bg-acc font-semibold text-acc-fg shadow-btn' : 'text-fg-mute hover:text-fg',
                )}
              >
                {/* Tab anh em có thể đang live độc lập với tab đang mở — thiếu
                    chấm này thì chuyển khỏi một tool đang kết nối là mất dấu
                    nó. Viền `ring-acc-fg` chỉ ở tab ĐANG CHỌN: trên nền `bg-acc`
                    một accent ngả xanh lá có thể nuốt mất chấm `--ok`. */}
                {live && (
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-ok', on && 'ring-2 ring-acc-fg/70')}
                    title={t('shell.titlebar.running')}
                  />
                )}
                {def.label}
              </Link>
            );
          })}
        </div>
      ) : (
        /* Tên tool là CHỮ, không phải viên thuốc accent: `--acc` nghĩa là "tương
           tác được" hoặc "đang được chọn" (RULES.md). Tên tool đang mở không
           phải một lựa chọn — tô accent vào đây là thứ ồn nhất màn hình lại là
           thứ bấm vào không có gì xảy ra. */
        <h2
          key={`${activeTool.path}-label`}
          className={cn(
            'inline-flex min-w-0 shrink items-center gap-1.5 truncate font-semibold leading-none',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          <span className="truncate">{activeTool.label}</span>
          {activeTool.experimental && (
            <span title={t('shell.experimental.badge')} className="inline-flex shrink-0">
              <FlaskConical className={cn('text-fg-mute', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
            </span>
          )}
        </h2>
      )}
    </div>
  );
}
