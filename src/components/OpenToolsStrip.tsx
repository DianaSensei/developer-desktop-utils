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

import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allTools, toolPath } from '@/lib/toolRegistry';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useLiveConnections } from '@/lib/liveConnections';
import { useOpenTools } from '@/hooks/useOpenTools';

export function OpenToolsStrip() {
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
  if (tabs.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label={t('shell.openTools.label')}
      className="z-20 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg-2/40 px-2 py-1"
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
              'group inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs leading-none transition-colors',
              'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
              on ? 'bg-sunk font-medium text-fg shadow-soft' : 'text-fg-mute hover:bg-sunk/60 hover:text-fg',
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
