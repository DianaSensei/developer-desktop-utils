import { useRef, useCallback, useState, useEffect, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useFeatures } from '@/contexts/FeatureContext';
import { cn } from '@/lib/utils';
import {
  RotateCcw, GripVertical, X, Search, CheckCheck, Ban, Star,
  RefreshCw, Download, CheckCircle2, AlertCircle, WifiOff, XCircle,
  Clipboard, FolderOpen, FolderClosed, Shield, Globe, Sparkles, Compass,
  RotateCw, HardDrive, LayoutGrid, Cog, Languages, Palette, Type, Keyboard, SquareDashed,
} from 'lucide-react';
import { isTauri } from '@/lib/platform';
import { useLocale } from '@/contexts/LocaleContext';
import type { TranslationKey } from '@/lib/i18n';
import { Segmented } from '@/components/ui/segmented';
import { SettingRow, SettingGroup } from '@/components/ui/setting-row';
import {
  ACCENT_TONES, getAccentPreference, setAccentPreference,
  applyAccentToDocument, type AccentTone,
} from '@/lib/accentPreference';
import {
  CORNER_STYLES, getCornerPreference, setCornerPreference,
  applyCornerToDocument, type CornerStyle,
} from '@/lib/cornerPreference';
import {
  FONT_PREFERENCES, getFontPreference, setFontPreference,
  applyFontToDocument, type FontPreference,
} from '@/lib/fontPreference';
import {
  MONO_FONT_PREFERENCES, getMonoFontPreference, setMonoFontPreference,
  applyMonoFontToDocument, type MonoFontPreference,
} from '@/lib/monoFontPreference';
import { getAppPermissionGroups } from '@/lib/appPermissions';
import { SettingsPlugins } from '@/components/SettingsPlugins';
import { SettingsExtensions } from '@/components/SettingsExtensions';
import { getShortcutGroups } from '@/lib/shortcuts';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { TOOL_DEFS, type ToolDef } from '@/lib/toolDefs';
import { GROUP_OF_TOOL, clusterToolOrder } from '@/lib/toolGroups';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { CONFIG_FIELDS, SECTION_LABELS, type ConfigSection } from '@/config/appConfig';
import { useUpdate } from '@/contexts/UpdateContext';
import { useExtensionUpdates } from '@/contexts/ExtensionUpdateContext';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AppLogo } from '@/components/AppLogo';
import { ExperimentalBadge } from '@/components/ExperimentalBadge';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { useMcpToolEnabledMap, MCP_TOOL_IDS, MCP_TOOL_CAPABILITIES } from '@/hooks/useMcpToolEnabled';

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

/** Puts tools of the same group next to each other in the enable/disable
 *  list so they render under one parent row (see `clusterToolOrder`).
 *  Reapplied after every order change, so drag indices and render order
 *  both come from the same clustered list. */
function withGroupClustering(tools: ToolDef[]): ToolDef[] {
  const map = new Map(tools.map((t) => [t.id, t]));
  return clusterToolOrder(tools.map((t) => t.id)).map((id) => map.get(id)!);
}

interface LogicalRow {
  /** Row identity for drag/ref bookkeeping — a group id for a group row, the
   *  tool id for a standalone row (including a group degraded to one member). */
  key: string;
  isGroup: boolean;
  tools: ToolDef[];
}

/**
 * Turns a clustered tool list into "logical rows", the unit of drag and
 * drop: adjacent members of a group (2+) form one row; standalone tools, or
 * a group filtered down to one member, are their own row. Dragging a group
 * row moves the whole group; child order comes from `TOOL_GROUPS`.
 */
function toLogicalRows(tools: ToolDef[]): LogicalRow[] {
  const rows: LogicalRow[] = [];
  let i = 0;
  while (i < tools.length) {
    const group = GROUP_OF_TOOL.get(tools[i].id);
    if (!group) {
      rows.push({ key: tools[i].id, isGroup: false, tools: [tools[i]] });
      i++;
      continue;
    }
    const members: ToolDef[] = [];
    while (i < tools.length && GROUP_OF_TOOL.get(tools[i].id)?.id === group.id) {
      members.push(tools[i]);
      i++;
    }
    rows.push(members.length > 1
      ? { key: group.id, isGroup: true, tools: members }
      : { key: members[0].id, isGroup: false, tools: members });
  }
  return rows;
}

/** `label` is required: the switch has no visible text of its own, and
 *  the visible label sits beside it, so it needs an aria-label. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        checked ? 'bg-acc' : 'bg-fg-mute/25'
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      )} />
    </button>
  );
}

/** Icon + label/description + favourite + enable toggle — shared between a
 *  standalone tool row (draggable, has a grip) and a group's child row
 *  (not draggable, indented) so the two never drift apart visually. */
function ToolRowFields({ tool, enabled, favorite, onToggleFavorite, onToggleEnabled }: {
  tool: ToolDef; enabled: boolean; favorite: boolean;
  onToggleFavorite: () => void; onToggleEnabled: () => void;
}) {
  const { t } = useLocale();
  const Icon = tool.icon;
  return (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-acc' : 'text-fg-mute')} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-none flex items-center gap-1.5">
          {tool.label}
          {tool.experimental && <ExperimentalBadge />}
        </p>
        <p className="text-[11px] text-fg-mute mt-1 leading-relaxed">{tool.description}</p>
      </div>
      {/* Favourite — pins the tool to the top of the sidebar */}
      <button
        type="button"
        aria-label={favorite ? t('common.unfavoriteAria', { label: tool.label }) : t('common.favoriteAria', { label: tool.label })}
        title={favorite ? t('common.unfavorite') : t('common.favorite')}
        onClick={onToggleFavorite}
        className={cn(
          'shrink-0 rounded p-1 transition-colors',
          favorite ? 'text-warn' : 'text-fg-mute/40 hover:text-warn'
        )}
      >
        <Star className={cn('h-3.5 w-3.5', favorite && 'fill-current')} />
      </button>
      <Toggle
        checked={enabled}
        onChange={onToggleEnabled}
        label={enabled ? t('settings.tools.disableAria', { label: tool.label }) : t('settings.tools.enableAria', { label: tool.label })}
      />
    </>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-line bg-bg-2 px-1 py-0.5 font-mono text-[11px] text-fg">{children}</kbd>;
}

/**
 * Four accent swatches (a compact version of design/preview/index.html's
 * picker). Only `--a-h/--a-s/--a-l` change; derived accent colors follow via
 * CSS (design/tokens.css).
 */
function AccentSwatches({ value, onChange, ariaLabel }: { value: AccentTone; onChange: (tone: AccentTone) => void; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-1.5">
      {ACCENT_TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          title={tone}
          onClick={() => onChange(tone)}
          className={cn(
            'h-5 w-5 shrink-0 rounded-full border-2 transition-transform',
            'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
            value === tone ? 'scale-110 border-fg' : 'border-transparent hover:scale-105',
          )}
          style={ACCENT_PREVIEW[tone]}
        />
      ))}
    </div>
  );
}

// Each swatch needs its tone's real color, not the current `--a-h`.
// Values match the [data-accent] blocks in design/tokens.css.
const ACCENT_PREVIEW: Record<AccentTone, CSSProperties> = {
  azure: { background: 'hsl(218 76% 48%)' },
  teal: { background: 'hsl(196 65% 32%)' },
  iris: { background: 'hsl(258 62% 56%)' },
  amber: { background: 'hsl(34 78% 35%)' },
};

// t()'s key is a strict union (TranslationKey), so a template-literal key
// built from FontPreference at the call site wouldn't type-check — this map
// is the one place that connects the two.
const FONT_LABEL_KEY: Record<FontPreference, TranslationKey> = {
  default: 'settings.font.default',
  system: 'settings.font.system',
  serif: 'settings.font.serif',
  classic: 'settings.font.classic',
};

const CORNER_LABEL_KEY: Record<CornerStyle, TranslationKey> = {
  sharp: 'settings.corner.sharp',
  default: 'settings.corner.default',
  round: 'settings.corner.round',
};

const MONO_FONT_LABEL_KEY: Record<MonoFontPreference, TranslationKey> = {
  'ibm-plex-mono': 'settings.monoFont.ibmPlexMono',
  'fira-code': 'settings.monoFont.firaCode',
};


function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
    </svg>
  );
}

const PERMISSION_NAMESPACE_ICONS: Record<string, typeof Clipboard> = {
  'clipboard-manager': Clipboard,
  fs: FolderOpen,
  dialog: FolderClosed,
  opener: Compass,
  http: Globe,
  core: Shield,
  process: RotateCw,
  updater: RefreshCw,
  store: HardDrive,
  'window-state': LayoutGrid,
};

const APP_PERMISSION_GROUPS = getAppPermissionGroups();
const SHORTCUT_GROUPS = getShortcutGroups();

// ── Settings sections, listed in a left nav ──────────────────────────────
// One section is shown at a time and scrolls on its own; the nav is plain
// text without icons so it does not compete with the main sidebar. Labels
// reuse each section's title key, so nav and heading always match.
// Ordered by frequency of use: everyday customization, then plugins,
// extensions and integrations, then rarely used information. Built-in plugin
// permissions live under Tools, and storage location under About.
const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'settings.section.appearance' },
  { id: 'tools', label: 'settings.section.tools' },
  { id: 'shortcuts', label: 'settings.section.shortcuts' },
  { id: 'extensions', label: 'settings.section.extensions' },
  { id: 'mcp', label: 'settings.mcp.title' },
  { id: 'permissions', label: 'settings.permissions.title' },
  { id: 'about', label: 'settings.about.title' },
  { id: 'config', label: 'settings.config.title' },
] as const satisfies ReadonlyArray<{ id: string; label: TranslationKey }>;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && SETTINGS_SECTIONS.some((s) => s.id === value);
}

export function Settings() {
  const { features, toggleFeature, resetToDefaults, toolOrder, reorderTools, isFavorite, toggleFavorite } = useFeatures();
  const { open: openOnboarding } = useOnboarding();
  const { status: updateStatus, updateInfo, updateAvailable, error: updateError, downloadProgress, autoCheckEnabled, checkHour, setCheckHour, toggleAutoCheck, checkForUpdates, installUpdate, cancelInstall, openUpdateDialog } = useUpdate();
  const { updates: extensionUpdates } = useExtensionUpdates();
  const { config, setField, resetConfig } = useAppConfig();
  const { locale, setLocale, t } = useLocale();
  const { enabled: mcpBackgroundEnabled, setEnabled: setMcpBackgroundEnabled } = useMcpBackgroundBridge();
  const { isEnabled: isMcpToolEnabled, setToolEnabled: setMcpToolEnabled } = useMcpToolEnabledMap();
  // MCP_TOOL_IDS is static and includes tools that may not be installed;
  // only list tools present in the registry.
  const availableMcpToolIds = MCP_TOOL_IDS.filter((id) => TOOL_DEFS.some((td) => td.id === id));
  // The left nav selects one open section; sections have no accordions.
  const location = useLocation();
  // Deep links (deepLink.ts) navigate here with
  // `{ state: { section: 'extensions' } }`. Read on init (cold start) and
  // in the effect below (already on Settings, where only the state changes).
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() =>
    isSettingsSectionId((location.state as { section?: unknown } | null)?.section)
      ? (location.state as { section: SettingsSectionId }).section
      : 'appearance',
  );
  useEffect(() => {
    const section = (location.state as { section?: unknown } | null)?.section;
    if (isSettingsSectionId(section)) setActiveSection(section);
  }, [location.state]);
  const [currentVersion, setCurrentVersion] = useState('');
  const [dataDir, setDataDir] = useState('');
  // main.tsx applied this tone before first paint; just mirror it here.
  const [accent, setAccent] = useState<AccentTone>(() => getAccentPreference());
  const changeAccent = (tone: AccentTone) => {
    setAccent(tone);
    setAccentPreference(tone);
    applyAccentToDocument(tone);
  };
  const [corner, setCorner] = useState<CornerStyle>(() => getCornerPreference());
  const changeCorner = (style: CornerStyle) => {
    setCorner(style);
    setCornerPreference(style);
    applyCornerToDocument(style);
  };
  const [font, setFont] = useState<FontPreference>(() => getFontPreference());
  const changeFont = (pref: FontPreference) => {
    setFont(pref);
    setFontPreference(pref);
    applyFontToDocument(pref);
  };
  const [monoFont, setMonoFont] = useState<MonoFontPreference>(() => getMonoFontPreference());
  const changeMonoFont = (pref: MonoFontPreference) => {
    setMonoFont(pref);
    setMonoFontPreference(pref);
    applyMonoFontToDocument(pref);
  };

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setCurrentVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/path').then(({ appDataDir }) => appDataDir()).then(setDataDir).catch(() => {});
  }, []);

  const revealDataDir = useCallback(async () => {
    if (!isTauri || !dataDir) return;
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(dataDir);
  }, [dataDir]);

  const [displayTools, setDisplayTools] = useState(() => withGroupClustering(applySavedOrder(TOOL_DEFS, toolOrder)));

  // Keep in sync when toolOrder changes externally (e.g. reset).
  const prevOrderKey = useRef(toolOrder.join());
  const nextKey = toolOrder.join();
  if (prevOrderKey.current !== nextKey) {
    prevOrderKey.current = nextKey;
    setDisplayTools(withGroupClustering(applySavedOrder(TOOL_DEFS, toolOrder)));
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

  // One-click actions that undo the user's own setup ask first.
  const [pendingConfirm, setPendingConfirm] = useState<'disableAll' | 'resetTools' | 'resetConfig' | null>(null);
  const CONFIRMS = {
    disableAll: { title: t('settings.confirm.disableAllTitle'), description: t('settings.confirm.disableAllBody'), confirmLabel: t('settings.tools.disableAll'), run: disableAll },
    resetTools: { title: t('settings.confirm.resetToolsTitle'), description: t('settings.confirm.resetToolsBody'), confirmLabel: t('common.reset'), run: resetToDefaults },
    resetConfig: { title: t('settings.confirm.resetConfigTitle'), description: t('settings.confirm.resetConfigBody'), confirmLabel: t('common.reset'), run: resetConfig },
  } as const;

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

  // `id` is a logical row key (toLogicalRows): a group id or a tool id.
  // Group children are not draggable; their order is fixed by TOOL_GROUPS.
  const startDrag = useCallback((id: string, e: React.PointerEvent) => {
    const order = toLogicalRows(displayTools).map((r) => r.key);
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
            const rows = toLogicalRows(prev);
            const from = rows.findIndex((r) => r.key === meta.id);
            if (from < 0) return prev;
            const nextRows = [...rows];
            const [moved] = nextRows.splice(from, 1);
            nextRows.splice(d.dropIndex, 0, moved);
            // Each row is already contiguous; just flatten in the new row order.
            const flat = nextRows.flatMap((r) => r.tools);
            reorderTools(flat.map((t) => t.id));
            return flat;
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
    <div className="flex h-full min-h-0">
      {/* Left nav: plain text, no icons, so it does not compete with the
          main sidebar. One section is shown at a time. */}
      <nav className="w-48 shrink-0 overflow-y-auto border-r border-line bg-chrome px-2 py-4">
        <ul className="space-y-0.5">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setActiveSection(s.id)}
                aria-current={activeSection === s.id ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-sm border px-2.5 py-2 text-left text-sm transition-colors',
                  activeSection === s.id
                    ? 'border-line bg-card font-medium text-fg'
                    : 'border-transparent text-fg-mute hover:bg-card/60 hover:text-fg',
                )}
              >
                <span>{t(s.label)}</span>
                {s.id === 'extensions' && extensionUpdates.length > 0 && (
                  <Badge tone="success" pill>{extensionUpdates.length}</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Selected section, scrolling independently of the nav. The sr-only
          heading tells screen readers which section is open. */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Fixed max width keeps description lines readable on wide windows. */}
        <div className="mx-auto max-w-[60rem] space-y-4 px-6 py-6">
          <h2 className="sr-only">{t(SETTINGS_SECTIONS.find((s) => s.id === activeSection)!.label)}</h2>

          {activeSection === 'appearance' && (
            <>
      <SettingGroup title={t('settings.section.appearance')}>
        <SettingRow
          icon={Languages}
          title={t('settings.language.label')}
          description={t('settings.language.description')}
          control={
            <Segmented
              size="sm"
              aria-label={t('settings.language.label')}
              value={locale}
              onValueChange={setLocale}
              options={[
                { value: 'vi', label: 'VI' },
                { value: 'en', label: 'EN' },
              ]}
            />
          }
        />
        <SettingRow
          icon={Palette}
          title={t('settings.tone.label')}
          description={t('settings.tone.description')}
          control={<AccentSwatches value={accent} onChange={changeAccent} ariaLabel={t('settings.tone.label')} />}
        />
        <SettingRow
          icon={SquareDashed}
          title={t('settings.corner.label')}
          description={t('settings.corner.description')}
          control={
            <Segmented
              size="sm"
              aria-label={t('settings.corner.label')}
              value={corner}
              onValueChange={(v) => changeCorner(v as CornerStyle)}
              options={CORNER_STYLES.map((c) => ({ value: c, label: t(CORNER_LABEL_KEY[c]) }))}
            />
          }
        />
        <SettingRow
          icon={Type}
          title={t('settings.font.label')}
          description={t('settings.font.description')}
          control={
            <Select value={font} onValueChange={(v) => changeFont(v as FontPreference)}>
              <SelectTrigger className="h-ctl w-44 text-xs" aria-label={t('settings.font.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_PREFERENCES.map((f) => (
                  <SelectItem key={f} value={f}>{t(FONT_LABEL_KEY[f])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          icon={Type}
          title={t('settings.monoFont.label')}
          description={t('settings.monoFont.description')}
          control={
            <Select value={monoFont} onValueChange={(v) => changeMonoFont(v as MonoFontPreference)}>
              <SelectTrigger className="h-ctl w-44 text-xs" aria-label={t('settings.monoFont.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONO_FONT_PREFERENCES.map((f) => (
                  <SelectItem key={f} value={f}>{t(MONO_FONT_LABEL_KEY[f])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          // No preview for the UI font above: it applies to the whole app, so
          // Settings itself is the preview. Code fonts differ only in ligatures
          // (=>, !=, >=), which have to be seen, so a sample block follows.
          preview={
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-mute">
                {t('settings.monoFont.previewLabel')}
              </span>
              <code className="min-w-0 truncate font-mono text-dense text-fg">
                {'const ok = (a !== b) && (a >= b) ? a => a * 2 : null;'}
              </code>
            </div>
          }
        />
      </SettingGroup>
            </>
          )}

          {activeSection === 'tools' && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <p className="text-[11px] text-fg-mute">
                  {t('settings.tools.enabledCount', { enabled: enabledCount, total: TOOL_DEFS.length })}
                </p>
          <div className="flex flex-wrap items-center gap-2">
            {!allEnabled && (
              <button
                onClick={enableAll}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
              >
                <CheckCheck className="h-3 w-3 shrink-0" />
                {t('settings.tools.enableAll')}
              </button>
            )}
            {!allDisabled && (
              <button
                onClick={() => setPendingConfirm('disableAll')}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
              >
                <Ban className="h-3 w-3 shrink-0" />
                {t('settings.tools.disableAll')}
              </button>
            )}
            <button
              onClick={() => setPendingConfirm('resetTools')}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
            >
              <RotateCcw className="h-3 w-3 shrink-0" />
              {t('common.reset')}
            </button>
          </div>
              </div>
        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-mute/60" />
          <Input
            value={toolQuery}
            onChange={(e) => setToolQuery(e.target.value)}
            placeholder={t('shell.search.placeholder')}
            className="pl-8 pr-8 h-ctl text-xs bg-bg-2/40 border-line"
          />
          {toolQuery && (
            <button
              onClick={() => setToolQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-mute/60 hover:text-fg transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="relative rounded-lg border divide-y">
          {visibleTools.length === 0 && isSearching && (
            <p className="px-4 py-6 text-center text-[11px] text-fg-mute">{t('shell.search.noMatch', { query: toolQuery })}</p>
          )}
          {(() => {
            const nodes: React.ReactNode[] = [];
            let slot = 0; // running index among non-dragged rows
            const line = (key: string) => (
              <div key={key} className="pointer-events-none mx-3 h-0.5 rounded-full bg-acc" />
            );
            // Logical rows are the drag unit: a group (2+ adjacent members) is one
            // row; its children follow TOOL_GROUPS and cannot be dragged alone.
            const rows = toLogicalRows(visibleTools);
            rows.forEach((row) => {
              const isDragging = drag?.id === row.key;

              if (!isDragging) {
                if (drag && drag.dropIndex === slot) nodes.push(line(`line-${slot}`));
                slot++;
              }

              if (row.isGroup) {
                const group = GROUP_OF_TOOL.get(row.tools[0].id)!;
                const GroupIcon = group.icon;
                nodes.push(
                  <div key={row.key}>
                    <div
                      ref={(el) => {
                        if (el) rowRefs.current.set(row.key, el);
                        else rowRefs.current.delete(row.key);
                      }}
                      style={isDragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
                      className={cn(
                        'flex items-center gap-2 bg-bg-2/30 px-3 py-1.5 cursor-default',
                        isDragging && 'relative z-20 rounded-lg bg-bg-2 shadow-lg ring-1 ring-acc/50'
                      )}
                    >
                      {/* Drags the whole group; children have no handle of their own. */}
                      <button
                        type="button"
                        aria-label={t('settings.tools.dragReorderGroup', { label: group.label })}
                        onPointerDown={!isSearching ? (e) => { e.preventDefault(); startDrag(row.key, e); } : undefined}
                        className={cn(
                          'shrink-0 touch-none text-fg-mute/40 transition-colors',
                          isSearching ? 'opacity-0 pointer-events-none' : 'cursor-grab active:cursor-grabbing hover:text-fg-mute'
                        )}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <GroupIcon className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                      <p className="text-xs font-semibold">{group.label}</p>
                      <p className="text-[11px] text-fg-mute">{t('settings.tools.count', { count: row.tools.length })}</p>
                    </div>
                    {row.tools.map((tool) => {
                      const enabled = features[tool.id] !== false;
                      return (
                        <div
                          key={tool.id}
                          className={cn(
                            'flex items-center gap-3 py-3 pl-10 pr-3 cursor-default bg-bg',
                            !enabled && 'opacity-50'
                          )}
                        >
                          <ToolRowFields
                            tool={tool}
                            enabled={enabled}
                            favorite={isFavorite(tool.id)}
                            onToggleFavorite={() => toggleFavorite(tool.id)}
                            onToggleEnabled={() => toggleFeature(tool.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
                return;
              }

              const tool = row.tools[0];
              const enabled = features[tool.id] !== false;
              nodes.push(
                <div
                  key={tool.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.key, el);
                    else rowRefs.current.delete(row.key);
                  }}
                  style={isDragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 cursor-default bg-bg',
                    !enabled && 'opacity-50',
                    isDragging && 'relative z-20 rounded-lg bg-bg-2 opacity-100 shadow-lg ring-1 ring-acc/50'
                  )}
                >
                  {/* Drag handle — hidden while searching */}
                  <button
                    type="button"
                    aria-label={t('settings.tools.dragReorder')}
                    onPointerDown={!isSearching ? (e) => { e.preventDefault(); startDrag(row.key, e); } : undefined}
                    className={cn(
                      'shrink-0 touch-none text-fg-mute/40 transition-colors',
                      isSearching ? 'opacity-0 pointer-events-none' : 'cursor-grab active:cursor-grabbing hover:text-fg-mute'
                    )}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>
                  <ToolRowFields
                    tool={tool}
                    enabled={enabled}
                    favorite={isFavorite(tool.id)}
                    onToggleFavorite={() => toggleFavorite(tool.id)}
                    onToggleEnabled={() => toggleFeature(tool.id)}
                  />
                </div>
              );
            });
            if (drag && drag.dropIndex === slot) nodes.push(line('line-end'));
            return nodes;
          })()}
        </div>

        {/* Permissions and activity of built-in tools. */}
        <div className="pt-2 border-t border-line">
          <SettingsPlugins />
        </div>

            </section>
          )}

          {activeSection === 'shortcuts' && (
            <section className="space-y-3">
        <p className="text-[11px] text-fg-mute -mt-1">
          {t('settings.shortcuts.description')}
        </p>
        <div className="rounded-lg border divide-y">
          {SHORTCUT_GROUPS.map((group) => {
            const tool = group.toolId ? TOOL_DEFS.find((td) => td.id === group.toolId) : null;
            const GroupIcon = tool?.icon ?? Keyboard;
            const label = tool?.label ?? t('settings.shortcuts.global');
            return (
              <div key={group.toolId ?? 'global'} className="flex items-start gap-3 px-4 py-3">
                <GroupIcon className="h-4 w-4 shrink-0 mt-0.5 text-acc" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="text-xs font-medium">{label}</p>
                  <ul className="space-y-1.5">
                    {group.shortcuts.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] leading-relaxed">
                        <span className="flex shrink-0 items-center gap-0.5">
                          {s.keys.map((k, ki) => (
                            <span key={ki} className="flex items-center gap-0.5">
                              {ki > 0 && <span className="text-fg-mute/50">{s.join === 'either' ? '/' : '+'}</span>}
                              <Kbd>{k}</Kbd>
                            </span>
                          ))}
                        </span>
                        <span className="text-fg-mute">{s.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
            </section>
          )}

          {activeSection === 'permissions' && (
            <section className="space-y-3">
        <p className="text-[11px] text-fg-mute -mt-1">
          {t('settings.permissions.description')}
        </p>
        {!isTauri && (
          <p className="text-[11px] text-warn">
            {t('settings.permissions.webWarning')}
          </p>
        )}
        <div className="rounded-lg border divide-y">
          {APP_PERMISSION_GROUPS.map(({ namespace, name, permissions }) => {
            const Icon = PERMISSION_NAMESPACE_ICONS[namespace] ?? Cog;
            return (
              <div key={namespace} className="flex items-start gap-3 px-4 py-3">
                <Icon className="h-4 w-4 shrink-0 mt-0.5 text-acc" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="text-xs font-medium">
                    {name} <span className="font-mono text-fg-mute/60">{namespace}</span>
                  </p>
                  <ul className="space-y-1.5">
                    {permissions.map((p) => (
                      <li key={p.identifier} className="text-[11px] leading-relaxed">
                        <div className="flex items-baseline gap-2">
                          <span className="mt-px text-fg-mute/40">•</span>
                          <code className="flex-1 min-w-0 truncate font-mono text-fg-mute/80">{p.identifier}</code>
                        </div>
                        {p.description && (
                          <p className="pl-4 text-fg-mute">{p.description}</p>
                        )}
                        {p.allowUrls && p.allowUrls.length > 0 && (
                          <ul className="pl-4 mt-0.5 space-y-0.5">
                            {p.allowUrls.map((url) => (
                              <li key={url} className="flex items-baseline gap-2">
                                <span className="mt-px text-fg-mute/30">–</span>
                                <code className="font-mono text-fg-mute/70 break-all">{url}</code>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
            </section>
          )}

          {activeSection === 'extensions' && <SettingsExtensions />}

          {activeSection === 'mcp' && (
            <section className="space-y-3">
        {!isTauri ? (
          <p className="text-[11px] text-warn">{t('settings.mcp.webWarning')}</p>
        ) : (
          <>
            <div className="rounded-lg border divide-y text-xs">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{t('settings.mcp.backgroundTitle')}</p>
                  <p className="text-[11px] text-fg-mute mt-0.5 max-w-md">
                    {t('settings.mcp.backgroundDescription')}
                  </p>
                </div>
                <Toggle
                  checked={mcpBackgroundEnabled}
                  onChange={() => setMcpBackgroundEnabled((v) => !v)}
                  label={t('settings.mcp.backgroundTitle')}
                />
              </div>
            </div>

            <div className="rounded-lg border divide-y text-xs">
              <div className="px-4 py-2.5">
                <p className="font-medium">{t('settings.mcp.perToolTitle')}</p>
                <p className="text-[11px] text-fg-mute mt-0.5 max-w-md">
                  {t('settings.mcp.perToolDescription')}
                </p>
              </div>
              {availableMcpToolIds.map((id) => {
                const label = TOOL_DEFS.find((td) => td.id === id)?.label ?? id;
                const enabled = isMcpToolEnabled(id);
                return (
                  <div key={id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0 pr-2">
                      <p className="font-medium">{label}</p>
                      <p className="text-[11px] text-fg-mute mt-0.5">{MCP_TOOL_CAPABILITIES[id]}</p>
                    </div>
                    <Toggle
                      checked={enabled}
                      onChange={() => setMcpToolEnabled(id, !enabled)}
                      label={label}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
            </section>
          )}

          {activeSection === 'about' && (
            <section className="space-y-3">
        <div className="rounded-lg border divide-y text-xs">
          <div className="flex items-center gap-3 px-4 py-4">
            <AppLogo size={44} />
            <div>
              <p className="font-semibold text-sm leading-none">DevTool</p>
              <p className="text-fg-mute mt-1 text-[11px]">{t('settings.about.tagline')}</p>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-xs">
            <div>
              <p className="font-medium">{t('settings.about.onboardingTitle')}</p>
              <p className="text-[11px] text-fg-mute mt-0.5">{t('settings.about.onboardingDescription')}</p>
            </div>
            <button
              onClick={openOnboarding}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
            >
              <Compass className="h-3 w-3" />
              {t('settings.about.reviewCta')}
            </button>
          </div>
          {isTauri && (
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <div>
                <p className="font-medium">{t('settings.about.autoCheckTitle')}</p>
                <p className="text-[11px] text-fg-mute mt-0.5">
                  {t('settings.about.autoCheckDescription', { hour: formatHour(checkHour) })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {autoCheckEnabled && (
                  <Select value={String(checkHour)} onValueChange={(v) => setCheckHour(Number(v))}>
                    <SelectTrigger className="h-ctl w-28 text-xs rounded-sm">
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
                <Toggle checked={autoCheckEnabled} onChange={toggleAutoCheck} label={t('settings.about.autoCheckTitle')} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3 text-xs">
            <span className="text-fg-mute">{t('settings.about.version')}</span>
            <div className="flex items-center gap-2">
              {updateStatus === 'not-available' && !updateAvailable && (
                <span className="flex items-center gap-1 text-ok">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('settings.about.upToDate')}
                </span>
              )}
              {updateAvailable && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ok-tint text-ok px-1.5 py-0.5 text-[11px] font-semibold">
                  {t('settings.about.updateAvailable', { version: updateInfo?.version ?? '' })}
                </span>
              )}
              {updateStatus === 'error' && (
                updateError?.startsWith('Offline') ? (
                  <span
                    className="flex items-center gap-1 text-warn"
                    title={updateError}
                  >
                    <WifiOff className="h-3 w-3 shrink-0" />
                    {t('settings.about.offline')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-bad">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {updateError ?? t('settings.about.updateCheckFailed')}
                  </span>
                )
              )}

              {isTauri && (
                updateStatus === 'downloading' ? (
                  <span className="flex items-center gap-1.5 text-fg-mute">
                    <Spinner size="xs" />
                    {t('settings.about.downloading')}
                    {downloadProgress != null && (
                      <>
                        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-bg-2">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-acc transition-all duration-150"
                            style={{ width: `${downloadProgress}%` }}
                          />
                        </span>
                        <span className="tabular-nums">{downloadProgress}%</span>
                      </>
                    )}
                    <button
                      onClick={cancelInstall}
                      title={t('settings.about.cancelDownload')}
                      aria-label={t('settings.about.cancelDownload')}
                      className="ml-1 rounded-full text-fg-mute hover:text-fg transition-colors"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                ) : updateStatus === 'checking' ? (
                  <span className="flex items-center gap-1 text-fg-mute">
                    <Spinner size="xs" />
                    {t('settings.about.checking')}
                  </span>
                ) : updateAvailable ? (
                  <>
                    <button
                      onClick={openUpdateDialog}
                      className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
                    >
                      <Sparkles className="h-3 w-3" />
                      {t('settings.about.whatsNew')}
                    </button>
                    <button
                      onClick={installUpdate}
                      className="flex items-center gap-1 rounded-lg bg-acc text-acc-fg px-2 py-1 text-[11px] font-medium hover:bg-acc/90 transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      {t('settings.about.install')}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={checkForUpdates}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t('settings.about.check')}
                  </button>
                )
              )}

              <span className="font-mono font-medium">{currentVersion || '…'}</span>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-fg-mute">{t('settings.about.contact')}</span>
            <a
              href="https://github.com/DianaSensei/developer-desktop-utils/issues"
              target="_blank"
              rel="noopener noreferrer"
              title={t('settings.about.openGitHub')}
              aria-label={t('settings.about.openGitHub')}
              onClick={(e) => openExternal(e, 'https://github.com/DianaSensei/developer-desktop-utils/issues')}
              className="text-fg-mute hover:text-fg transition-colors"
            >
              <GitHubIcon className="h-4 w-4" />
            </a>
          </div>
          <div className="px-4 py-3">
            <p className="text-fg-mute leading-relaxed">
              {t('settings.about.privacyNote')}
            </p>
          </div>
        </div>

        {/* Data directory location. */}
        <div className="rounded-lg border divide-y">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-medium">{t('settings.storage.location')}</p>
              <p className="text-[11px] text-fg-mute mt-0.5 leading-relaxed break-all">
                {isTauri
                  ? dataDir || t('settings.storage.resolving')
                  : t('settings.storage.webOnly')}
              </p>
              <p className="text-[11px] text-fg-mute mt-1 leading-relaxed">
                {t('settings.storage.note')}
              </p>
            </div>
            {isTauri && (
              <button
                onClick={revealDataDir}
                disabled={!dataDir}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('settings.storage.showInFolder')}
              </button>
            )}
          </div>
        </div>
            </section>
          )}

          {activeSection === 'config' && (
            <section className="space-y-3">
              <div className="flex items-center justify-end">
                <button
                  onClick={() => setPendingConfirm('resetConfig')}
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('common.reset')}
                </button>
              </div>
              <p className="text-[11px] text-fg-mute -mt-1">
                {t('settings.config.description')}
              </p>
        {(Object.keys(SECTION_LABELS) as ConfigSection[]).map((sec) => {
          const fields = CONFIG_FIELDS.filter((f) => f.section === sec);
          if (!fields.length) return null;
          return (
            <div key={sec} className="rounded-lg border divide-y">
              <div className="bg-bg-2/10 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
                {SECTION_LABELS[sec]}
              </div>
              {fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{f.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-fg-mute">{f.description}</p>
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
                      className="h-ctl w-24 text-center text-xs rounded-sm"
                    />
                    {f.unit && <span className="w-5 text-[11px] text-fg-mute">{f.unit}</span>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
            </section>
          )}
        </div>
      </div>
      {pendingConfirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setPendingConfirm(null); }}
          title={CONFIRMS[pendingConfirm].title}
          description={CONFIRMS[pendingConfirm].description}
          confirmLabel={CONFIRMS[pendingConfirm].confirmLabel}
          onConfirm={() => CONFIRMS[pendingConfirm].run()}
        />
      )}
    </div>
  );
}
