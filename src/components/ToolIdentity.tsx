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
 * Identity of the open tool: icon plus group tabs or the tool name. `size`
 * picks the titlebar or web header variant. Used as WorkspaceBar's
 * `fallback`.
 */
export function ToolIdentity({ size }: { size: 'titlebar' | 'header' }) {
  const location = useLocation();
  const { isFeatureEnabled } = useFeatures();
  const { t } = useLocale();
  const liveIds = useLiveConnections();

  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const ActiveIcon = activeTool.icon;
  // In a multi-tool group, show the sibling tabs instead of the name.
  const activeGroup = GROUP_OF_TOOL.get(activeTool.featureId);
  const groupTabs = (activeGroup?.toolIds ?? [])
    .filter((id) => isFeatureEnabled(id))
    .map((id) => TOOL_DEF_MAP.get(id))
    .filter((def): def is NonNullable<typeof def> => !!def);

  const compact = size === 'titlebar';

  return (
    <div className={cn('flex min-w-0 items-center', compact ? 'gap-3' : 'gap-2.5')}>
      {/* No live dot here: the active tab already shows one. */}
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
                  // rounded-md: the app's "selected" shape.
                  'inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-md leading-none transition-colors',
                  'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                  compact ? 'px-2 text-xs' : 'px-3.5 text-sm',
                  // Solid accent pill uses `shadow-btn` (RULES.md).
                  on ? 'bg-acc font-semibold text-acc-fg shadow-btn' : 'text-fg-mute hover:text-fg',
                )}
              >
                {/* Siblings may be live independently. The selected tab gets a
                    `ring-acc-fg` so a green-leaning accent does not hide `--ok`. */}
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
        /* The tool name is text, not an accent pill: accent means interactive
           or selected (RULES.md), and the name is neither. */
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
