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
  FlaskConical,
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
import { ExperimentalGate } from '@/components/ExperimentalGate';
import { ExperimentalDot, ExperimentalMark } from '@/components/ExperimentalBadge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';
import type { TranslationKey } from '@/lib/i18n';
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
import { isTauri, IS_MAC } from '@/lib/platform';

/** `titleBarStyle: "Overlay"` (tauri.conf.json) chỉ có tác dụng trên macOS —
 *  Windows/Linux giữ nguyên titlebar hệ thống, `decorations` không đổi. Chỉ
 *  khi cả hai đúng thì cửa sổ mới thật sự không còn thanh tiêu đề riêng và
 *  cần chừa chỗ cho ba nút đèn giao thông + vùng kéo cửa sổ. */
const showMacOverlayChrome = isTauri && IS_MAC;
/** Windows/Linux: `tauri.windows.conf.json` / `tauri.linux.conf.json` tắt hẳn
 *  `decorations` (không có API "overlay giữ nút gốc" như macOS) — nên app tự
 *  vẽ thanh titlebar, kéo cửa sổ, và ba nút minimize/maximize/close. Gộp cả
 *  hai OS vào MỘT kiểu chrome trung tính (không cố bắt chước Fluent Windows
 *  11 lẫn GNOME/KDE riêng biệt — không có máy thật để nhắm cho đúng từng
 *  hệ) thay vì hai style khác nhau khó bảo trì và không kiểm chứng được. */
const showCustomChrome = isTauri && !IS_MAC;
/** Header tool (icon + tablist) đã chuyển hẳn lên titlebar ở CẢ hai kiểu
 *  chrome tự vẽ — dùng để ẩn header gốc trong <main> một lần, không lặp lại
 *  logic ở nhiều chỗ. */
const showMergedTitlebar = showMacOverlayChrome || showCustomChrome;

type TauriResizeDirection = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

/** `@tauri-apps/api/window` chỉ tồn tại trong runtime Tauri thật — import
 *  động để không kéo nó vào bundle web/dev-browser (mọi lệnh dưới đây chỉ gọi
 *  từ nút/hit-zone chỉ render khi `showCustomChrome`, nhưng import tĩnh vẫn
 *  sẽ cố resolve module ngay cả khi nhánh đó không chạy). */
async function tauriWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}
const winMinimize = () => { tauriWindow().then((w) => w.minimize()); };
const winToggleMaximize = () => { tauriWindow().then((w) => w.toggleMaximize()); };
const winClose = () => { tauriWindow().then((w) => w.close()); };
const winStartResize = (dir: TauriResizeDirection) => { tauriWindow().then((w) => w.startResizeDragging(dir)); };

/** `decorations:false` (Windows/Linux) xoá luôn viền kéo-giãn của hệ điều
 *  hành — không tự thêm lại thì cửa sổ chỉ resize được bằng cách kéo... không
 *  cách nào cả. Tám vùng mỏng (4 cạnh + 4 góc) phủ mép cửa sổ, gọi
 *  `startResizeDragging` đúng hướng lúc mousedown — cùng cơ chế native, không
 *  phải tự tính toán kích thước bằng tay. */
function ResizeHandles() {
  const T = 6; // độ dày vùng cạnh, px
  const C = 12; // độ dài cạnh vùng góc, px
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
      {edge('North', { top: 0, left: C, right: C, height: T, cursor: 'ns-resize' })}
      {edge('South', { bottom: 0, left: C, right: C, height: T, cursor: 'ns-resize' })}
      {edge('West', { top: C, bottom: C, left: 0, width: T, cursor: 'ew-resize' })}
      {edge('East', { top: C, bottom: C, right: 0, width: T, cursor: 'ew-resize' })}
      {edge('NorthWest', { top: 0, left: 0, width: C, height: C, cursor: 'nwse-resize' })}
      {edge('NorthEast', { top: 0, right: 0, width: C, height: C, cursor: 'nesw-resize' })}
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
            // Bấm vào nhóm là vào tool đầu tiên; nhóm sáng lên khi ĐANG ở bất kỳ
            // thành viên nào, nếu không mở Deduplicate sẽ thấy sidebar không
            // sáng chỗ nào.
            const memberPaths = entry.tools.map((t) => toolPath(t.id));
            const path = memberPaths[0];
            const isActive = memberPaths.includes(location.pathname);
            const isLive = entry.tools.some((t) => liveIds.includes(t.id));
            const isExperimental = entry.tools.some((t) => t.experimental);
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
                      'group relative flex w-full items-center rounded-sm px-2.5 py-2.5 transition-[color,background-color,box-shadow] duration-base ease-out-soft',
                      isCollapsed ? 'justify-center' : 'gap-2.5',
                      isActive
                        ? 'bg-acc-tint text-acc-ink font-medium'
                        : 'text-fg-mute hover:text-fg hover:bg-fg/[0.05]'
                    )}
                  >
                    <span className="relative shrink-0">
                      <Icon className="h-4 w-4" />
                      {isLive && (
                        // "Đang kết nối" là TRẠNG THÁI → xanh lá cố định, không
                        // theo accent. Xem design/RULES.md.
                        <span
                          className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-ok ring-2 ring-[hsl(var(--chrome-c))]"
                          title={t('shell.sidebar.connected')}
                        />
                      )}
                      {isExperimental && isCollapsed && (
                        <ExperimentalDot title={t('shell.experimental.badge')} />
                      )}
                    </span>
                    {/* Label is always mounted and fades/collapses with the sidebar
                        (300ms, matching the aside width animation) so it glides
                        rather than popping in/out on collapse-expand.

                        `inline-flex` + `min-w-0` on both this row and the label
                        text below (not just `overflow-hidden` on one shared span)
                        so a long label truncates with an ellipsis while the group
                        count / Experimental mark stay `shrink-0` and always render
                        in full — a long label ("Containers") + the old text badge
                        together used to exceed max-w-[160px] and squeeze the label
                        down to a sliver (no ellipsis), reading as the badge
                        covering the item instead of a trimmed label. Now that the
                        experimental flag is a bare glyph instead of a padded
                        uppercase badge, it stays out of the label's way. */}
                    <span
                      className={cn(
                        'inline-flex min-w-0 items-center text-sm transition-[max-width,opacity] duration-slow ease-out-soft motion-reduce:transition-none',
                        isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100',
                        isActive && 'font-medium'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      {/* Số tool trong nhóm — cho biết còn gì bên trong trước
                          khi bấm vào. */}
                      {entry.isGroup && (
                        <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-fg-mute/60">
                          {entry.tools.length}
                        </span>
                      )}
                      {isExperimental && !isCollapsed && <ExperimentalMark className="ml-1.5" />}
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
                    className="group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-fg-mute/70 transition-[color,background-color] duration-base ease-out-soft hover:text-fg hover:bg-fg/[0.05]"
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
          'fixed inset-0 bg-black/30 backdrop-blur-[1px] z-40 lg:hidden transition-opacity duration-slow ease-out-soft',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-full sidebar-chrome transition-[width,transform] duration-slow ease-out-soft flex flex-col',
          isCollapsed ? 'w-14' : 'w-56',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header — chỉ dựng ở đây khi KHÔNG có titlebar tự vẽ (macOS overlay
            HOẶC Windows/Linux decorations:false). Khi titlebar tự vẽ bật,
            logo/"DevTool" đã chuyển lên dải titlebar riêng ở AppContent (span
            toàn bộ cửa sổ, đứng NGOÀI sidebar) — vì hàng đó giờ chia sẻ chỗ
            với đèn giao thông/nút Close (mac) hoặc minimize/maximize/close tự
            vẽ (win/linux), nó phải đứng yên một chỗ, không co giãn theo
            isCollapsed nữa. Để nó bên trong `<aside>` (đổi rộng theo collapse)
            là sai chỗ: logo sẽ nhảy vị trí mỗi lần thu gọn/mở rộng dù về mặt
            hình ảnh nó là một phần của titlebar, không phải một phần của danh
            sách tool. Xem khối titlebar trong AppContent. */}
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
            <Button variant="ghost" size="icon" className="h-ctl w-ctl shrink-0 lg:hidden" onClick={onClose} title={t('shell.sidebar.closeMenu')}>
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
              className="flex items-center justify-center h-ctl w-ctl rounded-md text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
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
                className="h-ctl pl-7 pr-7 text-xs rounded-md bg-bg-2/40 border-bg-2"
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
          {/* Collapse/expand — desktop only. Tooltip only matters collapsed
              (expanded already shows the "Collapse" label inline) — bản trước
              tự chế bằng group-hover:block, không xử lý được bàn phím hay
              tràn viewport (xem design/RULES.md). Dùng chung `Tooltip` như
              các dòng nav bên trên. */}
          <Tooltip side="right" label={isCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')} disabled={!isCollapsed} triggerClassName="block w-full">
            <button
              onClick={onToggleCollapse}
              title={isCollapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
              className={cn(
                'group relative hidden lg:flex w-full items-center rounded-lg px-2.5 py-2.5 transition-colors text-fg-mute hover:text-fg hover:bg-bg-2/60',
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
                'group relative flex w-full items-center rounded-lg px-2.5 py-2.5 transition-colors text-fg-mute hover:text-fg hover:bg-bg-2/60',
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
                'group relative flex items-center rounded-lg px-2.5 py-2.5 transition-[color,background-color,box-shadow] duration-base ease-out-soft',
                isCollapsed ? 'justify-center' : 'gap-2.5',
                isSettingsActive
                  ? 'bg-acc/10 text-acc font-medium'
                  : 'text-fg-mute hover:text-fg hover:bg-fg/[0.05]'
              )}
            >
              <span className="relative shrink-0">
                <SettingsIcon className="h-4 w-4 transition-transform duration-base ease-out-soft motion-safe:group-hover:scale-110" />
                {updateAvailable && (
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
  const { isFeatureEnabled, toolOrder } = useFeatures();
  const liveIds = useLiveConnections();
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
  // Nút maximize/restore của titlebar tự vẽ (Windows/Linux) phải đổi ICON theo
  // đúng trạng thái cửa sổ — Windows thật đổi từ ô vuông đơn (□) sang hai ô
  // chồng nhau (⧉) khi đã maximize. Không theo dõi việc này thì nút luôn hiện
  // sai một trong hai trạng thái, lộ ngay ra là chrome tự vẽ chứ không phải hệ
  // điều hành thật.
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
  // Đích rơi về khi URL hiện tại không khớp route nào — xem <Route path="*">
  // bên dưới. Theo đúng thứ tự sidebar để "màn hình đầu tiên" của app là tool
  // người dùng đã kéo lên trên cùng, không phải tool đầu bảng cứng.
  const fallbackPath =
    applySavedOrder(enabledTools, toolOrder).find((t) => t.featureId !== 'settings')?.path
    ?? '/settings';
  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const ActiveIcon = activeTool.icon;
  // Tool đang mở có nằm trong nhóm nhiều tool không? Nếu có, header hiện tên
  // NHÓM cùng tab con thay vì tên tool — để người dùng thấy được các tool anh em
  // mà không phải quay lại sidebar.
  const activeGroup = GROUP_OF_TOOL.get(activeTool.featureId);
  const activeGroupTabs = (activeGroup?.toolIds ?? [])
    .filter((id) => isFeatureEnabled(id))
    .map((id) => TOOL_DEF_MAP.get(id))
    .filter((def): def is NonNullable<typeof def> => !!def);
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
          {/* Không có route nào khớp → về tool đầu tiên đang bật, không để
              trống. Trường hợp thật hay gặp: '/' thuộc về Cron Generator, tắt
              tool đó trong Settings rồi mở lại app là rơi thẳng vào một vùng
              nội dung trắng trơn (header vẫn vẽ tên tool đã tắt). `replace` để
              URL hỏng không nằm lại trong lịch sử điều hướng. */}
          <Route path="*" element={<Navigate to={fallbackPath} replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );

  // Phần logo/DevTool + icon/tablist tool đang mở — CHUNG cho cả hai kiểu
  // titlebar tự vẽ (macOS overlay và Windows/Linux decorations:false), chỉ
  // khác nhau ở phần chrome bao quanh (chừa chỗ đèn giao thông vs nút tự vẽ).
  // Viết một lần, gọi ở cả hai chỗ — tránh lặp ~70 dòng JSX dễ trôi lệch.
  const titlebarNav = (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <AppLogo size={18} />
        <h1 className="whitespace-nowrap text-xs font-semibold leading-none">DevTool</h1>
      </div>
      <span className="h-4 w-px shrink-0 bg-line" />
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 lg:hidden" onClick={() => setSidebarOpen(true)} title={t('shell.titlebar.openMenu')}>
        <Menu className="h-3.5 w-3.5" />
      </Button>
      {/* No live dot here: this icon sits outside the switch-tool tablist
          below (it's a single fixed badge, not one of the clickable tabs),
          and the selected tab already carries its own live dot — showing it
          twice for the same tool was redundant. */}
      <div
        key={activeTool.path}
        className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-acc/15 bg-acc/10 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-spring"
      >
        <ActiveIcon className="h-3.5 w-3.5 text-acc" />
      </div>
      {activeGroupTabs.length > 1 ? (
        <div
          key={`${activeTool.path}-tabs`}
          role="tablist"
          aria-label={activeGroup!.label}
          className="inline-flex h-6 shrink-0 items-center gap-1 overflow-x-auto rounded-md bg-sunk p-0.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft"
        >
          {activeGroupTabs.map((def) => {
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
                    'inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-xs leading-none transition-colors',
                    'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                    on
                      ? 'bg-acc font-semibold text-acc-fg shadow-soft'
                      : 'text-fg-mute hover:text-fg',
                  )}
                >
                  {/* Sibling tool tabs (Kafka/RabbitMQ/Redis…) can each be live
                      independently of which one is currently open — without
                      this dot, switching away from a connected tool hides any
                      sign it's still running until you click back into it.

                      The ring only shows on the SELECTED tab: that's the one
                      sitting on a full-strength `bg-acc` fill, where an
                      accent tone close to --ok's green hue can nearly swallow
                      the plain dot. `ring-acc-fg` is the same token the tab
                      label's own text already leans on for contrast against
                      that fill, so the ring stays legible for every accent
                      color instead of just the ones far enough from green. */}
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
        <div
          key={`${activeTool.path}-label`}
          className="inline-flex h-6 shrink-0 items-center overflow-x-auto rounded-md bg-sunk p-0.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft"
        >
          <h2 className="inline-flex h-full min-w-0 items-center gap-1 whitespace-nowrap rounded-sm bg-acc px-2 text-xs font-semibold leading-none text-acc-fg shadow-soft">
            {activeTool.label}
            {activeTool.experimental && (
              <span title={t('shell.experimental.badge')} className="inline-flex shrink-0">
                <FlaskConical className="h-3 w-3 opacity-80" />
              </span>
            )}
          </h2>
        </div>
      )}
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
      {showCustomChrome && <ResizeHandles />}
      {/* Titlebar riêng — chỉ khi macOS overlay thật sự có hiệu lực. Logo/
          "DevTool" từng sống TRONG header của sidebar, đổi vị trí theo
          isCollapsed (co giãn cùng bề rộng sidebar). Từ khi hàng đó chia sẻ
          chỗ với ba nút đèn giao thông + nút Close, nó không còn là một phần
          của "danh sách tool có thể thu gọn" nữa — nó là titlebar, phải đứng
          YÊN một chỗ bất kể sidebar đang mở hay gọn. Nên kéo hẳn ra khỏi
          `<aside>`, đặt ở đây — span toàn bộ cửa sổ, KHÔNG phụ thuộc
          isCollapsed. `data-tauri-drag-region="deep"` — lan xuống nhánh con
          nhưng vẫn chừa nút Close bấm được bình thường.

          `trafficLightPosition: {x:12,y:20}` trong tauri.conf.json TỰ đặt vị
          trí ba nút đèn giao thông (yêu cầu titleBarStyle: "Overlay" +
          decorations mặc định true) — không còn phải đoán theo phiên bản
          macOS như trước. `pl-[…px]` ở đây là khoảng cách từ mép trái tới
          logo; x=12 + bề rộng cụm nút (~54px) mới chỉ đủ SÁT, không đủ
          THOÁNG — 78px ban đầu vẫn dính, tăng lên 96px. */}
      {showMacOverlayChrome && (
        <div
          className="flex h-[38px] shrink-0 items-center justify-between border-b border-line bg-chrome pl-[96px] pr-3"
          data-tauri-drag-region="deep"
        >
          {titlebarNav}
          {/* Vùng trống này ĐÃ kéo được cửa sổ nhờ "deep" trên container cha
              (click vào khoảng trống không con nào phủ tới thì target chính
              là container). Vẫn đặt data-tauri-drag-region="deep" lặp lại ở
              đây cho rõ ràng, tránh phải suy luận ngược khi đọc code — vùng
              kéo chính giữa hai cụm trái/phải, không lẫn với nút nào. */}
          <div className="flex-1" data-tauri-drag-region="deep" />
          <div className="flex shrink-0 items-center gap-1">
            {/* Slot for tool-specific header actions (filled via ToolHeaderActions portal) */}
            <div id="tool-header-actions" className="flex items-center gap-0.5" />
            {titlebarHelpAction}
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 lg:hidden" onClick={() => setSidebarOpen(false)} title={t('shell.sidebar.closeMenu')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
      {/* Windows/Linux — không có "overlay giữ nút gốc" như macOS, nên
          `decorations:false` (tauri.windows.conf.json / tauri.linux.conf.json)
          tắt hẳn titlebar hệ thống và app tự vẽ ba nút minimize/maximize/
          close ở BÊN PHẢI (đúng quy ước hai OS này, ngược macOS). Không cần
          chừa lề trái — không có đèn giao thông nào để né. */}
      {showCustomChrome && (
        <div
          className="flex h-[38px] shrink-0 items-center justify-between border-b border-line bg-chrome pl-3"
          data-tauri-drag-region="deep"
        >
          {titlebarNav}
          <div className="flex-1" data-tauri-drag-region="deep" />
          {/* Không pr-* ở đây — nút Close phải chạm THẲNG vào mép phải cửa sổ,
              y hệt Windows thật. Có padding thì vùng hover đỏ bị "đóng khung",
              trông như một khối nổi lên thay vì góc vuông sát viền. */}
          <div className="flex h-full shrink-0 items-center gap-0.5">
            <div id="tool-header-actions" className="flex items-center gap-0.5" />
            {titlebarHelpAction}
            <span className="mx-1 h-4 w-px shrink-0 bg-line" />
            {/* Ba nút caption Windows/Linux — cố tình LỆCH khỏi token app (accent/
                bad) và các hiệu ứng chuẩn của <Button> (bấm lún active:scale,
                viền focus accent, con trỏ pointer): đây là chrome của HỆ ĐIỀU
                HÀNH, không phải UI của app — macOS traffic light cũng không theo
                accent app vì cùng lý do. Bám đúng thông số Fluent của Windows
                11 để không lộ ra là hàng tự vẽ.

                h-full (không phải h-9 cố định) — hàng titlebar cao 38px, ba nút
                chạm sát mép trên/dưới titlebar, không có khoảng hở. Cũng tránh
                trùng ngưỡng mixedControlHeights (h-7/8/9) của guard.test.ts vì
                đây không phải control kích thước cố định như button thường. */}
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-10 shrink-0 cursor-default rounded-none text-fg/90 hover:bg-fg/10 hover:text-fg active:scale-100 active:bg-fg/15 focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={winMinimize}
              title={t('shell.titlebar.minimize')}
            >
              <Minus className="h-3 w-3" strokeWidth={1.5} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-10 shrink-0 cursor-default rounded-none text-fg/90 hover:bg-fg/10 hover:text-fg active:scale-100 active:bg-fg/15 focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={winToggleMaximize}
              title={isMaximized ? t('shell.titlebar.restore') : t('shell.titlebar.maximize')}
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
              title={t('shell.titlebar.close')}
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
        {/* Khi titlebar hợp nhất bật (macOS overlay HOẶC custom chrome trên
            Windows/Linux), icon/tablist/help của tool đã chuyển hẳn lên dải
            titlebar phía trên (span toàn cửa sổ) — không render lại ở đây,
            tránh trùng #tool-header-actions (portal target phải là DUY NHẤT
            trong DOM). */}
        {!showMergedTitlebar && (
        <div className="z-30 header-chrome shrink-0">
          {/* py-2 đưa tổng chiều cao về đúng 50px (2×8 + h-ctl 34) — khớp hàng
              header sidebar bên trái (2×10 + logo 30 = 50px), để đường viền
              dưới của cả hai nối thẳng thành một đường ngang liền mạch thay vì
              lệch bậc. py-2.5 trước đó ra 54px, lệch 4px so với sidebar. */}
          <div className="flex items-center justify-between px-4 py-2 sm:px-5">
            <div className="flex items-center gap-2.5">
              <Button variant="ghost" size="icon" className="lg:hidden h-ctl w-ctl" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              {/* Không chấm live ở đây: icon này nằm ngoài tablist switch-tool
                  bên cạnh (nó là badge cố định, không phải một tab bấm được),
                  và tab đang chọn trong tablist đã tự có chấm live của nó —
                  hiện hai chấm cho cùng một tool là thừa. */}
              <div
                key={activeTool.path}
                className="relative flex h-ctl w-ctl shrink-0 items-center justify-center rounded-lg border border-acc/15 bg-acc/10 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-spring"
              >
                <ActiveIcon className="h-4 w-4 text-acc" />
              </div>
              {/* Tên NHÓM ("Generate") không nói cái gì đang mở — tab con đã liệt
                  kê đúng thứ đó rồi ("Generator" đang bật). Giữ cả hai là lặp:
                  một chữ chung chung phía trước, một chữ cụ thể phía sau. Nên
                  bỏ hẳn <h2> tên nhóm, để tablist tự làm tiêu đề.

                  Tool đứng riêng (không thuộc nhóm, hoặc nhóm chỉ còn 1 tool
                  bật) vẫn dựng ĐÚNG khung máng lõm + pill này để header không
                  đổi hình dạng khi chuyển qua lại giữa tool đơn và tool trong
                  nhóm — chỉ khác là pill đó KHÔNG phải link/tab, vì không có gì
                  để chuyển tới. Không role="tablist"/"tab" trong trường hợp
                  này: hứa điều hướng bàn phím cho một mục duy nhất là hứa suông. */}
              {activeGroupTabs.length > 1 ? (
                <div
                  key={`${activeTool.path}-tabs`}
                  role="tablist"
                  aria-label={activeGroup!.label}
                  className="inline-flex h-ctl shrink-0 items-center gap-1 overflow-x-auto rounded-md bg-sunk p-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft"
                >
                  {activeGroupTabs.map((def) => {
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
                            'inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-sm px-3.5 text-sm leading-none transition-colors',
                            'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
                            on
                              ? 'bg-acc font-semibold text-acc-fg shadow-soft'
                              : 'text-fg-mute hover:text-fg',
                          )}
                        >
                          {/* Xem chú thích ở khối titlebarNav phía trên — cùng lý
                              do: tab anh em (Kafka/RabbitMQ/Redis…) có thể đang
                              live độc lập với tab đang mở, và cùng cách sửa:
                              viền ring-acc-fg chỉ khi được chọn, để chấm không
                              chìm vào nền bg-acc khi accent ngả sắc xanh lá. */}
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
                <div
                  key={`${activeTool.path}-label`}
                  className="inline-flex h-ctl shrink-0 items-center overflow-x-auto rounded-md bg-sunk p-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft"
                >
                  <h2 className="inline-flex h-full min-w-0 items-center gap-1 whitespace-nowrap rounded-sm bg-acc px-3.5 text-sm font-semibold leading-none text-acc-fg shadow-soft sm:text-base">
                    {activeTool.label}
                    {activeTool.experimental && (
                      <span title={t('shell.experimental.badge')} className="inline-flex shrink-0">
                        <FlaskConical className="h-3.5 w-3.5 opacity-80" />
                      </span>
                    )}
                  </h2>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
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
                className="lg:hidden h-ctl w-ctl"
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
