// A horizontal tab strip that progressively collapses trailing tabs into a »
// overflow menu as it runs out of room — using measured widths so the active tab
// is never clipped. An optional `right` node is pinned to the right edge and the
// tabs yield space to it (e.g. a status readout or toolbar controls).
//
// Shared foundation: originally built for API Client's request/response panel
// tabs; promoted here so any tool with a horizontal tab strip (Kafka topic
// views, RabbitMQ queue/exchange views) gets the same collapse-to-overflow
// behavior instead of a plain non-responsive tab row that clips at narrow
// widths.
//
// Active tab is a rounded-md filled pill — the app's one semantic shape for
// "this is selected" (see design/RULES.md's "Bo góc cho trạng thái đang chọn"
// rule). This used to be an opt-in `variant` (a sliding-underline strip was
// the default, kept for compatibility with the tools that hadn't been moved
// over yet); every consumer has since moved to the pill, so the underline
// path and the `variant` prop are gone — one shape, not two to keep in sync.

import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDismissable } from '@/hooks/useDismissable';

export interface TabDef {
  id: string;
  label: string;
  badge?: ReactNode;
}

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  right?: ReactNode;
  className?: string;
  /** Active-pill background + text color. Default 'bg-card text-fg shadow-sm'
   *  — override when a tool has an established alternate accent. */
  activeClassName?: string;
}

export function Tabs({ tabs, active, onSelect, right, className, activeClassName }: TabsProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const headerWRef = useRef(0);
  const [headerW, setHeaderW] = useState(0);

  // Measure each tab's intrinsic width (hidden row) and the right group's width.
  // Use refs for previous values so the effect is only registered once and doesn't
  // re-run on every render.
  const measureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabWRef = useRef<Record<string, number>>({});
  const [tabW, setTabW] = useState<Record<string, number>>({});
  const rightRef = useRef<HTMLDivElement>(null);
  const rightWRef = useRef(0);
  const [rightW, setRightW] = useState(0);

  // A stable string that changes whenever any tab label changes — used as a dep
  // to re-measure without including the full tabs array (which is a new reference
  // every render from the parent).
  const tabsKey = useMemo(() => tabs.map((t) => `${t.id}:${t.label}`).join('\0'), [tabs]);
  const hasRight = right != null;

  // One routine reads all three widths; the layout effect runs it before the
  // browser paints. Deferring the header width to the (async) ResizeObserver
  // callback made the strip render every tab inline for one frame and then
  // collapse — a visible flicker on mount and on every layout toggle.
  const hiddenRowRef = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    const prevTabW = tabWRef.current;
    let changed = false;
    const next: Record<string, number> = {};
    for (const id of Object.keys(measureRefs.current)) {
      const el = measureRefs.current[id];
      if (!el) continue;
      next[id] = el.offsetWidth;
      if (prevTabW[id] !== next[id]) changed = true;
    }
    // On WebKitGTK a layout pass may not have completed yet, so offsetWidth can
    // read 0. Keep the previous measurement rather than collapsing everything.
    if (changed && !Object.values(next).some((w) => w === 0)) {
      tabWRef.current = next;
      setTabW(next);
    }
    const rw = rightRef.current?.offsetWidth ?? 0;
    if (rw !== rightWRef.current) {
      rightWRef.current = rw;
      setRightW(rw);
    }
    const hw = headerRef.current?.offsetWidth ?? 0;
    if (hw !== headerWRef.current) {
      headerWRef.current = hw;
      setHeaderW(hw);
    }
  }, []);

  useLayoutEffect(measure, [measure, tabsKey, hasRight, active]);

  // Re-measure on any later size change: the container (window resize, split or
  // sidebar drag), the right-hand group (a wider status readout), or the hidden
  // row (badges appearing/changing, which widen individual tabs).
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    for (const el of [headerRef.current, rightRef.current, hiddenRowRef.current]) {
      if (el) ro.observe(el);
    }
    return () => { ro.disconnect(); cancelAnimationFrame(rafId); };
  }, [measure, hasRight]);

  const GAP = 16;   // gap-4 between tabs
  const CHEV = 42;  // » button + margin
  const PAD = 24;   // padding/buffer before the right group
  const wid = (id: string) => tabW[id] ?? 80;
  const budget = headerW - rightW - PAD;
  const totalAll = tabs.reduce((s, t) => s + wid(t.id) + GAP, 0);

  let inlineTabs = tabs;
  let overflowTabs: TabDef[] = [];
  if (headerW > 0 && totalAll > budget) {
    const head: TabDef[] = [];
    let used = 0;
    for (const t of tabs) {
      if (used + wid(t.id) + GAP + CHEV <= budget) { head.push(t); used += wid(t.id) + GAP; }
      else break;
    }
    if (head.length === 0) head.push(tabs[0]);
    let rest = tabs.filter((t) => !head.includes(t));
    if (rest.some((t) => t.id === active)) {
      const act = tabs.find((t) => t.id === active)!;
      let hw = head.reduce((s, t) => s + wid(t.id) + GAP, 0);
      while (head.length > 1 && hw + wid(act.id) + GAP + CHEV > budget) {
        hw -= wid(head.pop()!.id) + GAP;
      }
      head.push(act);
      rest = tabs.filter((t) => !head.includes(t));
    }
    inlineTabs = head;
    overflowTabs = rest;
  }

  return (
    <div ref={headerRef} className={cn('flex items-center border-b border-line px-3', className)}>
      {/* hidden row used only to measure intrinsic tab widths */}
      <div ref={hiddenRowRef} aria-hidden className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-4">
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { measureRefs.current[t.id] = el; }} className="flex shrink-0 items-center gap-1 py-2 text-xs font-medium">
            {t.label}{t.badge}
          </button>
        ))}
      </div>

      <TabRow
        tabs={inlineTabs}
        active={active}
        activeClassName={activeClassName}
        onSelect={onSelect}
      />
      {overflowTabs.length > 0 && <TabOverflow tabs={overflowTabs} onSelect={onSelect} />}
      {right != null && (
        <div ref={rightRef} className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap pl-4 text-xs">
          {right}
        </div>
      )}
    </div>
  );
}

function TabRow({ tabs, active, activeClassName, onSelect }: {
  tabs: TabDef[]; active: string; activeClassName?: string; onSelect: (id: string) => void;
}) {
  return (
    <div className="relative flex min-w-0 items-center gap-1 overflow-hidden py-1">
      {tabs.map((t) => (
        <TabBtn
          key={t.id}
          def={t}
          active={t.id === active}
          activeClassName={activeClassName}
          onClick={() => onSelect(t.id)}
        />
      ))}
    </div>
  );
}

const TabBtn = forwardRef<HTMLButtonElement, {
  def: TabDef; active: boolean; activeClassName?: string; onClick: () => void;
}>(({ def, active, activeClassName, onClick }, ref) => (
  <button
    ref={ref}
    onClick={onClick}
    aria-selected={active}
    className={cn(
      'relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-fast ease-out-soft',
      active ? (activeClassName ?? 'bg-card text-fg shadow-sm') : 'text-fg-mute hover:bg-bg-2/50 hover:text-fg',
    )}
  >
    {def.label}{def.badge}
  </button>
));
TabBtn.displayName = 'TabBtn';

function TabOverflow({ tabs, onSelect }: { tabs: TabDef[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  // Click-outside + Escape, instead of a full-screen invisible backdrop that
  // swallowed hover and scroll events over the rest of the panel.
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative ml-3 shrink-0">
      <button onClick={() => setOpen((o) => !o)} title="More tabs" className="rounded-md p-1.5 text-fg-mute transition-colors hover:bg-bg-2/50 hover:text-fg">
        <ChevronsRight className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 min-w-[10rem] rounded-lg border border-line bg-card p-1 shadow-md">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { onSelect(t.id); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-acc"
            >
              {t.label}{t.badge}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
