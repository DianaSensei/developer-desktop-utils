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
} from 'lucide-react';
import { Button } from '@/components/ui/button';

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

const tools = [
  { path: '/', label: 'Cron Generator', icon: Calendar, component: CronGenerator },
  { path: '/text-transform', label: 'Text Transformer', icon: Code, component: TextTransformer },
  { path: '/base64', label: 'Base64', icon: Code, component: Base64Tool },
  { path: '/hash', label: 'Hash & Encrypt', icon: Hash, component: HashTool },
  { path: '/unix-time', label: 'Unix Time', icon: Clock, component: UnixTimeConverter },
  { path: '/json', label: 'JSON Formatter', icon: FileJson, component: JsonFormatter },
  { path: '/jwt', label: 'JWT Debugger', icon: Shield, component: JwtDebugger },
  { path: '/regex', label: 'Regex Tester', icon: Search, component: RegexTester },
  { path: '/url', label: 'URL Encode', icon: LinkIcon, component: UrlTool },
  { path: '/uuid', label: 'UUID Generator', icon: Key, component: UuidGenerator },
  { path: '/diff', label: 'Text Diff', icon: GitCompare, component: TextDiff },
  { path: '/qrcode', label: 'QR Code', icon: QrCode, component: QRCodeTool },
  { path: '/markdown', label: 'Markdown', icon: FileText, component: MarkdownPreview },
  { path: '/deduplicate', label: 'Deduplicate', icon: Filter, component: ArrayDeduplicator },
];

function Sidebar({
  isOpen,
  onClose,
  isDark,
  onToggleDark
}: {
  isOpen: boolean;
  onClose: () => void;
  isDark: boolean;
  onToggleDark: () => void;
}) {
  const location = useLocation();

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-card border-r transition-transform duration-200 ease-in-out flex flex-col',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h1 className="text-2xl font-bold">DevTool</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleDark}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const isActive = location.pathname === tool.path;
              return (
                <Link
                  key={tool.path}
                  to={tool.path}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md scale-105'
                      : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  )}
                >
                  <Icon className={cn('transition-transform', isActive ? 'h-5 w-5 scale-110' : 'h-4 w-4')} />
                  <span className={cn('text-sm font-medium transition-all', isActive && 'font-bold')}>
                    {tool.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="p-4 border-t text-xs text-muted-foreground">
          <p>v0.1.0</p>
          <p>Developer Utilities</p>
        </div>
      </aside>
    </>
  );
}

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  const toggleDark = () => {
    setIsDark(!isDark);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} isDark={isDark} onToggleDark={toggleDark} />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 bg-background border-b lg:hidden">
          <div className="flex items-center justify-between p-4">
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
        <div className="container mx-auto p-6 max-w-6xl">
          <Routes>
            {tools.map((tool) => (
              <Route key={tool.path} path={tool.path} element={<tool.component />} />
            ))}
          </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
