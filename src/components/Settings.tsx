import { useRef, useCallback, useState, useEffect } from 'react';
import { useFeatures } from '@/contexts/FeatureContext';
import { cn } from '@/lib/utils';
import {
  RotateCcw, GripVertical, X, Search, CheckCheck, Ban,
  RefreshCw, Download, CheckCircle2, AlertCircle, Loader2, WifiOff, XCircle, ChevronDown,
  Clipboard, FolderOpen, FolderClosed, Shield, Globe, Sparkles,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { TOOL_DEFS } from '@/lib/toolDefs';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { CONFIG_FIELDS, SECTION_LABELS, type ConfigSection } from '@/config/appConfig';
import { useUpdate } from '@/contexts/UpdateContext';
import { AppLogo } from '@/components/AppLogo';

/** Format an hour (0–23) as a friendly 12-hour label, e.g. 6 → "6:00 AM". */
function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

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
    scope: 'System clipboard only',
    reasons: [
      { text: 'Read text you\'ve copied for quick paste', tool: 'All tools' },
      { text: 'Write tool output to your clipboard', tool: 'All tools' },
      { text: 'Read and write images for paste/copy', tool: 'Image ↔ Base64 · QR Code' },
    ],
  },
  {
    Icon: FolderOpen,
    name: 'File System',
    scope: 'AppData folder + app resources only',
    reasons: [
      { text: 'Read files to hash them', tool: 'Checksum' },
      { text: 'Read and convert image files', tool: 'Image ↔ Base64' },
      { text: 'Save broker configs to app data', tool: 'Kafka Explorer' },
    ],
  },
  {
    Icon: FolderClosed,
    name: 'File Dialogs',
    scope: 'Triggered by you only',
    reasons: [
      { text: 'Open file picker to browse for files', tool: 'Checksum, Image ↔ Base64' },
      { text: 'Save dialog to export generated files', tool: 'QR Code' },
      { text: 'Import / export Postman collections', tool: 'API Client' },
    ],
  },
  {
    Icon: Globe,
    name: 'Network',
    scope: 'Brokers you add + URLs you send to + a local HTTP listener you start + DNS/IP services you query + update check',
    reasons: [
      { text: 'Connect to Kafka brokers you configure', tool: 'Kafka Explorer' },
      { text: 'Send HTTP requests to URLs you enter', tool: 'API Client' },
      { text: 'Open a local HTTP listener on a port you choose (127.0.0.1, or 0.0.0.0 to expose on your LAN); responses can run sandboxed Rhai scripts with no file or network access', tool: 'Mock Server' },
      { text: 'Run DNS record, propagation & DNSSEC lookups', tool: 'Network Tools' },
      { text: 'Look up public IP & geolocation', tool: 'Network Tools' },
      { text: 'Read this machine\'s local network info', tool: 'Network Tools' },
      { text: 'Check GitHub for app updates', tool: 'Auto-update' },
    ],
  },
];

export function Settings() {
  const { features, toggleFeature, resetToDefaults, toolOrder, reorderTools } = useFeatures();
  const { status: updateStatus, updateInfo, updateAvailable, error: updateError, downloadProgress, autoCheckEnabled, checkHour, setCheckHour, toggleAutoCheck, checkForUpdates, installUpdate, cancelInstall, openUpdateDialog } = useUpdate();
  const { config, setField, resetConfig } = useAppConfig();
  const [configOpen, setConfigOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(true);
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
  const allDisabled = TOOL_DEFS.every((t) => features[t.id] === false);

  const enableAll = () => {
    TOOL_DEFS.forEach((t) => { if (features[t.id] === false) toggleFeature(t.id); });
  };

  const disableAll = () => {
    TOOL_DEFS.forEach((t) => { if (features[t.id] !== false) toggleFeature(t.id); });
  };

  const openExternal = useCallback(async (e: React.MouseEvent, url: string) => {
    if (!isTauri) return; // on web, let the anchor open a normal tab
    e.preventDefault();
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  }, []);
  const visibleTools = toolQuery.trim()
    ? displayTools.filter((t) => {
        const q = toolQuery.trim().toLowerCase();
        const haystack = [t.label, t.description, ...(t.keywords ?? [])].join(' ').toLowerCase();
        return q.split(/\s+/).every((term) => haystack.includes(term));
      })
    : displayTools;
  const isSearching = toolQuery.trim().length > 0;

  // --- Pointer-based drag reorder ---
  // The list stays static during a drag (no churn/flicker). The grabbed row lifts
  // and follows the cursor; an insertion line shows where it will land. The actual
  // reorder is committed once, on drop.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Live drag state: which row, how far it has moved vertically, and the target slot.
  const [drag, setDrag] = useState<{ id: string; dy: number; dropIndex: number } | null>(null);
  const dragMeta = useRef<{ id: string; startY: number; order: string[] } | null>(null);

  const startDrag = useCallback((id: string, e: React.PointerEvent) => {
    const order = displayTools.map((t) => t.id);
    const fromIndex = order.indexOf(id);
    dragMeta.current = { id, startY: e.clientY, order };
    setDrag({ id, dy: 0, dropIndex: fromIndex });

    const onMove = (ev: PointerEvent) => {
      const meta = dragMeta.current;
      if (!meta) return;
      // Count non-dragged rows whose midpoint sits above the pointer → insertion index.
      let dropIndex = 0;
      for (const rid of meta.order) {
        if (rid === meta.id) continue;
        const el = rowRefs.current.get(rid);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) dropIndex++;
      }
      setDrag({ id: meta.id, dy: ev.clientY - meta.startY, dropIndex });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const meta = dragMeta.current;
      setDrag((d) => {
        if (meta && d) {
          setDisplayTools((prev) => {
            const next = [...prev];
            const from = next.findIndex((t) => t.id === meta.id);
            if (from >= 0) {
              const [moved] = next.splice(from, 1);
              next.splice(d.dropIndex, 0, moved);
            }
            reorderTools(next.map((t) => t.id));
            return next;
          });
        }
        return null;
      });
      dragMeta.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [displayTools, reorderTools]);

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-2">

      {/* Tools section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Tools</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {enabledCount} of {TOOL_DEFS.length} enabled
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!allEnabled && (
              <button
                onClick={enableAll}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <CheckCheck className="h-3 w-3 shrink-0" />
                Enable all
              </button>
            )}
            {!allDisabled && (
              <button
                onClick={disableAll}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Ban className="h-3 w-3 shrink-0" />
                Disable all
              </button>
            )}
            <button
              onClick={resetToDefaults}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-3 w-3 shrink-0" />
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

        <div className="relative rounded-lg border divide-y">
          {visibleTools.length === 0 && isSearching && (
            <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">No tools match "{toolQuery}"</p>
          )}
          {(() => {
            const nodes: React.ReactNode[] = [];
            let slot = 0; // running index among non-dragged rows
            const line = (key: string) => (
              <div key={key} className="pointer-events-none mx-3 h-0.5 rounded-full bg-primary" />
            );
            visibleTools.forEach((tool) => {
              const Icon = tool.icon;
              const enabled = features[tool.id] !== false;
              const isDragging = drag?.id === tool.id;

              if (!isDragging) {
                if (drag && drag.dropIndex === slot) nodes.push(line(`line-${slot}`));
                slot++;
              }

              nodes.push(
                <div
                  key={tool.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(tool.id, el);
                    else rowRefs.current.delete(tool.id);
                  }}
                  style={isDragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 cursor-default bg-background',
                    !enabled && 'opacity-50',
                    isDragging && 'relative z-20 rounded-lg bg-muted opacity-100 shadow-lg ring-1 ring-primary/50'
                  )}
                >
                  {/* Drag handle — hidden while searching */}
                  <button
                    type="button"
                    aria-label="Drag to reorder"
                    onPointerDown={!isSearching ? (e) => { e.preventDefault(); startDrag(tool.id, e); } : undefined}
                    className={cn(
                      'shrink-0 touch-none text-muted-foreground/40 transition-colors',
                      isSearching ? 'opacity-0 pointer-events-none' : 'cursor-grab active:cursor-grabbing hover:text-muted-foreground'
                    )}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-none">{tool.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{tool.description}</p>
                  </div>
                  <Toggle checked={enabled} onChange={() => toggleFeature(tool.id)} />
                </div>
              );
            });
            if (drag && drag.dropIndex === slot) nodes.push(line('line-end'));
            return nodes;
          })()}
        </div>
      </section>


      {/* Permissions section */}
      <section className="space-y-3">
        <button
          onClick={() => setPermsOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-foreground/80"
          aria-expanded={permsOpen}
        >
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', !permsOpen && '-rotate-90')} />
          App Permissions
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {permsOpen && (
        <>
        <p className="text-[11px] text-muted-foreground -mt-1">
          DevTool cannot access your files outside the listed scope. Network access is limited to Kafka brokers you configure, DNS/IP lookups you run in Network Tools, and the app update check — no telemetry or analytics.
        </p>
        {!isTauri && (
          <p className="text-[11px] text-amber-500 dark:text-amber-400">
            Running in browser — permissions listed below apply to the desktop app only.
          </p>
        )}
        <div className="rounded-lg border divide-y">
          {APP_PERMISSIONS.map(({ Icon, name, reasons }) => (
            <div key={name} className="flex items-start gap-3 px-4 py-3">
              <Icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-xs font-medium">{name}</p>
                <ul className="space-y-1">
                  {reasons.map((r) => (
                    <li key={r.text} className="flex items-baseline gap-2 text-[11px] text-muted-foreground leading-relaxed">
                      <span className="mt-px text-muted-foreground/40">•</span>
                      <span className="flex-1">{r.text}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/60">{r.tool}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        </>
        )}
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
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Check on launch and daily at {formatHour(checkHour)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {autoCheckEnabled && (
                  <Select value={String(checkHour)} onValueChange={(v) => setCheckHour(Number(v))}>
                    <SelectTrigger className="h-8 w-28 text-xs rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)} className="text-xs">
                          {formatHour(h)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Toggle checked={autoCheckEnabled} onChange={toggleAutoCheck} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 text-xs">
            <span className="text-muted-foreground">Version</span>
            <div className="flex items-center gap-2">
              {updateStatus === 'not-available' && !updateAvailable && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Up to date
                </span>
              )}
              {updateAvailable && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold">
                  v{updateInfo?.version} available
                </span>
              )}
              {updateStatus === 'error' && (
                updateError?.startsWith('Offline') ? (
                  <span
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                    title={updateError}
                  >
                    <WifiOff className="h-3 w-3 shrink-0" />
                    Offline
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {updateError ?? 'Update check failed'}
                  </span>
                )
              )}

              {isTauri && (
                updateStatus === 'downloading' ? (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Downloading…
                    {downloadProgress != null && (
                      <>
                        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-muted">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-150"
                            style={{ width: `${downloadProgress}%` }}
                          />
                        </span>
                        <span className="tabular-nums">{downloadProgress}%</span>
                      </>
                    )}
                    <button
                      onClick={cancelInstall}
                      title="Cancel download"
                      aria-label="Cancel download"
                      className="ml-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                ) : updateStatus === 'checking' ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking…
                  </span>
                ) : updateAvailable ? (
                  <>
                    <button
                      onClick={openUpdateDialog}
                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Sparkles className="h-3 w-3" />
                      What's new
                    </button>
                    <button
                      onClick={installUpdate}
                      className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-2 py-1 text-[10px] font-medium hover:bg-primary/90 transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      Install
                    </button>
                  </>
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
              Everything runs on your device. Network access only happens when you ask for it, plus the daily check for app updates — no telemetry, analytics, or other data leaves your machine.
            </p>
          </div>
        </div>
      </section>

      {/* Configuration section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setConfigOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-foreground/80"
            aria-expanded={configOpen}
          >
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', !configOpen && '-rotate-90')} />
            Configuration
          </button>
          {configOpen && (
            <button
              onClick={resetConfig}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
        {configOpen && (
        <>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Tunable app behavior. Changes are saved locally and applied immediately.
        </p>
        {(Object.keys(SECTION_LABELS) as ConfigSection[]).map((sec) => {
          const fields = CONFIG_FIELDS.filter((f) => f.section === sec);
          if (!fields.length) return null;
          return (
            <div key={sec} className="rounded-lg border divide-y">
              <div className="bg-muted/10 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {SECTION_LABELS[sec]}
              </div>
              {fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{f.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{f.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Input
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={f.step ?? 1}
                      value={(config[f.section] as Record<string, number>)[f.key]}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== '') setField(f, Number(v));
                      }}
                      className="h-8 w-24 text-center text-xs rounded-lg"
                    />
                    {f.unit && <span className="w-5 text-[11px] text-muted-foreground">{f.unit}</span>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        </>
        )}
      </section>

    </div>
  );
}
