import { useRef, useCallback, useState, useEffect } from 'react';
import { useFeatures } from '@/contexts/FeatureContext';
import { cn } from '@/lib/utils';
import {
  RotateCcw, GripVertical, X, Search, CheckCheck,
  RefreshCw, Download, CheckCircle2, AlertCircle, Loader2,
  Clipboard, FolderOpen, FolderClosed, Shield, Globe,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { TOOL_DEFS } from '@/lib/toolDefs';
import { useUpdate } from '@/contexts/UpdateContext';
import { AppLogo } from '@/components/AppLogo';

function applySavedOrder<T extends { id: string }>(tools: T[], savedOrder: string[]): T[] {
  if (!savedOrder.length) return tools;
  const map = new Map(tools.map((t) => [t.id, t]));
  const ordered: T[] = [];
  for (const id of savedOrder) {
    const t = map.get(id);
    if (t) ordered.push(t);
  }
  for (const t of tools) {
    if (!savedOrder.includes(t.id)) ordered.push(t);
  }
  return ordered;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        checked ? 'bg-primary' : 'bg-muted-foreground/25'
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      )} />
    </button>
  );
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
    </svg>
  );
}

const APP_PERMISSIONS = [
  {
    Icon: Clipboard,
    name: 'Clipboard',
    description: 'Read text you\'ve copied; write tool output directly to your clipboard.',
    scope: 'System clipboard only',
  },
  {
    Icon: FolderOpen,
    name: 'File System',
    description: 'Read and write files for tools like Checksum and Image ↔ Base64.',
    scope: 'AppData folder + app resources only',
  },
  {
    Icon: FolderClosed,
    name: 'File Dialogs',
    description: 'Open file picker and save dialogs so you can browse for files.',
    scope: 'Triggered by you only',
  },
  {
    Icon: Globe,
    name: 'Network',
    description: 'Connect to Kafka brokers you configure (Kafka Explorer) and check GitHub for app updates. No telemetry or analytics.',
    scope: 'Brokers you add + update check',
  },
];

export function Settings() {
  const { features, toggleFeature, resetToDefaults, toolOrder, reorderTools } = useFeatures();
  const { status: updateStatus, updateInfo, error: updateError, autoCheckEnabled, toggleAutoCheck, checkForUpdates, installUpdate } = useUpdate();
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setCurrentVersion).catch(() => {});
  }, []);

  const [displayTools, setDisplayTools] = useState(() => applySavedOrder(TOOL_DEFS, toolOrder));

  // keep in sync when toolOrder changes externally (e.g. reset)
  const prevOrderKey = useRef(toolOrder.join());
  const nextKey = toolOrder.join();
  if (prevOrderKey.current !== nextKey) {
    prevOrderKey.current = nextKey;
    setDisplayTools(applySavedOrder(TOOL_DEFS, toolOrder));
  }

  const [toolQuery, setToolQuery] = useState('');
  const enabledCount = displayTools.filter((t) => features[t.id] !== false).length;
  const allEnabled = TOOL_DEFS.every((t) => features[t.id] !== false);

  const enableAll = () => {
    TOOL_DEFS.forEach((t) => { if (features[t.id] === false) toggleFeature(t.id); });
  };

  const openExternal = useCallback(async (e: React.MouseEvent, url: string) => {
    if (!isTauri) return; // on web, let the anchor open a normal tab
    e.preventDefault();
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  }, []);
  const visibleTools = toolQuery.trim()
    ? displayTools.filter((t) =>
        t.label.toLowerCase().includes(toolQuery.trim().toLowerCase()) ||
        t.description.toLowerCase().includes(toolQuery.trim().toLowerCase())
      )
    : displayTools;
  const isSearching = toolQuery.trim().length > 0;

  const dragIndex = useRef<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    dragIndex.current = index;
  }, []);

  const handleDragEnter = useCallback((index: number) => {
    setDisplayTools((prev) => {
      if (dragIndex.current === null || dragIndex.current === index) return prev;
      const next = [...prev];
      const [moved] = next.splice(dragIndex.current, 1);
      next.splice(index, 0, moved);
      dragIndex.current = index;
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDisplayTools((prev) => {
      reorderTools(prev.map((t) => t.id));
      return prev;
    });
    dragIndex.current = null;
  }, [reorderTools]);

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-2">

      {/* Tools section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Tools</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {enabledCount} of {TOOL_DEFS.length} enabled · drag to reorder · hidden tools are removed from the sidebar
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!allEnabled && (
              <button
                onClick={enableAll}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <CheckCheck className="h-3 w-3" />
                Enable all
              </button>
            )}
            <button
              onClick={resetToDefaults}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            value={toolQuery}
            onChange={(e) => setToolQuery(e.target.value)}
            placeholder="Search tools…"
            className="pl-8 pr-8 h-8 text-xs bg-muted/40 border-muted focus-visible:ring-1"
          />
          {toolQuery && (
            <button
              onClick={() => setToolQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="rounded-lg border divide-y">
          {visibleTools.length === 0 && isSearching && (
            <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">No tools match "{toolQuery}"</p>
          )}
          {visibleTools.map((tool) => {
            const index = displayTools.indexOf(tool);
            const Icon = tool.icon;
            const enabled = features[tool.id] !== false;
            return (
              <div
                key={tool.id}
                draggable={!isSearching}
                onDragStart={!isSearching ? () => handleDragStart(index) : undefined}
                onDragEnter={!isSearching ? () => handleDragEnter(index) : undefined}
                onDragEnd={!isSearching ? handleDragEnd : undefined}
                onDragOver={!isSearching ? (e) => e.preventDefault() : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 transition-colors cursor-default',
                  !enabled && 'opacity-50'
                )}
              >
                {/* Drag handle — hidden while searching */}
                <GripVertical className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-opacity',
                  isSearching ? 'opacity-0 pointer-events-none' : 'cursor-grab active:cursor-grabbing'
                )} />
                <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-primary' : 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-none">{tool.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{tool.description}</p>
                </div>
                <Toggle checked={enabled} onChange={() => toggleFeature(tool.id)} />
              </div>
            );
          })}
        </div>
      </section>


      {/* Permissions section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">App Permissions</h2>
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          DevTool cannot access your files outside the listed scope. Network access is limited to Kafka brokers you configure and the app update check — no telemetry or analytics.
        </p>
        {!isTauri && (
          <p className="text-[11px] text-amber-500 dark:text-amber-400">
            Running in browser — permissions listed below apply to the desktop app only.
          </p>
        )}
        <div className="rounded-lg border divide-y">
          {APP_PERMISSIONS.map(({ Icon, name, description, scope }) => (
            <div key={name} className="flex items-start gap-3 px-4 py-3">
              <Icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs font-medium">{name}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
              </div>
              <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {scope}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* About section */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">About</h2>
        <div className="rounded-lg border divide-y text-xs">
          <div className="flex items-center gap-3 px-4 py-4">
            <AppLogo size={44} />
            <div>
              <p className="font-semibold text-sm leading-none">DevTool</p>
              <p className="text-muted-foreground mt-1 text-[11px]">Developer utilities for your desktop</p>
            </div>
          </div>
          {isTauri && (
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <div>
                <p className="font-medium">Auto-check for updates</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Check for new versions once a day</p>
              </div>
              <Toggle checked={autoCheckEnabled} onChange={toggleAutoCheck} />
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 text-xs">
            <span className="text-muted-foreground">Version</span>
            <div className="flex items-center gap-2">
              {updateStatus === 'not-available' && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Up to date
                </span>
              )}
              {updateStatus === 'available' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold">
                  v{updateInfo?.version} available
                </span>
              )}
              {updateStatus === 'error' && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {updateError ?? 'Update check failed'}
                </span>
              )}

              {isTauri && (
                updateStatus === 'available' ? (
                  <button
                    onClick={installUpdate}
                    className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[10px] font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Install
                  </button>
                ) : (updateStatus === 'checking' || updateStatus === 'downloading') ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {updateStatus === 'checking' ? 'Checking…' : 'Downloading…'}
                  </span>
                ) : (
                  <button
                    onClick={checkForUpdates}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Check
                  </button>
                )
              )}

              <span className="font-mono font-medium">{currentVersion || '…'}</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-muted-foreground">Contact, feedback &amp; contribute</span>
            <a
              href="https://github.com/DianaSensei/developer-desktop-utils/issues"
              target="_blank"
              rel="noopener noreferrer"
              title="Open GitHub issues"
              aria-label="Open GitHub issues"
              onClick={(e) => openExternal(e, 'https://github.com/DianaSensei/developer-desktop-utils/issues')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <GitHubIcon className="h-4 w-4" />
            </a>
          </div>
          <div className="px-4 py-3">
            <p className="text-muted-foreground leading-relaxed">
              Tools run entirely on your device. The only network activity is connecting to Kafka brokers you configure and the daily check for app updates — no telemetry, analytics, or other data leaves your machine.
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}
