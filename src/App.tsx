import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useLayoutEffect, Suspense } from 'react';
import { cn } from '@/lib/utils';
import { storageGet, storageSet, getThemePreference, setThemePreference, type ThemePreference } from '@/lib/persistentStore';
import {
  Menu,
  X,
  Moon,
  Sun,
  Monitor,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  Loader2,
  HelpCircle,
  Star,
  Minus,
  Square,
  Copy,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDesktopChrome } from '@/hooks/useDesktopChrome';
import { useThemeSync, triggerThemeTransition } from '@/hooks/useThemeSync';
import { TOOL_DEF_MAP, DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { allTools, toolPath } from '@/lib/toolRegistry';
import { buildNavEntries, countFavoriteEntries, type NavEntry } from '@/lib/toolGroups';
import { toolMatchesQuery } from '@/lib/toolSearch';
import { useLiveConnections } from '@/lib/liveConnections';
import { initDeepLinkHandling } from '@/lib/deepLink';
import { CommandPalette } from '@/components/CommandPalette';
import { WorkspaceBar, useWorkspaceBarVisible } from '@/components/WorkspaceBar';
import { ToolIdentity, GroupTabs, useActiveGroupTabs } from '@/components/ToolIdentity';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { McpBackgroundBridge } from '@/components/McpBackgroundBridge';
import { McpManageBridge } from '@/components/McpManageBridge';
import { McpUtilityBridge } from '@/components/McpUtilityBridge';
import { ApiClientRuntimeProvider } from '@/components/tools/apiclient/mcpRuntimeContext';
import { MockServerRuntimeProvider } from '@/components/tools/mockserver/mcpRuntimeContext';
import { ExperimentalGate } from '@/components/ExperimentalGate';
import { ExperimentalDot, ExperimentalMark } from '@/components/ExperimentalBadge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';
import type { TranslationKey } from '@/lib/i18n';
import { UpdateProvider, useUpdate } from '@/contexts/UpdateContext';
import { ExtensionUpdateProvider, useExtensionUpdates } from '@/contexts/ExtensionUpdateContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { MeetingsProvider } from '@/lib/meetings';
import { UpdateDialog } from '@/components/UpdateDialog';
import { ToolGuideModal } from '@/components/ToolGuideModal';
import { OnboardingProvider, useOnboarding } from '@/contexts/OnboardingContext';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { useToolGuideTracking } from '@/hooks/useToolGuideTracking';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLogo } from '@/components/AppLogo';
import { isTauri, IS_MAC } from '@/lib/platform';

/** macOS with `titleBarStyle: "Overlay"`: no separate titlebar, so the app
 *  leaves room for the traffic lights and a drag region. */
const showMacOverlayChrome = isTauri && IS_MAC;
/** Windows/Linux turn `decorations` off (tauri.windows/linux.conf.json), so
 *  the app draws its own titlebar, drag region and window buttons, in one
 *  neutral style for both. */
const showCustomChrome = isTauri && !IS_MAC;
/** Either custom titlebar: the tool header moves into it. */
const showMergedTitlebar = showMacOverlayChrome || showCustomChrome;

type TauriResizeDirection = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

/** `@tauri-apps/api/window` only exists in Tauri; imported lazily so the
 *  web bundle does not include it. */
async function tauriWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}
const winMinimize = () => { tauriWindow().then((w) => w.minimize()); };
const winToggleMaximize = () => { tauriWindow().then((w) => w.toggleMaximize()); };
const winClose = () => { tauriWindow().then((w) => w.close()); };
const winStartResize = (dir: TauriResizeDirection) => { tauriWindow().then((w) => w.startResizeDragging(dir)); };

/** `decorations: false` also removes the OS resize borders, so thin edge and
 *  corner zones call `startResizeDragging` in the right direction. They
 *  sit inside the window, so they stay clear of the caption buttons (the
 *  top-right corner belongs to Close, as on Windows) and are not rendered
 *  while the window is maximized. */
function ResizeHandles() {
  const T = 6; // độ dày vùng cạnh, px
  const C = 12; // độ dài cạnh vùng góc, px
  const TITLEBAR = 38; // chiều cao titlebar
  const CAPTION = 128; // 3 nút cửa sổ (3 × 40px) + vạch ngăn
  const edge = (dir: TauriResizeDirection, style: React.CSSProperties) => (
    <div
      key={dir}
      className="fixed z-[200]"
      style={style}
      onMouseDown={() => winStartResize(dir)}
    />
  );
  return (
    <>
      {edge('North', { top: 0, left: C, right: CAPTION, height: T, cursor: 'ns-resize' })}
      {edge('South', { bottom: 0, left: C, right: C, height: T, cursor: 'ns-resize' })}
      {edge('West', { top: C, bottom: C, left: 0, width: T, cursor: 'ew-resize' })}
      {edge('East', { top: TITLEBAR, bottom: C, right: 0, width: T, cursor: 'ew-resize' })}
      {edge('NorthWest', { top: 0, left: 0, width: C, height: C, cursor: 'nwse-resize' })}
      {edge('SouthWest', { bottom: 0, left: 0, width: C, height: C, cursor: 'nesw-resize' })}
      {edge('SouthEast', { bottom: 0, right: 0, width: C, height: C, cursor: 'nwse-resize' })}
    </>
  );
}

function applySavedOrder<T extends { featureId: string }>(tools: T[], savedOrder: string[]): T[] {
  const order = savedOrder.length ? savedOrder : DEFAULT_TOOL_ORDER;
  if (!order.length) return tools;
  const map = new Map(tools.map((t) => [t.featureId, t]));
  const ordered: T[] = [];
  for (const id of order) {
    const t = map.get(id);
    if (t) ordered.push(t);
  }
  // append any new tools not in saved order
  for (const t of tools) {
    if (!order.includes(t.featureId)) ordered.push(t);
  }
  return ordered;
}

// Shown briefly while a tool's code-split chunk loads. Fills the content area so
// the header/sidebar stay put — no layout shift.
function ToolLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-fg-mute/60" />
    </div>
  );
}

// Scrollable nav list with an overflow fade indicator. Extracted into its own
// component so hooks (useRef, useState, useLayoutEffect) follow React rules —
// calling hooks inside an IIFE inside another component's render is invalid.
type SidebarTool = (typeof allTools)[0];

// Small uppercase group header used to separate Favorites from the rest.
function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-mute/60', className)}>
      {children}
    </p>
  );
}

function NavScrollArea({
  navEntries,
  query,
  disabledMatches,
  settingsTool,
  onClose,
  onEnableTool,
  isCollapsed,
  hiddenCount,
  favoriteCount,
  isFavorite,
  onToggleFavorite,
}: {
  navEntries: NavEntry[];
  query: string;
  disabledMatches: SidebarTool[];
  settingsTool: SidebarTool;
  onClose: () => void;
  onEnableTool: (tool: SidebarTool) => void;
  isCollapsed: boolean;
  hiddenCount: number;
  favoriteCount: number;
  isFavorite: (featureId: string) => boolean;
  onToggleFavorite: (featureId: string) => void;
}) {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const liveIds = useLiveConnections();

  // Section labels ("Favorites" / "All tools") only make sense when favourites
  // are pinned to the top of the full, unfiltered, expanded list.
  const showSections = !query && !isCollapsed && favoriteCount > 0 && favoriteCount < navEntries.length;
  const { t } = useLocale();

  const checkScroll = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useLayoutEffect(() => {
    checkScroll();
    const el = navRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll, navEntries.length, disabledMatches.length, query]);

  return (
    <div className="relative flex-1 min-h-0">
      <nav ref={navRef} className="h-full overflow-y-auto px-1.5 py-2">
        {navEntries.length === 0 && disabledMatches.length === 0 && query && (
          <p className="px-2 py-4 text-center text-[11px] text-fg-mute">{t('shell.search.noMatch', { query })}</p>
        )}
        <div className="space-y-0.5">
          {navEntries.map((entry, i) => {
            const Icon = entry.icon;
            // Clicking a group opens its first tool; the group is highlighted
            // when any member is active.
            const memberPaths = entry.tools.map((t) => toolPath(t.id));
            const path = memberPaths[0];
            const isActive = memberPaths.includes(location.pathname);
            const isLive = entry.tools.some((t) => liveIds.includes(t.id));
            const isExperimental = entry.tools.some((t) => t.experimental);
            const fav = entry.tools.some((t) => isFavorite(t.id));
            // A group's description lists its tools.
            const desc = entry.isGroup
              ? entry.tools.map((t) => t.label).join(' · ')
              : entry.tools[0].description;
            return (
              <div key={entry.key}>
                {/* Group headers — only when favourites are pinned at the top */}
                {showSections && i === 0 && <SectionLabel>{t('shell.section.favorites')}</SectionLabel>}
                {showSections && i === favoriteCount && <SectionLabel className="mt-2">{t('shell.section.allTools')}</SectionLabel>}
                <Tooltip
                  side="right"
                  triggerClassName="block"
                  label={
                    isLive
                      ? t('shell.sidebar.connectedLabel', { label: entry.label })
                      : isExperimental
                        ? t('shell.experimental.sidebarLabel', { label: entry.label })
                        : entry.label
                  }
                  description={desc}
                >
                  <Link
                    to={path}
                    onClick={onClose}
                    className={cn(
                      // rounded-md: the app's "selected" shape (design/RULES.md).
                      'group relative flex w-full items-center rounded-md px-2.5 py-1.5 transition-[color,background-color,box-shadow] duration-base ease-out-soft',
                      isCollapsed ? 'justify-center' : 'gap-2.5',
                      isActive
                        ? 'bg-acc-tint text-acc-ink font-medium'
                        : 'text-fg-mute hover:text-fg hover:bg-fg/[0.05]'
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon className="h-4 w-4" />
                      {isLive && (
                        // Live connection is a status, so always green, never the accent
                        // (design/RULES.md).
                        <span
                          className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-ok ring-2 ring-[hsl(var(--chrome-c))]"
                          title={t('shell.sidebar.connected')}
                        />
                      )}
                      {isExperimental && isCollapsed && (
                        <ExperimentalDot title={t('shell.experimental.badge')} />
                      )}
                    </span>
                    {/* The label stays mounted and fades with the sidebar's 300ms
                        width animation. `min-w-0` lets a long label truncate while the
                        group count and experimental mark (`shrink-0`) stay whole. */}
                    <span
                      className={cn(
                        'inline-flex min-w-0 items-center text-sm transition-[max-width,opacity] duration-slow ease-out-soft motion-reduce:transition-none',
                        isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
                        isActive && 'font-medium'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      {/* Number of tools in the group. */}
                      {entry.isGroup && (
                        <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-fg-mute/60">
                          {entry.tools.length}
                        </span>
                      )}
                      {isExperimental && !isCollapsed && <ExperimentalMark className="ml-1.5" />}
                    </span>
                    {/* Favorite toggle, hidden when collapsed. On a group it acts on
                        the whole group: unfavoriting removes every member, favoriting
                        marks the first tool, so favorites remain tool ids. */}
                    {!isCollapsed && (
                      <button
                        type="button"
                        aria-label={fav ? t('common.unfavoriteAria', { label: entry.label }) : t('common.favoriteAria', { label: entry.label })}
                        title={fav ? t('common.unfavorite') : t('common.favorite')}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (fav) {
                            entry.tools.filter((t) => isFavorite(t.id)).forEach((t) => onToggleFavorite(t.id));
                          } else {
                            onToggleFavorite(entry.tools[0].id);
                          }
                        }}
                        className={cn(
                          'ml-auto shrink-0 rounded-xs p-0.5 transition-colors duration-fast ease-out-soft',
                          fav
                            ? 'text-warn opacity-100'
                            : 'text-fg-mute/50 opacity-0 hover:text-warn group-hover:opacity-100 focus-visible:opacity-100'
                        )}
                      >
                        <Star className={cn('h-3.5 w-3.5', fav && 'fill-current')} />
                      </button>
                    )}
                  </Link>
                </Tooltip>
              </div>
            );
          })}
        </div>

        {/* Search also reaches tools the user has turned off. They have no route
            until enabled, so each match is an Enable action (toggles the feature
            on, then navigates) rather than a plain link. */}
        {query && !isCollapsed && disabledMatches.length > 0 && (
          <div className="mt-3 space-y-0.5">
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-mute/60">
              {t('shell.section.disabled')}
            </p>
            {disabledMatches.map((tool) => {
              const Icon = tool.icon;
              const desc = TOOL_DEF_MAP.get(tool.featureId)?.description ?? '';
              return (
                <Tooltip key={tool.path} side="right" triggerClassName="block" label={t('shell.sidebar.disabledLabel', { label: tool.label })} description={desc}>
                  <button
                    type="button"
                    onClick={() => onEnableTool(tool)}
                    className="group relative flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-fg-mute/70 transition-[color,background-color] duration-base ease-out-soft hover:text-fg hover:bg-fg/[0.05]"
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                    <span className="flex-1 truncate text-sm">{tool.label}</span>
                    <span className="flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-acc opacity-0 transition-opacity group-hover:opacity-100">
                      <Plus className="h-3 w-3" /> {t('shell.sidebar.enable')}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        {/* Hint: more tools exist but are hidden — link to Settings to enable them.
            Deliberately low-emphasis (small, muted, no tab styling) so it reads as
            a hint, not a tool entry. */}
        {!query && hiddenCount > 0 && (
          <Tooltip
            side="right"
            triggerClassName="block"
            label={t('shell.sidebar.moreAvailable', { count: hiddenCount })}
            description={t('shell.sidebar.turnOnHint')}
          >
            <Link
              to={settingsTool.path}
              onClick={onClose}
              className={cn(
                'mt-1.5 flex w-full items-center justify-center gap-1 text-fg-mute/50 hover:text-fg-mute transition-colors',
                isCollapsed ? 'py-1.5' : 'px-2.5 py-1.5 text-[11px]'
              )}
            >
              <Plus className={isCollapsed ? 'h-3 w-3' : 'h-2.5 w-2.5 shrink-0'} />
              {!isCollapsed && (
                <span className="whitespace-nowrap">{t('shell.sidebar.moreInSettings', { count: hiddenCount })}</span>
              )}
            </Link>
          </Tooltip>
        )}
      </nav>
      {/* Fade + indicator when more items below */}
      {hasMore && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 flex items-end justify-center pb-1"
          style={{ background: 'linear-gradient(to bottom, transparent, hsl(var(--chrome-c)) 85%)' }}>
          <span className={cn(
            'flex items-center gap-0.5 text-[11px] text-fg-mute/60',
            isCollapsed ? 'flex-col' : 'flex-row'
          )}>
            <ChevronDown className="h-2.5 w-2.5" />
            {!isCollapsed && t('shell.sidebar.moreScrollHint')}
          </span>
        </div>
      )}
    </div>
  );
}

// With the workspace bar showing tabs, the titlebar no longer has room for
// the group's sibling tabs (ToolIdentity is only the bar's fallback), so
// they move to a strip above the tool. Without it, Text Counter or Data
// Converter would have no visible way in once two tools are open.
function GroupTabsStrip() {
  const barVisible = useWorkspaceBarVisible();
  const { tabs } = useActiveGroupTabs();
  if (!barVisible || tabs.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center border-b border-line bg-chrome px-3 py-1.5">
      <GroupTabs size="titlebar" />
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePreference; labelKey: TranslationKey; icon: typeof Sun }[] = [
  { value: 'light', labelKey: 'shell.theme.light', icon: Sun },
  { value: 'dark', labelKey: 'shell.theme.dark', icon: Moon },
  { value: 'system', labelKey: 'shell.theme.system', icon: Monitor },
];

// Compact single-button cycle order used by the mobile header toggle.
const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

function Sidebar({
  isOpen,
  onClose,
  themePreference,
  onThemeChange,
  isCollapsed,
  onToggleCollapse,
}: {
  isOpen: boolean;
  onClose: () => void;
  themePreference: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const location = useLocation();
  const { isFeatureEnabled, toggleFeature, toolOrder, favorites, toggleFavorite, isFavorite } = useFeatures();
  const { updateAvailable } = useUpdate();
  const { updates: extensionUpdates } = useExtensionUpdates();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  // Enabling a disabled search result turns its feature on (which registers its
  // route) and navigates to it, then clears the search and closes the drawer.
  const handleEnableTool = useCallback((tool: SidebarTool) => {
    toggleFeature(tool.featureId);
    navigate(tool.path);
    setQuery('');
    onClose();
  }, [toggleFeature, navigate, onClose]);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocus = useRef(false);

  useEffect(() => {
    if (!isCollapsed && pendingSearchFocus.current) {
      pendingSearchFocus.current = false;
      searchRef.current?.focus();
    }
  }, [isCollapsed]);

  const baseEnabled = allTools.filter((tool) => isFeatureEnabled(tool.featureId));
  const orderedTools = applySavedOrder(baseEnabled, toolOrder);

  // Settings is pinned to the bottom — exclude from the nav list
  const allNavTools = orderedTools.filter((t) => t.featureId !== 'settings');

  // ── Nav entries: grouped when browsing, flat when searching ───────────────
  // Typing "cron" must land on Cron itself, not on a "Time" group the user then
  // has to guess into. So a query produces one entry per matching tool, and the
  // renderer below stays single-path: everything is a NavEntry either way.
  const navEntries: NavEntry[] = query.trim()
    ? allNavTools
        .filter((t) => toolMatchesQuery(t, query))
        .map((t) => {
          const def = TOOL_DEF_MAP.get(t.featureId)!;
          return { key: def.id, label: def.label, icon: def.icon, isGroup: false, tools: [def] };
        })
    : buildNavEntries({
        enabledIds: new Set(allNavTools.map((t) => t.featureId)),
        order: toolOrder,
        favorites,
      });
  const favoriteCount = query.trim() ? 0 : countFavoriteEntries(navEntries, favorites);
  const settingsTool = allTools.find((t) => t.featureId === 'settings')!;
  const isSettingsActive = location.pathname === settingsTool.path;
  const activeThemeOption = THEME_OPTIONS.find((o) => o.value === themePreference)!;
  const ThemeIcon = activeThemeOption.icon;

  // Tools the user has hidden — surfaced as a hint so they know more exist.
  const disabledTools = allTools.filter((t) => t.featureId !== 'settings' && !isFeatureEnabled(t.featureId));
  const hiddenCount = disabledTools.length;
  // When a search finds nothing enabled but matches a disabled tool, point the user to Settings.
  const disabledMatches = query.trim()
    ? disabledTools.filter((t) => toolMatchesQuery(t, query))
    : [];

  return (
    <>
      {/* Backdrop fades in/out in sync with the drawer slide (mobile only).
          Always rendered so the fade plays on close too, not just open. */}
      <div
        className={cn(
          'fixed inset-0 bg-black/30 backdrop-blur-[1px] z-40 md:hidden transition-opacity duration-slow ease-out-soft',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed md:sticky top-0 left-0 z-50 h-full sidebar-chrome transition-[width,transform] duration-slow ease-out-soft flex flex-col',
          isCollapsed ? 'w-14' : 'w-56',
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Header, only when there is no custom titlebar. Otherwise the
            logo lives in AppContent's titlebar, which does not move when
            the sidebar collapses. */}
        {!showMergedTitlebar && (
          <div className={cn(
            'flex shrink-0 items-center border-b border-line py-2.5',
            isCollapsed ? 'justify-center px-2' : 'justify-between px-3'
          )}>
            <div className="flex min-w-0 items-center gap-2.5">
              <AppLogo size={30} />
              <h1
                className={cn(
                  'whitespace-nowrap overflow-hidden text-sm font-semibold leading-none transition-[max-width,opacity] duration-slow ease-out-soft motion-reduce:transition-none',
                  isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
                )}
              >
                DevTool
              </h1>
            </div>
            <Button variant="ghost" size="icon" className="h-ctl w-ctl shrink-0 md:hidden" onClick={onClose} title={t('shell.sidebar.closeMenu')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Search */}
        {isCollapsed ? (
          <div className="shrink-0 flex justify-center px-2 pt-2">
            <button
              onClick={() => { pendingSearchFocus.current = true; onToggleCollapse(); }}
              title={t('shell.sidebar.searchToolsTitle')}
              className="flex items-center justify-center h-ctl w-ctl rounded-sm text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="shrink-0 px-1.5 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-fg-mute/60" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('shell.search.placeholder')}
                className="h-ctl pl-7 pr-7 text-xs"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label={t('shell.sidebar.clearSearch')}
                  title={t('shell.sidebar.clearSearch')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-mute/60 hover:text-fg transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scrollable tool list with overflow fade */}
        <NavScrollArea
          navEntries={navEntries}
          query={query}
          disabledMatches={disabledMatches}
          settingsTool={settingsTool}
          onClose={onClose}
          onEnableTool={handleEnableTool}
          isCollapsed={isCollapsed}
          hiddenCount={hiddenCount}
          favoriteCount={favoriteCount}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
        />

        {/* Pinned bottom bar — always visible, order: Collapse → Dark mode → Settings */}
        <div className="shrink-0 border-t px-1.5 py-2 space-y-0.5">
          {/* Collapse/expand, desktop only. The tooltip only shows when
              collapsed, since the expanded row already has a label. */}
          <Tooltip side="right" label={isCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')} disabled={!isCollapsed} triggerClassName="block w-full">
            <button
              onClick={onToggleCollapse}
              title={isCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
              className={cn(
                'group relative hidden md:flex w-full items-center rounded-sm px-2.5 py-1.5 transition-colors text-fg-mute hover:text-fg hover:bg-bg-2/60',
                isCollapsed ? 'justify-center' : 'gap-2.5'
              )}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronLeft className="h-4 w-4 shrink-0" />}
              <span
                className={cn(
                  'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-slow ease-out-soft motion-reduce:transition-none',
                  isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
                )}
              >
                {t('shell.sidebar.collapseLabel')}
              </span>
            </button>
          </Tooltip>

          {/* Theme preference — single cycling toggle (Light → Dark → System),
              styled to match the Collapse/Settings rows instead of a boxed segmented control */}
          <Tooltip side="right" label={t(activeThemeOption.labelKey)} disabled={!isCollapsed} triggerClassName="block w-full">
            <button
              onClick={() => onThemeChange(NEXT_THEME[themePreference])}
              title={t('shell.sidebar.themeCycle', { theme: t(activeThemeOption.labelKey) })}
              className={cn(
                'group relative flex w-full items-center rounded-sm px-2.5 py-1.5 transition-colors text-fg-mute hover:text-fg hover:bg-bg-2/60',
                isCollapsed ? 'justify-center' : 'gap-2.5'
              )}
            >
              <ThemeIcon className="h-4 w-4 shrink-0" />
              <span
                className={cn(
                  'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-slow ease-out-soft motion-reduce:transition-none',
                  isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
                )}
              >
                {t(activeThemeOption.labelKey)}
              </span>
            </button>
          </Tooltip>

          {/* Settings — always last */}
          <Tooltip side="right" label={t('shell.sidebar.settings')} disabled={!isCollapsed} triggerClassName="block w-full">
            <Link
              to={settingsTool.path}
              onClick={onClose}
              title={t('shell.sidebar.settings')}
              className={cn(
                // rounded-md: the same "selected" shape as the tool rows above.
                'group relative flex items-center rounded-md px-2.5 py-1.5 transition-[color,background-color,box-shadow] duration-base ease-out-soft',
                isCollapsed ? 'justify-center' : 'gap-2.5',
                isSettingsActive
                  ? 'bg-acc/10 text-acc font-medium'
                  : 'text-fg-mute hover:text-fg hover:bg-fg/[0.05]'
              )}
            >
              <span className="relative shrink-0">
                <SettingsIcon className="h-4 w-4 transition-transform duration-base ease-out-soft motion-safe:group-hover:scale-110" />
                {(updateAvailable || extensionUpdates.length > 0) && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-ok ring-1 ring-bg" />
                )}
              </span>
              <span
                className={cn(
                  'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-slow ease-out-soft motion-reduce:transition-none',
                  isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
                  isSettingsActive && 'font-medium'
                )}
              >
                {t('shell.sidebar.settings')}
              </span>
            </Link>
          </Tooltip>
        </div>
      </aside>
    </>
  );
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isFeatureEnabled, toolOrder } = useFeatures();
  const { t } = useLocale();
  useDesktopChrome();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = storageGet('devtool-sidebar-collapsed');
    return saved === 'true';
  });
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    getThemePreference()
  );
  // The custom maximize button shows □ or ⧉ depending on window state,
  // as Windows does.
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    if (!showCustomChrome) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    tauriWindow().then(async (win) => {
      const initial = await win.isMaximized();
      if (!cancelled) setIsMaximized(initial);
      unlisten = await win.onResized(async () => {
        if (!cancelled) setIsMaximized(await win.isMaximized());
      });
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  // Resolves `system` -> actual dark/light, applies the `dark` class to
  // <html>, and (while preference === 'system') keeps it in sync in real
  // time as the OS theme changes.
  const isDark = useThemeSync(themePreference);

  useEffect(() => {
    storageSet('devtool-sidebar-collapsed', isCollapsed.toString());
  }, [isCollapsed]);

  // Install deep links from the plugins web page. Attached once for the
  // app's lifetime (guarded inside), so re-running the effect is safe.
  useEffect(() => {
    void initDeepLinkHandling(navigate);
  }, [navigate]);

  const changeTheme = (value: ThemePreference) => {
    triggerThemeTransition();
    setThemePreference(value);
    setThemePreferenceState(value);
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const enabledTools = allTools.filter((tool) => isFeatureEnabled(tool.featureId));
  const SettingsComponent = allTools.find((t) => t.featureId === 'settings')!.component;
  // Where unmatched URLs go (see <Route path="*">): the first enabled tool
  // in the user's sidebar order.
  const fallbackPath =
    applySavedOrder(enabledTools, toolOrder).find((t) => t.featureId !== 'settings')?.path
    ?? '/settings';
  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const isFullHeight = !!(activeTool as typeof allTools[0] & { fullHeight?: boolean }).fullHeight;
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideIsWhatsNew, setGuideIsWhatsNew] = useState(false);
  const { shouldAutoShow, markSeen } = useToolGuideTracking();
  const { show: onboardingShowing } = useOnboarding();

  // Auto-open the guide once per tool version bump (or on a brand-new
  // install, once per tool's first-ever visit) — see useToolGuideTracking.
  // Deferred while the global onboarding dialog is up so the two don't stack.
  useEffect(() => {
    if (onboardingShowing) return;
    if (shouldAutoShow(activeTool.featureId)) {
      setGuideIsWhatsNew(true);
      setGuideOpen(true);
    }
    // Re-run only when the active tool or the onboarding dialog's visibility changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool.featureId, onboardingShowing]);

  const openGuideManually = () => {
    setGuideIsWhatsNew(false);
    setGuideOpen(true);
  };

  const handleGuideOpenChange = (open: boolean) => {
    setGuideOpen(open);
    if (!open) {
      markSeen(activeTool.featureId);
      setGuideIsWhatsNew(false);
    }
  };

  const routes = (
    <ErrorBoundary resetKey={location.pathname} toolId={activeTool.featureId} toolLabel={activeTool.label}>
      <Suspense fallback={<ToolLoading />}>
        <Routes>
          {enabledTools.map((tool) => (
            <Route
              key={tool.path}
              path={tool.path}
              element={tool.experimental ? (
                <ExperimentalGate label={tool.label}><tool.component /></ExperimentalGate>
              ) : (
                <tool.component />
              )}
            />
          ))}
          <Route path="/settings" element={<SettingsComponent />} />
          {/* No match: go to the first enabled tool instead of a blank page
              (e.g. '/' belongs to a tool the user disabled). `replace` keeps
              the bad URL out of history. */}
          <Route path="*" element={<Navigate to={fallbackPath} replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );

  // Logo plus the active tool's identity/tabs, shared by both custom
  // titlebars (macOS overlay and Windows/Linux).
  const titlebarNav = (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <AppLogo size={18} />
        <h1 className="whitespace-nowrap text-xs font-semibold leading-none">DevTool</h1>
      </div>
      <span className="h-4 w-px shrink-0 bg-line" />
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 md:hidden" onClick={() => setSidebarOpen(true)} title={t('shell.titlebar.openMenu')} aria-label={t('shell.titlebar.openMenu')}>
        <Menu className="h-3.5 w-3.5" />
      </Button>
      {/* The workspace bar replaces the tool identity when there is
          something to switch between (2+ tabs or workspaces). */}
      <WorkspaceBar
        size="titlebar"
        fallback={<ToolIdentity size="titlebar" />}
      />
    </div>
  );

  const titlebarHelpAction = (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 text-fg-mute/70 hover:text-fg"
      onClick={openGuideManually}
      title={t('shell.titlebar.howToUse', { label: activeTool.label })}
      aria-label={t('shell.titlebar.howToUse', { label: activeTool.label })}
    >
      <HelpCircle className="h-3.5 w-3.5" />
    </Button>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-fg">
      {showCustomChrome && !isMaximized && <ResizeHandles />}
      {/* macOS overlay titlebar, spanning the whole window and independent
          of the sidebar's width. `data-tauri-drag-region="deep"` makes it
          draggable while buttons stay clickable. The traffic lights are
          placed by `trafficLightPosition` in tauri.conf.json; the left
          padding clears them. */}
      {showMacOverlayChrome && (
        <div
          className="flex h-[38px] shrink-0 items-center justify-between border-b border-line bg-chrome pl-[96px] pr-3"
          data-tauri-drag-region="deep"
        >
          {titlebarNav}
          {/* Explicit drag region between the left and right groups. */}
          <div className="flex-1" data-tauri-drag-region="deep" />
          <div className="flex shrink-0 items-center gap-1">
            {/* Slot for tool-specific header actions (filled via ToolHeaderActions portal) */}
            <div id="tool-header-actions" className="flex items-center gap-0.5" />
            {titlebarHelpAction}
          </div>
        </div>
      )}
      {/* Windows/Linux titlebar: the app draws minimize/maximize/close on
          the right, as those platforms do. */}
      {showCustomChrome && (
        <div
          className="flex h-[38px] shrink-0 items-center justify-between border-b border-line bg-chrome pl-3"
          data-tauri-drag-region="deep"
        >
          {titlebarNav}
          <div className="flex-1" data-tauri-drag-region="deep" />
          {/* No right padding: Close must touch the window edge, as on Windows. */}
          <div className="flex h-full shrink-0 items-center gap-0.5">
            <div id="tool-header-actions" className="flex items-center gap-0.5" />
            {titlebarHelpAction}
            <span className="mx-1 h-4 w-px shrink-0 bg-line" />
            {/* Window buttons deliberately ignore app tokens and <Button>
                effects: they are OS chrome, styled after Windows 11. `h-full`
                makes them fill the 38px titlebar. */}
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-10 shrink-0 cursor-default rounded-none text-fg/90 hover:bg-fg/10 hover:text-fg active:scale-100 active:bg-fg/15 focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={winMinimize}
              title={t('shell.titlebar.minimize')} aria-label={t('shell.titlebar.minimize')}
            >
              <Minus className="h-3 w-3" strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-10 shrink-0 cursor-default rounded-none text-fg/90 hover:bg-fg/10 hover:text-fg active:scale-100 active:bg-fg/15 focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={winToggleMaximize}
              title={isMaximized ? t('shell.titlebar.restore') : t('shell.titlebar.maximize')} aria-label={isMaximized ? t('shell.titlebar.restore') : t('shell.titlebar.maximize')}
            >
              {isMaximized ? (
                <Copy className="h-3 w-3 -scale-x-100" strokeWidth={1.5} />
              ) : (
                <Square className="h-2.5 w-2.5" strokeWidth={1.5} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-10 shrink-0 cursor-default rounded-none text-fg/90 hover:bg-[#e81123] hover:text-white active:scale-100 active:bg-[#c42b1c] active:text-white dark:hover:bg-[#c42b1c] dark:active:bg-[#8c2318] focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={winClose}
              title={t('shell.titlebar.close')} aria-label={t('shell.titlebar.close')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        themePreference={themePreference}
        onThemeChange={changeTheme}
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
      />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* With a custom titlebar the tool header lives there; not
            rendering it here keeps #tool-header-actions unique. */}
        {!showMergedTitlebar && (
        <div className="z-30 header-chrome shrink-0">
          {/* py-2 gives a 50px row that lines up with the sidebar header. */}
          <div className="flex items-center justify-between px-4 py-2 sm:px-5">
            <div className="flex items-center gap-2.5">
              <Button variant="ghost" size="icon" className="md:hidden h-ctl w-ctl" onClick={() => setSidebarOpen(true)} title={t('shell.titlebar.openMenu')} aria-label={t('shell.titlebar.openMenu')}>
                <Menu className="h-4 w-4" />
              </Button>
              {/* No live dot here: the active tab already shows one. The
                  workspace bar is rendered inline; the identity block is only
                  its fallback when there are fewer than two tabs. */}
              <WorkspaceBar
                size="header"
                fallback={<ToolIdentity size="header" />}
              />
            </div>
            <div className="flex min-w-0 items-center gap-1">
              {/* Slot for tool-specific header actions (filled via ToolHeaderActions portal) */}
              <div id="tool-header-actions" className="flex items-center gap-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-ctl w-ctl text-fg-mute/70 hover:text-fg"
                onClick={openGuideManually}
                title={t('shell.titlebar.howToUse', { label: activeTool.label })}
                aria-label={t('shell.titlebar.howToUse', { label: activeTool.label })}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-ctl w-ctl"
                onClick={() => changeTheme(NEXT_THEME[themePreference])}
                title={t('shell.titlebar.themeCycleTap', { theme: t(THEME_OPTIONS.find((o) => o.value === themePreference)!.labelKey) })}
              >
                {themePreference === 'system' ? (
                  <Monitor className="h-4 w-4" />
                ) : isDark ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
        )}
        <GroupTabsStrip />
        {isFullHeight ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* key on pathname re-triggers the entrance animation on each tool switch */}
            <div key={location.pathname} className="h-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft">
              {routes}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div
              key={location.pathname}
              className="mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-slow motion-safe:ease-out-soft"
            >
              {routes}
            </div>
          </div>
        )}
      </main>
      </div>

      <ToolGuideModal
        toolId={activeTool.featureId}
        label={activeTool.label}
        description={activeTool.description ?? ''}
        open={guideOpen}
        onOpenChange={handleGuideOpenChange}
        isWhatsNew={guideIsWhatsNew}
      />
    </div>
  );
}

function App() {
  return (
    <AppConfigProvider>
      <LocaleProvider>
        <FeatureProvider>
          <OnboardingProvider>
            <UpdateProvider>
              <ExtensionUpdateProvider>
                <MeetingsProvider>
                  <ApiClientRuntimeProvider>
                    <MockServerRuntimeProvider>
                      <Router>
                        <WorkspaceProvider>
                          <AppContent />
                          <UpdateDialog />
                          <OnboardingFlow />
                          <CommandPalette />
                          <McpBackgroundBridge />
                          <McpManageBridge />
                          <McpUtilityBridge />
                        </WorkspaceProvider>
                      </Router>
                    </MockServerRuntimeProvider>
                  </ApiClientRuntimeProvider>
                </MeetingsProvider>
              </ExtensionUpdateProvider>
            </UpdateProvider>
          </OnboardingProvider>
        </FeatureProvider>
      </LocaleProvider>
    </AppConfigProvider>
  );
}

export default App;
