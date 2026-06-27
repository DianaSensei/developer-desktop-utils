import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useLayoutEffect, lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';
import {
  Menu,
  X,
  Moon,
  Sun,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  Loader2,
  HelpCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDesktopChrome } from '@/hooks/useDesktopChrome';
import { TOOL_DEFS, TOOL_DEF_MAP, DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';
import { UpdateProvider, useUpdate } from '@/contexts/UpdateContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { MeetingsProvider } from '@/lib/meetings';
import { UpdateDialog } from '@/components/UpdateDialog';
import { ToolGuideModal } from '@/components/ToolGuideModal';
import { AppLogo } from '@/components/AppLogo';

// Tools are code-split: each loads its own chunk on first navigation instead of
// being bundled into the initial payload. This keeps app startup fast and avoids
// parsing heavy libs (CodeMirror, jsQR, qrcode, react-markdown) until needed.
const named = <T,>(p: Promise<Record<string, T>>, key: string) =>
  p.then((m) => ({ default: (m as Record<string, React.ComponentType>)[key] }));

const CronGenerator = lazy(() => named(import('@/components/tools/CronGenerator'), 'CronGenerator'));
const TextTransformer = lazy(() => named(import('@/components/tools/TextTransformer'), 'TextTransformer'));
const EncodeHashEncrypt = lazy(() => named(import('@/components/tools/EncodeHashEncrypt'), 'EncodeHashEncrypt'));
const DateTimeTool = lazy(() => named(import('@/components/tools/DateTimeTool'), 'DateTimeTool'));
const JsonFormatter = lazy(() => named(import('@/components/tools/JsonFormatter'), 'JsonFormatter'));
const DataConverter = lazy(() => named(import('@/components/tools/DataConverter'), 'DataConverter'));
const JwtDebugger = lazy(() => named(import('@/components/tools/JwtDebugger'), 'JwtDebugger'));
const RegexTester = lazy(() => named(import('@/components/tools/RegexTester'), 'RegexTester'));
const RandomGenerator = lazy(() => named(import('@/components/tools/RandomGenerator'), 'RandomGenerator'));
const TextDiff = lazy(() => named(import('@/components/tools/TextDiff'), 'TextDiff'));
const QRCodeTool = lazy(() => named(import('@/components/tools/QRCodeTool'), 'QRCodeTool'));
const MarkdownPreview = lazy(() => named(import('@/components/tools/MarkdownPreview'), 'MarkdownPreview'));
const ArrayDeduplicator = lazy(() => named(import('@/components/tools/ArrayDeduplicator'), 'ArrayDeduplicator'));
const TextCounter = lazy(() => named(import('@/components/tools/TextCounter'), 'TextCounter'));
const ColorPicker = lazy(() => named(import('@/components/tools/ColorPicker'), 'ColorPicker'));
const Settings = lazy(() => named(import('@/components/Settings'), 'Settings'));
const KafkaExplorer = lazy(() => named(import('@/components/tools/kafka/KafkaExplorer'), 'KafkaExplorer'));
const SqlFormatter = lazy(() => named(import('@/components/tools/SqlFormatter'), 'SqlFormatter'));
const TimeTracker = lazy(() => named(import('@/components/tools/clockify/Suite'), 'ClockifySuite'));
const NetworkTools = lazy(() => named(import('@/components/tools/NetworkTools'), 'NetworkTools'));
const LuckyWheel = lazy(() => named(import('@/components/tools/LuckyWheel'), 'LuckyWheel'));
const ApiClient = lazy(() => named(import('@/components/tools/apiclient/ApiClient'), 'ApiClient'));
const TwoFactorAuth = lazy(() => named(import('@/components/tools/TwoFactorAuth'), 'TwoFactorAuth'));
const MockServer = lazy(() => named(import('@/components/tools/mockserver/MockServer'), 'MockServer'));

const TOOL_ROUTES: Record<string, { path: string; component: React.ComponentType; fullHeight?: boolean }> = {
  'cron-generator': { path: '/',              component: CronGenerator,      fullHeight: true },
  'text-transform': { path: '/text-transform', component: TextTransformer,   fullHeight: true },
  'text-counter':   { path: '/text-counter',   component: TextCounter,       fullHeight: true },
  'color-picker':   { path: '/color-picker',   component: ColorPicker,       fullHeight: true },
  'base64':         { path: '/base64',         component: EncodeHashEncrypt, fullHeight: true },
  'unix-time':      { path: '/unix-time',      component: DateTimeTool,      fullHeight: true },
  'json':           { path: '/json',           component: JsonFormatter,     fullHeight: true },
  'data-converter': { path: '/data-converter', component: DataConverter,     fullHeight: true },
  'jwt':            { path: '/jwt',            component: JwtDebugger,       fullHeight: true },
  'regex':          { path: '/regex',          component: RegexTester,       fullHeight: true },
  'diff':           { path: '/diff',           component: TextDiff,          fullHeight: true },
  'qrcode':         { path: '/qrcode',         component: QRCodeTool,        fullHeight: true },
  'markdown':       { path: '/markdown',       component: MarkdownPreview,   fullHeight: true },
  'deduplicate':    { path: '/deduplicate',    component: ArrayDeduplicator, fullHeight: true },
  'generator':      { path: '/generator',      component: RandomGenerator,   fullHeight: true },
  'kafka-explorer': { path: '/kafka-explorer', component: KafkaExplorer,     fullHeight: true },
  'sql-formatter':  { path: '/sql-formatter',  component: SqlFormatter,      fullHeight: true },
  'task-tracker':   { path: '/task-tracker',   component: TimeTracker,       fullHeight: true },
  'network':        { path: '/network',        component: NetworkTools,      fullHeight: true },
  'lucky-wheel':    { path: '/lucky-wheel',    component: LuckyWheel,        fullHeight: true },
  'api-client':     { path: '/api-client',     component: ApiClient,         fullHeight: true },
  'mock-server':    { path: '/mock-server',    component: MockServer,        fullHeight: true },
  '2fa':            { path: '/2fa',            component: TwoFactorAuth,     fullHeight: true },
};

const allTools = [
  ...TOOL_DEFS.map((def) => ({
    featureId: def.id,
    label: def.label,
    icon: def.icon,
    description: def.description,
    ...TOOL_ROUTES[def.id],
  })),
  { featureId: 'settings', label: 'Settings', icon: SettingsIcon, description: '', path: '/settings', component: Settings },
];

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
function NavScrollArea({
  navTools,
  query,
  disabledMatches,
  settingsTool,
  onClose,
  isCollapsed,
  hiddenCount,
}: {
  navTools: SidebarTool[];
  query: string;
  disabledMatches: SidebarTool[];
  settingsTool: SidebarTool;
  onClose: () => void;
  isCollapsed: boolean;
  hiddenCount: number;
}) {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [hasMore, setHasMore] = useState(false);

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
  }, [checkScroll, navTools.length, query]);

  return (
    <div className="relative flex-1 min-h-0">
      <nav ref={navRef} className="h-full overflow-y-auto px-1.5 py-2">
        {navTools.length === 0 && query && (
          disabledMatches.length > 0 ? (
            <div className="px-2 py-4 text-center text-[11px] text-muted-foreground space-y-2">
              <p>
                <span className="font-medium text-foreground">{disabledMatches[0].label}</span> is turned off.
              </p>
              <Link
                to={settingsTool.path}
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-primary hover:bg-muted transition-colors"
              >
                <Plus className="h-3 w-3" /> Enable in Settings
              </Link>
            </div>
          ) : (
            <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">No tools match "{query}"</p>
          )
        )}
        <div className="space-y-0.5">
          {navTools.map((tool) => {
            const Icon = tool.icon;
            const isActive = location.pathname === tool.path;
            const desc = TOOL_DEF_MAP.get(tool.featureId)?.description ?? '';
            return (
              <Tooltip key={tool.path} side="right" triggerClassName="block" label={tool.label} description={desc}>
                <Link
                  to={tool.path}
                  onClick={onClose}
                  className={cn(
                    'group relative flex w-full items-center rounded-lg px-2.5 py-2.5 transition-[color,background-color,box-shadow,transform] duration-200 ease-out motion-safe:active:scale-[0.98]',
                    isCollapsed ? 'justify-center' : 'gap-2.5',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover:scale-110" />
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
                    {tool.label}
                  </span>
                </Link>
              </Tooltip>
            );
          })}
        </div>

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
                isCollapsed ? 'py-1.5' : 'px-2.5 py-1.5 text-[10px]'
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

function Sidebar({
  isOpen,
  onClose,
  isDark,
  onToggleDark,
  isCollapsed,
  onToggleCollapse,
}: {
  isOpen: boolean;
  onClose: () => void;
  isDark: boolean;
  onToggleDark: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const location = useLocation();
  const { isFeatureEnabled, toolOrder } = useFeatures();
  const { updateAvailable } = useUpdate();
  const [query, setQuery] = useState('');
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
  const navTools = query.trim()
    ? allNavTools.filter((t) => t.label.toLowerCase().includes(query.trim().toLowerCase()))
    : allNavTools;
  const settingsTool = allTools.find((t) => t.featureId === 'settings')!;
  const isSettingsActive = location.pathname === settingsTool.path;

  // Tools the user has hidden — surfaced as a hint so they know more exist.
  const disabledTools = allTools.filter((t) => t.featureId !== 'settings' && !isFeatureEnabled(t.featureId));
  const hiddenCount = disabledTools.length;
  // When a search finds nothing enabled but matches a disabled tool, point the user to Settings.
  const disabledMatches = query.trim()
    ? disabledTools.filter((t) => t.label.toLowerCase().includes(query.trim().toLowerCase()))
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
                placeholder="Search tools…"
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
          navTools={navTools}
          query={query}
          disabledMatches={disabledMatches}
          settingsTool={settingsTool}
          onClose={onClose}
          isCollapsed={isCollapsed}
          hiddenCount={hiddenCount}
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

          {/* Dark / Light mode — icon reflects current mode */}
          <button
            onClick={onToggleDark}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={cn(
              'group relative flex w-full items-center rounded-lg px-2.5 py-2.5 transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/60',
              isCollapsed ? 'justify-center' : 'gap-2.5'
            )}
          >
            {isDark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              </span>
            )}
            <span
              className={cn(
                'text-sm whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out motion-reduce:transition-none',
                isCollapsed ? 'max-w-0 opacity-0' : 'max-w-[160px] opacity-100'
              )}
            >
              {isDark ? 'Light mode' : 'Dark mode'}
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
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-background" />
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
    const saved = localStorage.getItem('devtool-sidebar-collapsed');
    return saved === 'true';
  });
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('devtool-dark-mode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    localStorage.setItem('devtool-dark-mode', isDark.toString());
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem('devtool-sidebar-collapsed', isCollapsed.toString());
  }, [isCollapsed]);

  // Timer that clears the temporary `.theme-transition` class after a toggle.
  const themeTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (themeTransitionTimer.current) clearTimeout(themeTransitionTimer.current);
  }, []);

  const toggleDark = () => {
    // Animate the color swap, but only on an explicit user toggle and only when
    // the user hasn't asked for reduced motion. The class is removed once the
    // transition completes so it can never affect first paint or later interactions.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      const root = document.documentElement;
      root.classList.add('theme-transition');
      if (themeTransitionTimer.current) clearTimeout(themeTransitionTimer.current);
      themeTransitionTimer.current = setTimeout(() => {
        root.classList.remove('theme-transition');
      }, 260);
    }
    setIsDark((prev) => !prev);
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const enabledTools = allTools.filter((tool) => isFeatureEnabled(tool.featureId));
  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const ActiveIcon = activeTool.icon;
  const isFullHeight = !!(activeTool as typeof allTools[0] & { fullHeight?: boolean }).fullHeight;
  const [guideOpen, setGuideOpen] = useState(false);
  const showGuide = activeTool.featureId !== 'settings';

  const routes = (
    <Suspense fallback={<ToolLoading />}>
      <Routes>
        {enabledTools.map((tool) => (
          <Route key={tool.path} path={tool.path} element={<tool.component />} />
        ))}
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isDark={isDark}
        onToggleDark={toggleDark}
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
              <div key={`${activeTool.path}-label`} className="min-w-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1 motion-safe:duration-200">
                <h2 className="text-sm font-semibold leading-none text-foreground">{activeTool.label}</h2>
                {activeTool.description && (
                  <p className="mt-1 hidden max-w-xl truncate text-xs text-muted-foreground sm:block">
                    {activeTool.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* Slot for tool-specific header actions (filled via ToolHeaderActions portal) */}
              <div id="tool-header-actions" className="flex items-center gap-1" />
              {showGuide && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground/70 hover:text-foreground"
                  onClick={() => setGuideOpen(true)}
                  title={`How to use ${activeTool.label}`}
                  aria-label={`How to use ${activeTool.label}`}
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={toggleDark} title={isDark ? 'Light mode' : 'Dark mode'}>
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
        onOpenChange={setGuideOpen}
      />
    </div>
  );
}

function App() {
  return (
    <AppConfigProvider>
      <FeatureProvider>
        <UpdateProvider>
          <MeetingsProvider>
            <Router>
              <AppContent />
              <UpdateDialog />
            </Router>
          </MeetingsProvider>
        </UpdateProvider>
      </FeatureProvider>
    </AppConfigProvider>
  );
}

export default App;
