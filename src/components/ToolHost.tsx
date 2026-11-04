// Renders the tools. Open tabs stay mounted while in the background (up to
// MAX_ALIVE, least recently used first out), so switching tabs keeps a
// half-typed request, a running consumer, scroll position and undo history —
// nothing reloads. With a split view two of them are on screen at once.
//
// Every kept tool renders through its own <Routes location>, frozen at the
// last URL it had, so `useLocation`/`useSearchParams` inside a background
// tool keep answering for that tool instead of for whatever is in front.
// All tool containers are siblings in one flex row: moving a tool between
// "hidden", "left" and "right" only changes CSS order/width, never remounts.
//
// Only the tool that owns the keyboard is `active` (ToolActivityContext);
// window shortcuts, ⌘V quick-paste, OS file drops and header actions check it.

import {
  Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Route, Routes, useLocation, useNavigate, type Location } from 'react-router-dom';
import { Columns2, Loader2, Repeat, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IS_MAC } from '@/lib/platform';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ExperimentalGate } from '@/components/ExperimentalGate';
import { ToolActivityProvider } from '@/contexts/ToolActivityContext';
import { useWorkspaces } from '@/contexts/WorkspaceContext';
import { useSplitView, type Pane } from '@/contexts/SplitViewContext';
import { useLocale } from '@/contexts/LocaleContext';

/** Tools kept mounted at once (the visible ones count). */
export const MAX_ALIVE = 6;

export interface HostedTool {
  featureId: string;
  label: string;
  path: string;
  component: ComponentType;
  experimental?: boolean;
  fullHeight?: boolean;
}

function ToolLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-fg-mute/60" />
    </div>
  );
}

export function ToolHost({ tools, fallback }: { tools: HostedTool[]; fallback: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tabs } = useWorkspaces();
  const split = useSplitView();
  const { t } = useLocale();
  const byPath = useMemo(() => new Map(tools.map((tool) => [tool.path, tool])), [tools]);
  const current = byPath.get(location.pathname) ?? null;

  // Last location of every tool, so a background tool keeps its own URL.
  const locations = useRef(new Map<string, Location>());
  if (current) {
    const prev = locations.current.get(current.featureId);
    // Back to a tool by its bare path (sidebar, tab): restore the query it
    // had, e.g. Encode·Hash·Encrypt's `?tab=jwt` — handled in the effect.
    if (!(prev && prev.search && !location.search && !location.hash)) locations.current.set(current.featureId, location);
  }
  useEffect(() => {
    if (!current) return;
    const prev = locations.current.get(current.featureId);
    if (prev && prev !== location && prev.search && !location.search && !location.hash) {
      navigate({ pathname: prev.pathname, search: prev.search, hash: prev.hash }, { replace: true });
    } else {
      split?.rememberLocation(current.featureId, `${location.pathname}${location.search}${location.hash}`);
    }
  }, [current, location, navigate, split]);

  // Which tools stay mounted: the visible ones, then recently used open tabs.
  const [lru, setLru] = useState<string[]>(() => (current ? [current.featureId] : []));
  useEffect(() => {
    if (!current) return;
    setLru((prev) => (prev[0] === current.featureId ? prev : [current.featureId, ...prev.filter((id) => id !== current.featureId)]));
  }, [current]);
  const leftId = split?.leftId ?? current?.featureId ?? null;
  const rightId = split?.rightId ?? null;
  const focusedId = split?.focused === 'right' ? rightId : leftId;
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.featureId)), [tabs]);
  const visible = [leftId, rightId].filter((id): id is string => !!id && tools.some((tool) => tool.featureId === id));
  const alive = useMemo(() => {
    const keep = [...visible];
    for (const id of lru) {
      if (keep.length >= MAX_ALIVE) break;
      if (!keep.includes(id) && tabIds.has(id)) keep.push(id);
    }
    return keep;
  }, [visible.join(','), lru, tabIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stable DOM order (by first mount) so switching never reorders siblings.
  const order = useRef<string[]>([]);
  for (const id of alive) if (!order.current.includes(id)) order.current.push(id);
  order.current = order.current.filter((id) => alive.includes(id));

  // A URL that is no tool (redirects, unknown paths): let the router handle it.
  if (!current) return <>{fallback}</>;

  const isSplit = !!rightId && visible.length === 2;
  const ratio = split?.ratio ?? 50;

  return (
    <div className="relative flex h-full min-h-0 w-full">
      {order.current.map((id) => {
        const tool = tools.find((x) => x.featureId === id);
        if (!tool) return null;
        const pane: Pane | null = id === leftId ? 'left' : id === rightId && isSplit ? 'right' : null;
        const shown = pane !== null;
        const isActive = id === focusedId;
        const loc = locations.current.get(id) ?? location;
        const element = tool.experimental
          ? <ExperimentalGate label={tool.label}><tool.component /></ExperimentalGate>
          : <tool.component />;
        return (
          <section
            key={id}
            aria-label={tool.label}
            data-tool-pane={pane ?? undefined}
            onPointerDownCapture={isSplit && pane && !isActive ? () => split?.focusPane(pane) : undefined}
            onFocusCapture={isSplit && pane && !isActive ? () => split?.focusPane(pane) : undefined}
            className={cn(
              'relative min-h-0 min-w-0 flex-col',
              shown ? 'flex' : 'hidden',
              isSplit && isActive && 'ring-1 ring-inset ring-acc-edge',
            )}
            style={{
              order: pane === 'right' ? 2 : 0,
              flexBasis: isSplit ? `${pane === 'left' ? ratio : 100 - ratio}%` : '100%',
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            {isSplit && pane && (
              <PaneBar
                label={tool.label}
                active={isActive}
                pane={pane}
                onClose={() => split?.closePane(pane)}
                onSwap={() => split?.swap()}
                t={t}
              />
            )}
            {/* `@container`: tools size themselves to their pane (a split
                view pane is half the window), not to the viewport. */}
            <div className={cn('@container min-h-0 flex-1', tool.fullHeight ? 'overflow-hidden' : 'overflow-y-auto')}>
              <div
                className={cn(
                  // Fades in when the tab comes back (display: none → flex restarts it).
                  tool.fullHeight
                    ? 'h-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft'
                    : 'mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-base motion-safe:ease-out-soft',
                )}
              >
                <ToolActivityProvider value={{ active: isActive, visible: shown }}>
                  <ErrorBoundary resetKey={tool.path} toolId={tool.featureId} toolLabel={tool.label}>
                    <Suspense fallback={<ToolLoading />}>
                      <Routes location={loc}>
                        <Route path={tool.path} element={element} />
                      </Routes>
                    </Suspense>
                  </ErrorBoundary>
                </ToolActivityProvider>
              </div>
            </div>
          </section>
        );
      })}
      {isSplit && <SplitDivider ratio={ratio} onChange={(r) => split?.setRatio(r)} label={t('shell.split.resize')} />}
    </div>
  );
}

function PaneBar({ label, active, pane, onClose, onSwap, t }: {
  label: string; active: boolean; pane: Pane; onClose: () => void; onSwap: () => void;
  t: ReturnType<typeof useLocale>['t'];
}) {
  return (
    <div className={cn('flex h-6 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px]', active ? 'bg-acc-tint text-acc-ink' : 'bg-chrome text-fg-mute')}>
      <Columns2 className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {pane === 'left' && (
        <button type="button" onClick={onSwap} title={t('shell.split.swap')} aria-label={t('shell.split.swap')} className="rounded-xs p-0.5 hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
          <Repeat className="h-3 w-3" />
        </button>
      )}
      <button type="button" onClick={onClose} title={t('shell.split.closePane', { label })} aria-label={t('shell.split.closePane', { label })} className="rounded-xs p-0.5 hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Drag handle between the panes; arrow keys nudge it. */
function SplitDivider({ ratio, onChange, label }: { ratio: number; onChange: (ratio: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const host = ref.current?.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => onChange(((ev.clientX - rect.left) / rect.width) * 100);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.setProperty('cursor', 'col-resize');
    document.body.style.setProperty('user-select', 'none');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(ratio)}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(ratio - 5); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onChange(ratio + 5); }
      }}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize focus-visible:outline-hidden"
      style={{ order: 1 }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-acc-edge group-focus-visible:bg-acc" />
    </div>
  );
}

/** Header button: split with the last used tab, or close the split (⌘\). */
export function SplitToggle({ compact = false }: { compact?: boolean }) {
  const split = useSplitView();
  const { tabs } = useWorkspaces();
  const { t } = useLocale();
  if (!split) return null;
  const on = !!split.rightId;
  if (!on && tabs.length < 2) return null;
  const label = on ? t('shell.split.close') : t('shell.split.toggle');
  const keys = `${IS_MAC ? '⌘' : 'Ctrl+'}\\`;
  return (
    <button
      type="button"
      onClick={() => split.toggleSplit()}
      title={`${label} (${keys})`}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        compact ? 'h-6 w-6' : 'h-ctl w-ctl',
        on ? 'bg-acc-tint text-acc-ink' : 'text-fg-mute/70 hover:bg-sunk hover:text-fg',
      )}
    >
      <Columns2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  );
}
