import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TOOL_DEFS, TOOL_DEF_MAP, DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { Button } from '@/components/ui/button';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';
import { UpdateProvider, useUpdate } from '@/contexts/UpdateContext';
import { AppLogo } from '@/components/AppLogo';

import { CronGenerator } from '@/components/tools/CronGenerator';
import { TextTransformer } from '@/components/tools/TextTransformer';
import { Base64Tool } from '@/components/tools/Base64Tool';
import { HashTool } from '@/components/tools/HashTool';
import { UnixTimeConverter } from '@/components/tools/UnixTimeConverter';
import { JsonFormatter } from '@/components/tools/JsonFormatter';
import { JwtDebugger } from '@/components/tools/JwtDebugger';
import { RegexTester } from '@/components/tools/RegexTester';
import { ChecksumTool } from '@/components/tools/ChecksumTool';
import { ImageBase64Tool } from '@/components/tools/ImageBase64Tool';
import { GeneratorTool } from '@/components/tools/GeneratorTool';
import { TextDiff } from '@/components/tools/TextDiff';
import { QRCodeTool } from '@/components/tools/QRCodeTool';
import { MarkdownPreview } from '@/components/tools/MarkdownPreview';
import { ArrayDeduplicator } from '@/components/tools/ArrayDeduplicator';
import { TextCounter } from '@/components/tools/TextCounter';
import { ColorPicker } from '@/components/tools/ColorPicker';
import { Settings } from '@/components/Settings';
import { KafkaExplorer } from '@/components/tools/kafka/KafkaExplorer';
import { SqlFormatter } from '@/components/tools/SqlFormatter';

const TOOL_ROUTES: Record<string, { path: string; component: React.ComponentType; fullHeight?: boolean }> = {
  'cron-generator': { path: '/',              component: CronGenerator },
  'text-transform': { path: '/text-transform', component: TextTransformer, fullHeight: true },
  'text-counter':   { path: '/text-counter',   component: TextCounter },
  'color-picker':   { path: '/color-picker',   component: ColorPicker },
  'base64':         { path: '/base64',         component: Base64Tool },
  'hash':           { path: '/hash',           component: HashTool },
  'unix-time':      { path: '/unix-time',      component: UnixTimeConverter },
  'json':           { path: '/json',           component: JsonFormatter, fullHeight: true },
  'jwt':            { path: '/jwt',            component: JwtDebugger },
  'regex':          { path: '/regex',          component: RegexTester, fullHeight: true },
  'diff':           { path: '/diff',           component: TextDiff, fullHeight: true },
  'qrcode':         { path: '/qrcode',         component: QRCodeTool },
  'markdown':       { path: '/markdown',       component: MarkdownPreview, fullHeight: true },
  'deduplicate':    { path: '/deduplicate',    component: ArrayDeduplicator, fullHeight: true },
  'checksum':       { path: '/checksum',       component: ChecksumTool },
  'image-base64':   { path: '/image-base64',   component: ImageBase64Tool },
  'generator':      { path: '/generator',      component: GeneratorTool },
  'kafka-explorer':  { path: '/kafka-explorer',  component: KafkaExplorer,  fullHeight: true },
  'sql-formatter':   { path: '/sql-formatter',   component: SqlFormatter,  fullHeight: true },
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

function NavTooltip({ label, description, children }: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const handleEnter = () => {
    timer.current = setTimeout(() => {
      if (wrapRef.current) {
        const r = wrapRef.current.getBoundingClientRect();
        setCoords({ top: r.top + r.height / 2, left: r.right + 10 });
        setVisible(true);
      }
    }, 500);
  };

  const handleLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  };

  return (
    <div ref={wrapRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {children}
      {visible && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none -translate-y-1/2 w-52 rounded-md border bg-popover px-3 py-2.5 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ top: coords.top, left: coords.left }}
        >
          <p className="text-xs font-semibold text-popover-foreground leading-none">{label}</p>
          {description && (
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
          )}
        </div>,
        document.body
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

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-screen bg-sidebar backdrop-blur border-r transition-all duration-300 ease-in-out flex flex-col',
          isCollapsed ? 'w-14' : 'w-56',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className={cn(
          'flex shrink-0 items-center border-b',
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scrollable tool list with overflow fade */}
        {(() => {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          const navRef = useRef<HTMLElement>(null);
          // eslint-disable-next-line react-hooks/rules-of-hooks
          const [hasMore, setHasMore] = useState(false);

          const checkScroll = useCallback(() => {
            const el = navRef.current;
            if (!el) return;
            setHasMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
          }, []);

          // eslint-disable-next-line react-hooks/rules-of-hooks
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
                  <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">No tools match "{query}"</p>
                )}
                <div className="space-y-0.5">
                  {navTools.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = location.pathname === tool.path;
                    const desc = TOOL_DEF_MAP.get(tool.featureId)?.description ?? '';
                    return (
                      <NavTooltip key={tool.path} label={tool.label} description={desc}>
                        <Link
                          to={tool.path}
                          onClick={onClose}
                          className={cn(
                            'flex items-center rounded-md transition-all duration-150',
                            isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2',
                            isActive
                              ? 'bg-accent text-accent-foreground'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          )}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          {!isCollapsed && (
                            <span className={cn('flex-1 text-sm whitespace-nowrap overflow-hidden', isActive && 'font-medium')}>
                              {tool.label}
                            </span>
                          )}
                        </Link>
                      </NavTooltip>
                    );
                  })}
                </div>
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
        })()}

        {/* Pinned bottom bar — always visible, order: Collapse → Dark mode → Settings */}
        <div className="shrink-0 border-t px-1.5 py-2 space-y-0.5">
          {/* Collapse/expand — desktop only */}
          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'group relative hidden lg:flex w-full items-center rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted',
              isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'
            )}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronLeft className="h-4 w-4 shrink-0" />}
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </span>
            )}
            {!isCollapsed && <span className="text-sm whitespace-nowrap overflow-hidden">Collapse</span>}
          </button>

          {/* Dark / Light mode — icon reflects current mode */}
          <button
            onClick={onToggleDark}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={cn(
              'group relative flex w-full items-center rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted',
              isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2'
            )}
          >
            {isDark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              </span>
            )}
            {!isCollapsed && (
              <span className="text-sm whitespace-nowrap overflow-hidden">
                {isDark ? 'Light mode' : 'Dark mode'}
              </span>
            )}
          </button>

          {/* Settings — always last */}
          <Link
            to={settingsTool.path}
            onClick={onClose}
            title="Settings"
            className={cn(
              'group relative flex items-center rounded-md transition-colors',
              isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-2.5 py-2',
              isSettingsActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <span className="relative shrink-0">
              <SettingsIcon className="h-4 w-4" />
              {updateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-background" />
              )}
            </span>
            {isCollapsed && (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md group-hover:block">
                Settings
              </span>
            )}
            {!isCollapsed && (
              <span className={cn('text-sm whitespace-nowrap overflow-hidden', isSettingsActive && 'font-medium')}>
                Settings
              </span>
            )}
          </Link>
        </div>
      </aside>
    </>
  );
}

function AppContent() {
  const location = useLocation();
  const { isFeatureEnabled } = useFeatures();
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

  const toggleDark = () => {
    setIsDark(!isDark);
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const enabledTools = allTools.filter((tool) => isFeatureEnabled(tool.featureId));
  const activeTool = allTools.find((tool) => tool.path === location.pathname) ?? allTools[0];
  const ActiveIcon = activeTool.icon;
  const isFullHeight = !!(activeTool as typeof allTools[0] & { fullHeight?: boolean }).fullHeight;

  const routes = (
    <Routes>
      {enabledTools.map((tool) => (
        <Route key={tool.path} path={tool.path} element={<tool.component />} />
      ))}
      <Route path="/settings" element={<Settings />} />
    </Routes>
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
        <div className="z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75 shrink-0">
          <div className="flex items-center justify-between px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-card">
                <ActiveIcon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-none">{activeTool.label}</h2>
                <p className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
                  Offline utility - {enabledTools.filter(t => t.featureId !== 'settings').length} enabled
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={toggleDark} title={isDark ? 'Light mode' : 'Dark mode'}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {isFullHeight ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {routes}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-5">
              {routes}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <FeatureProvider>
      <UpdateProvider>
        <Router>
          <AppContent />
        </Router>
      </UpdateProvider>
    </FeatureProvider>
  );
}

export default App;
