import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDesktopChrome } from '@/hooks/useDesktopChrome';
import { useThemeSync, triggerThemeTransition } from '@/hooks/useThemeSync';
import { TOOL_DEF_MAP, DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { allTools, toolPath } from '@/lib/toolRegistry';
import { buildNavEntries, countFavoriteEntries, GROUP_OF_TOOL, type NavEntry } from '@/lib/toolGroups';
import { toolMatchesQuery } from '@/lib/toolSearch';
import { useLiveConnections } from '@/lib/liveConnections';
import { CommandPalette } from '@/components/CommandPalette';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';
import { UpdateProvider, useUpdate } from '@/contexts/UpdateContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { MeetingsProvider } from '@/lib/meetings';
import { UpdateDialog } from '@/components/UpdateDialog';
import { ToolGuideModal } from '@/components/ToolGuideModal';
import { OnboardingProvider, useOnboarding } from '@/contexts/OnboardingContext';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { useToolGuideTracking } from '@/hooks/useToolGuideTracking';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLogo } from '@/components/AppLogo';

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
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
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
    <p className={cn('px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60', className)}>
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
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">{t('shell.search.noMatch', { query })}</p>
        )}
        <div className="space-y-0.5">
          {navEntries.map((entry, i) => {
            const Icon = entry.icon;
            // Bấm vào nhóm là vào tool đầu tiên; nhóm sáng lên khi ĐANG ở bất kỳ
            // thành viên nào, nếu không mở Deduplicate sẽ thấy sidebar không
            // sáng chỗ nào.
            const memberPaths = entry.tools.map((t) => toolPath(t.id));
            const path = memberPaths[0];
            const isActive = memberPaths.includes(location.pathname);
            const isLive = entry.tools.some((t) => liveIds.includes(t.id));
            const fav = entry.tools.some((t) => isFavorite(t.id));
            // Nhóm mô tả bằng tên các tool bên trong — hữu ích hơn là cố viết
            // một câu bao trùm cả ba.
            const desc = entry.isGroup
              ? entry.tools.map((t) => t.label).join(' · ')
              : entry.tools[0].description;
            return (
              <div key={entry.key}>
                {/* Group headers — only when favourites are pinned at the top */}
                {showSections && i === 0 && <SectionLabel>{t('shell.section.favorites')}</SectionLabel>}
                {showSections && i === favoriteCount && <SectionLabel className="mt-2">{t('shell.section.allTools')}</SectionLabel>}
                <Tooltip side="right" triggerClassName="block" label={isLive ? `${entry.label} — connected` : entry.label} description={desc}>
                  <Link
                    to={path}
                    onClick={onClose}
                    className={cn(
                      'group relative flex w-full items-center rounded-sm px-2.5 py-2.5 transition-[color,background-color,box-shadow] duration-200 ease-out',
                      isCollapsed ? 'justify-center' : 'gap-2.5',
                      isActive
                        ? 'bg-acc-tint text-acc-ink font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]'
                    )}
                  >
                    <span className="relative flex-shrink-0">
                      <Icon className="h-4 w-4" />
                      {isLive && (
                        // "Đang kết nối" là TRẠNG THÁI → xanh lá cố định, không
                        // theo accent. Xem design/RULES.md.
                        <span
                          className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-ok ring-2 ring-[hsl(var(--sidebar))]"
                          title="Connected"
                        />
                      )}
                    </span>
                    {/* Label is always mounted and fades/collapses with the sidebar
                        (300ms, matching the aside width animation) so it glides
                        rather than popping in/out on collapse-expand. */}
                    <span
                      className={cn(
                        'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out motion-reduce:transition-none',
                        isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
                        isActive && 'font-medium'
                      )}
                    >
                      {entry.label}
                      {/* Số tool trong nhóm — cho biết còn gì bên trong trước
                          khi bấm vào. */}
                      {entry.isGroup && (
                        <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground/60">
                          {entry.tools.length}
                        </span>
                      )}
                    </span>
                    {/* Favourite toggle — pins the entry to the top of the list.
                        Hidden when collapsed (no room); a starred entry shows a
                        filled star always, others reveal an outline on hover.

                        Trên một NHÓM, ngôi sao thao tác lên cả nhóm: bỏ yêu
                        thích thì gỡ hết thành viên, thêm thì đánh dấu tool đầu.
                        Nhờ vậy dữ liệu yêu thích vẫn là id tool như cũ — không
                        cần di trú gì khi bật tính năng nhóm. */}
                    {!isCollapsed && (
                      <button
                        type="button"
                        aria-label={fav ? `Unfavorite ${entry.label}` : `Favorite ${entry.label}`}
                        title={fav ? 'Remove from favorites' : 'Add to favorites'}
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
                          'ml-auto shrink-0 rounded-xs p-0.5 transition-colors duration-150',
                          fav
                            ? 'text-warn opacity-100'
                            : 'text-muted-foreground/50 opacity-0 hover:text-warn group-hover:opacity-100 focus-visible:opacity-100'
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
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              {t('shell.section.disabled')}
            </p>
            {disabledMatches.map((tool) => {
              const Icon = tool.icon;
              const desc = TOOL_DEF_MAP.get(tool.featureId)?.description ?? '';
              return (
                <Tooltip key={tool.path} side="right" triggerClassName="block" label={`${tool.label} — turned off`} description={desc}>
                  <button
                    type="button"
                    onClick={() => onEnableTool(tool)}
                    className="group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-muted-foreground/70 transition-[color,background-color] duration-200 ease-out hover:text-foreground hover:bg-foreground/[0.05]"
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                    <span className="flex-1 truncate text-sm">{tool.label}</span>
                    <span className="flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      <Plus className="h-3 w-3" /> Enable
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
            label={`${hiddenCount} more tool${hiddenCount > 1 ? 's' : ''} available`}
            description="Turn on more tools from the Settings page."
          >
            <Link
              to={settingsTool.path}
              onClick={onClose}
              className={cn(
                'mt-1.5 flex w-full items-center justify-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors',
                isCollapsed ? 'py-1.5' : 'px-2.5 py-1.5 text-[11px]'
              )}
            >
              <Plus className={isCollapsed ? 'h-3 w-3' : 'h-2.5 w-2.5 flex-shrink-0'} />
              {!isCollapsed && (
                <span className="whitespace-nowrap">{hiddenCount} more in Settings</span>
              )}
            </Link>
          </Tooltip>
        )}
      </nav>
      {/* Fade + indicator when more items below */}
      {hasMore && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 flex items-end justify-center pb-1"
          style={{ background: 'linear-gradient(to bottom, transparent, hsl(var(--sidebar)) 85%)' }}>
          <span className={cn(
            'flex items-center gap-0.5 text-[9px] text-muted-foreground/60',
            isCollapsed ? 'flex-col' : 'flex-row'
          )}>
            <ChevronDown className="h-2.5 w-2.5" />
            {!isCollapsed && 'more'}
          </span>
        </div>
      )}
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light mode', icon: Sun },
  { value: 'dark', label: 'Dark mode', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
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
          'fixed inset-0 bg-black/30 backdrop-blur-[1px] z-40 lg:hidden transition-opacity duration-300 ease-in-out',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-full sidebar-premium transition-all duration-300 ease-in-out flex flex-col',
          isCollapsed ? 'w-14' : 'w-56',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className={cn(
          'flex shrink-0 items-center border-b border-border',
          isCollapsed ? 'justify-center py-3 px-2' : 'justify-between px-3 py-3'
        )}>
          {isCollapsed ? (
            <AppLogo size={32} />
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <AppLogo size={30} />
              <div>
                <h1 className="text-sm font-semibold leading-none">DevTool</h1>
                <p className="mt-1 text-[11px] text-muted-foreground">{allNavTools.length} tools</p>
              </div>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={onClose} title="Close menu">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        {isCollapsed ? (
          <div className="shrink-0 flex justify-center px-2 pt-2">
            <button
              onClick={() => { pendingSearchFocus.current = true; onToggleCollapse(); }}
              title="Search tools"
              className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="shrink-0 px-1.5 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('shell.search.placeholder')}
                className="h-7 pl-7 pr-7 text-xs rounded-md bg-muted/40 border-muted focus-visible:ring-1"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
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
          {/* Collapse/expand — desktop only */}
          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'group relative hidden lg:flex w-full items-center rounded-lg px-2.5 py-2.5 transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/60',
              isCollapsed ? 'justify-center' : 'gap-2.5'
            )}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronLeft className="h-4 w-4 shrink-0" />}
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </span>
            )}
            <span
              className={cn(
                'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out motion-reduce:transition-none',
                isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
              )}
            >
              Collapse
            </span>
          </button>

          {/* Theme preference — single cycling toggle (Light → Dark → System),
              styled to match the Collapse/Settings rows instead of a boxed segmented control */}
          <button
            onClick={() => onThemeChange(NEXT_THEME[themePreference])}
            title={`Theme: ${activeThemeOption.label} (click to cycle)`}
            className={cn(
              'group relative flex w-full items-center rounded-lg px-2.5 py-2.5 transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/60',
              isCollapsed ? 'justify-center' : 'gap-2.5'
            )}
          >
            <ThemeIcon className="h-4 w-4 shrink-0" />
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                {activeThemeOption.label}
              </span>
            )}
            <span
              className={cn(
                'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out motion-reduce:transition-none',
                isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
              )}
            >
              {activeThemeOption.label}
            </span>
          </button>

          {/* Settings — always last */}
          <Link
            to={settingsTool.path}
            onClick={onClose}
            title="Settings"
            className={cn(
              'group relative flex items-center rounded-lg px-2.5 py-2.5 transition-[color,background-color,box-shadow] duration-200 ease-out',
              isCollapsed ? 'justify-center' : 'gap-2.5',
              isSettingsActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]'
            )}
          >
            <span className="relative shrink-0">
              <SettingsIcon className="h-4 w-4 transition-transform duration-200 ease-out motion-safe:group-hover:scale-110" />
              {updateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-ok ring-1 ring-background" />
              )}
            </span>
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                Settings
              </span>
            )}
            <span
              className={cn(
                'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out motion-reduce:transition-none',
                isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
                isSettingsActive && 'font-medium'
              )}
            >
              Settings
            </span>
          </Link>
        </div>
      </aside>
    </>
  );
}

function AppContent() {
  const location = useLocation();
  const { isFeatureEnabled } = useFeatures();
  useDesktopChrome();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = storageGet('devtool-sidebar-collapsed');
    return saved === 'true';
  });
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    getThemePreference()
  );
  // Resolves `system` -> actual dark/light, applies the `dark` class to
  // <html>, and (while preference === 'system') keeps it in sync in real
  // time as the OS theme changes.
  const isDark = useThemeSync(themePreference);

  useEffect(() => {
    storageSet('devtool-sidebar-collapsed', isCollapsed.toString());
  }, [isCollapsed]);

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
  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const ActiveIcon = activeTool.icon;
  // Tool đang mở có nằm trong nhóm nhiều tool không? Nếu có, header hiện tên
  // NHÓM cùng tab con thay vì tên tool — để người dùng thấy được các tool anh em
  // mà không phải quay lại sidebar.
  const activeGroup = GROUP_OF_TOOL.get(activeTool.featureId);
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
    <ErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<ToolLoading />}>
        <Routes>
          {enabledTools.map((tool) => (
            <Route key={tool.path} path={tool.path} element={<tool.component />} />
          ))}
          <Route path="/settings" element={<SettingsComponent />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        themePreference={themePreference}
        onThemeChange={changeTheme}
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
      />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="z-30 header-premium shrink-0">
          <div className="flex items-center justify-between px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2.5">
              <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div
                key={activeTool.path}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in-0 motion-safe:duration-200"
              >
                <ActiveIcon className="h-4 w-4 text-primary" />
              </div>
              <div key={`${activeTool.path}-label`} className="min-w-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                <h2 className="text-sm font-semibold leading-none text-foreground">
                  {activeGroup ? activeGroup.label : activeTool.label}
                </h2>
                {/* Dòng thứ hai từng lặp lại nguyên văn mô tả đã có trong tooltip
                    sidebar — tốn một dòng header trên mọi màn để nói lại điều
                    người dùng vừa đọc. Với nhóm, chỗ đó giờ là tab con; với tool
                    đứng riêng thì bỏ hẳn, nhường không gian cho nội dung.

                    Bản trước dùng nền nhuộm rất nhạt (`bg-acc-tint`) cho mục
                    đang chọn — cùng lỗi tương phản đã sửa ở `Segmented`: nền
                    nhuộm gần như hoà vào nền header, phải nhìn rất lâu mới ra
                    mục nào đang bật. Giờ mục đang chọn dùng nền đặc màu accent
                    (`bg-acc text-acc-fg`) như mọi bộ chuyển khác trong kit, đặt
                    trong một máng lõm (`bg-sunk`) để cả cụm đọc ra là MỘT khối
                    điều hướng thay vì mấy chữ rời rạc trôi dưới tiêu đề. */}
                {activeGroup && (
                  <div
                    role="tablist"
                    aria-label={activeGroup.label}
                    className="mt-1.5 inline-flex items-center gap-0.5 rounded-sm bg-sunk p-0.5"
                  >
                    {activeGroup.toolIds
                      .filter((id) => isFeatureEnabled(id))
                      .map((id) => {
                        const def = TOOL_DEF_MAP.get(id);
                        if (!def) return null;
                        const p = toolPath(id);
                        const on = p === location.pathname;
                        return (
                          <Link
                            key={id}
                            to={p}
                            role="tab"
                            aria-selected={on}
                            className={cn(
                              'inline-flex items-center rounded-xs px-2 py-0.5 text-xs leading-none transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0',
                              on
                                ? 'bg-acc font-semibold text-acc-fg shadow-soft'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {def.label}
                          </Link>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* Slot for tool-specific header actions (filled via ToolHeaderActions portal) */}
              <div id="tool-header-actions" className="flex items-center gap-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/70 hover:text-foreground"
                onClick={openGuideManually}
                title={`How to use ${activeTool.label}`}
                aria-label={`How to use ${activeTool.label}`}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden h-8 w-8"
                onClick={() => changeTheme(NEXT_THEME[themePreference])}
                title={`Theme: ${themePreference} (tap to cycle)`}
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
        {isFullHeight ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* key on pathname re-triggers the entrance animation on each tool switch */}
            <div key={location.pathname} className="h-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out">
              {routes}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div
              key={location.pathname}
              className="mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:ease-out"
            >
              {routes}
            </div>
          </div>
        )}
      </main>

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
              <MeetingsProvider>
                <Router>
                  <AppContent />
                  <UpdateDialog />
                  <OnboardingFlow />
                  <CommandPalette />
                </Router>
              </MeetingsProvider>
            </UpdateProvider>
          </OnboardingProvider>
        </FeatureProvider>
      </LocaleProvider>
    </AppConfigProvider>
  );
}

export default App;
