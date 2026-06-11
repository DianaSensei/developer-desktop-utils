import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Clock,
  Code,
  Hash,
  Calendar,
  FileJson,
  Shield,
  Search,
  Link as LinkIcon,
  Key,
  GitCompare,
  QrCode,
  FileText,
  Filter,
  Menu,
  X,
  Moon,
  Sun,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  Type,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeatureProvider, useFeatures } from '@/contexts/FeatureContext';

import { CronGenerator } from '@/components/tools/CronGenerator';
import { TextTransformer } from '@/components/tools/TextTransformer';
import { Base64Tool } from '@/components/tools/Base64Tool';
import { HashTool } from '@/components/tools/HashTool';
import { UnixTimeConverter } from '@/components/tools/UnixTimeConverter';
import { JsonFormatter } from '@/components/tools/JsonFormatter';
import { JwtDebugger } from '@/components/tools/JwtDebugger';
import { RegexTester } from '@/components/tools/RegexTester';
import { UrlTool } from '@/components/tools/UrlTool';
import { UuidGenerator } from '@/components/tools/UuidGenerator';
import { TextDiff } from '@/components/tools/TextDiff';
import { QRCodeTool } from '@/components/tools/QRCodeTool';
import { MarkdownPreview } from '@/components/tools/MarkdownPreview';
import { ArrayDeduplicator } from '@/components/tools/ArrayDeduplicator';
import { TextCounter } from '@/components/tools/TextCounter';
import { ColorPicker } from '@/components/tools/ColorPicker';
import { Settings } from '@/components/Settings';

const allTools = [
  { path: '/', label: 'Cron Generator', icon: Calendar, component: CronGenerator, featureId: 'cron-generator' },
  { path: '/text-transform', label: 'Text Transformer', icon: Code, component: TextTransformer, featureId: 'text-transform' },
  { path: '/text-counter', label: 'Text Counter', icon: Type, component: TextCounter, featureId: 'text-counter' },
  { path: '/color-picker', label: 'Color Picker', icon: Palette, component: ColorPicker, featureId: 'color-picker' },
  { path: '/base64', label: 'Base64', icon: Code, component: Base64Tool, featureId: 'base64' },
  { path: '/hash', label: 'Hash & Encrypt', icon: Hash, component: HashTool, featureId: 'hash' },
  { path: '/unix-time', label: 'Unix Time', icon: Clock, component: UnixTimeConverter, featureId: 'unix-time' },
  { path: '/json', label: 'JSON Formatter', icon: FileJson, component: JsonFormatter, featureId: 'json' },
  { path: '/jwt', label: 'JWT Debugger', icon: Shield, component: JwtDebugger, featureId: 'jwt' },
  { path: '/regex', label: 'Regex Tester', icon: Search, component: RegexTester, featureId: 'regex' },
  { path: '/url', label: 'URL Encode', icon: LinkIcon, component: UrlTool, featureId: 'url' },
  { path: '/uuid', label: 'UUID Generator', icon: Key, component: UuidGenerator, featureId: 'uuid' },
  { path: '/diff', label: 'Text Diff', icon: GitCompare, component: TextDiff, featureId: 'diff' },
  { path: '/qrcode', label: 'QR Code', icon: QrCode, component: QRCodeTool, featureId: 'qrcode' },
  { path: '/markdown', label: 'Markdown', icon: FileText, component: MarkdownPreview, featureId: 'markdown' },
  { path: '/deduplicate', label: 'Deduplicate', icon: Filter, component: ArrayDeduplicator, featureId: 'deduplicate' },
  { path: '/settings', label: 'Settings', icon: SettingsIcon, component: Settings, featureId: 'settings' },
];

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
  const { isFeatureEnabled } = useFeatures();

  const enabledTools = allTools.filter((tool) => isFeatureEnabled(tool.featureId));

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-screen bg-card border-r transition-all duration-300 ease-in-out flex flex-col',
          isCollapsed ? 'w-16' : 'w-64',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className={cn('flex items-center border-b transition-all', isCollapsed ? 'justify-center py-3 px-2' : 'justify-between py-4 px-4')}>
          {!isCollapsed && <h1 className="text-xl font-bold">DevTool</h1>}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onToggleDark}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-1">
          <div className="space-y-0.5">
            {enabledTools.map((tool) => {
              const Icon = tool.icon;
              const isActive = location.pathname === tool.path;
              return (
                <Link
                  key={tool.path}
                  to={tool.path}
                  onClick={onClose}
                  title={isCollapsed ? tool.label : undefined}
                  className={cn(
                    'flex items-center rounded-md transition-all duration-150',
                    isCollapsed ? 'justify-center py-2.5 px-2' : 'gap-3 py-2 px-3',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                  {!isCollapsed && (
                    <span className={cn('text-sm transition-all whitespace-nowrap overflow-hidden', isActive && 'font-medium')}>
                      {tool.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className={cn('border-t py-2 px-1 hidden lg:block')}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className={cn('w-full h-8 text-xs', isCollapsed && 'px-0')}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5 mr-2" />
                <span className="text-muted-foreground">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}

function AppContent() {
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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isDark={isDark}
        onToggleDark={toggleDark}
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <h2 className="font-semibold">DevTool</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={toggleDark} title={isDark ? 'Light mode' : 'Dark mode'}>
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        <div className="w-full h-full p-4 md:p-6">
          <Routes>
            {allTools.map((tool) => (
              <Route key={tool.path} path={tool.path} element={<tool.component />} />
            ))}
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <FeatureProvider>
      <Router>
        <AppContent />
      </Router>
    </FeatureProvider>
  );
}

export default App;
