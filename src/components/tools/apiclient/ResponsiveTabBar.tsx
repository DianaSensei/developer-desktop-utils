// A horizontal tab strip that progressively collapses trailing tabs into a »
// overflow menu as it runs out of room — using measured widths so the active tab
// is never clipped. An optional `right` node is pinned to the right edge and the
// tabs yield space to it (used by the response panel's status readout).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TabDef {
  id: string;
  label: string;
  badge?: ReactNode;
}

interface Props {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
  right?: ReactNode;
  className?: string;
}

export function ResponsiveTabBar({ tabs, active, onSelect, right, className }: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerW, setHeaderW] = useState(Infinity);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setHeaderW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure each tab's intrinsic width (hidden row) and the right group's width.
  const measureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabW, setTabW] = useState<Record<string, number>>({});
  const rightRef = useRef<HTMLDivElement>(null);
  const [rightW, setRightW] = useState(0);
  useLayoutEffect(() => {
    let changed = false;
    const next: Record<string, number> = {};
    for (const id of Object.keys(measureRefs.current)) {
      const el = measureRefs.current[id];
      if (!el) continue;
      next[id] = el.offsetWidth;
      if (tabW[id] !== next[id]) changed = true;
    }
    if (changed) setTabW(next);
    const rw = rightRef.current?.offsetWidth ?? 0;
    if (rw !== rightW) setRightW(rw);
  });

  const GAP = 16;   // gap-4 between tabs
  const CHEV = 42;  // » button + margin
  const PAD = 24;   // padding/buffer before the right group
  const wid = (id: string) => tabW[id] ?? 80;
  const budget = headerW - rightW - PAD;
  const totalAll = tabs.reduce((s, t) => s + wid(t.id) + GAP, 0);

  let inlineTabs = tabs;
  let overflowTabs: TabDef[] = [];
  if (Number.isFinite(headerW) && totalAll > budget) {
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
    <div ref={headerRef} className={cn('flex items-center border-b px-3', className)}>
      {/* hidden row used only to measure intrinsic tab widths */}
      <div aria-hidden className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-4">
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { measureRefs.current[t.id] = el; }} className="flex shrink-0 items-center gap-1 py-2 text-xs font-medium">
            {t.label}{t.badge}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-4 overflow-hidden">
        {inlineTabs.map((t) => (
          <TabBtn key={t.id} def={t} active={t.id === active} onClick={() => onSelect(t.id)} />
        ))}
      </div>
      {overflowTabs.length > 0 && <TabOverflow tabs={overflowTabs} onSelect={onSelect} />}
      {right != null && (
        <div ref={rightRef} className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap pl-4 text-xs">
          {right}
        </div>
      )}
    </div>
  );
}

function TabBtn({ def, active, onClick }: { def: TabDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative -mb-px flex shrink-0 items-center gap-1 border-b-2 py-2 text-xs font-medium transition-colors',
        active ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {def.label}{def.badge}
    </button>
  );
}

function TabOverflow({ tabs, onSelect }: { tabs: TabDef[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-3 shrink-0">
      <button onClick={() => setOpen((o) => !o)} title="More tabs" className="-mb-px border-b-2 border-transparent py-2 text-muted-foreground hover:text-foreground">
        <ChevronsRight className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 min-w-[10rem] rounded-md border bg-popover p-1 shadow-md">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => { onSelect(t.id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                {t.label}{t.badge}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
