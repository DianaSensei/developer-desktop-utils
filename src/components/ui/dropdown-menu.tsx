// Dependency-free popover menu — the single foundation for every "▾ button
// that opens a small list of actions" pattern in the app. Before this existed,
// each tool hand-rolled its own `open` state + useDismissable + absolutely
// positioned panel (API Client's Sidebar, RequestPanel, ResponsePanel, and
// ResponsiveTabBar each had a slightly different copy). Use this instead of
// reinventing it.
//
// Not a Radix primitive — the app has no dropdown-menu/popover dependency.
// `DropdownMenuContent` portals to `document.body` and positions itself with
// a `fixed`-position rect computed from the trigger, flipping above the
// trigger when there isn't room below (e.g. a table row near the bottom of a
// scrolled viewport) — an `absolute`, non-portaled panel would get clipped by
// any scrollable/`overflow`-non-visible ancestor (the table's own
// `overflow-x-auto` wrapper, the view's scroll container, a Dialog's
// transformed wrapper) instead of escaping it. Because the panel is no
// longer a DOM descendant of the trigger once portaled, outside-click
// dismissal is hand-rolled here (checking both the trigger and the portaled
// panel) rather than reusing the single-ref `useDismissable` hook.

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext(component: string): DropdownMenuContextValue {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <DropdownMenu>`);
  return ctx;
}

export interface DropdownMenuProps {
  /** Controlled open state. Omit to let the menu manage its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

/** Root — provides open state and the outside-click/Escape dismissal. */
export function DropdownMenu({ open: openProp, onOpenChange, className, children }: DropdownMenuProps) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const open = openProp ?? uncontrolled;
  const setOpen = React.useCallback((v: boolean) => {
    onOpenChange?.(v);
    if (openProp === undefined) setUncontrolled(v);
  }, [openProp, onOpenChange]);

  const anchorRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, anchorRef, contentRef }}>
      <div ref={anchorRef} className={cn('relative inline-block', className)}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export type DropdownMenuTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/** Trigger — any button; toggles the menu. Style it however the call site needs. */
export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ onClick, type = 'button', ...props }, ref) => {
    const { open, setOpen } = useDropdownMenuContext('DropdownMenuTrigger');
    return (
      <button
        ref={ref}
        type={type}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { onClick?.(e); setOpen(!open); }}
        {...props}
      />
    );
  },
);
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

export interface DropdownMenuContentProps {
  /** Which edge the panel hangs from. Default 'start' (left-aligned). */
  align?: 'start' | 'end';
  className?: string;
  children: React.ReactNode;
}

const GUTTER = 4;

/** Content — the floating panel, portaled to `document.body` and positioned
 *  from the trigger's rect so no scroll/overflow ancestor can clip it. */
export function DropdownMenuContent({ align = 'start', className, children }: DropdownMenuContentProps) {
  const { open, setOpen, anchorRef, contentRef } = useDropdownMenuContext('DropdownMenuContent');
  const [pos, setPos] = React.useState<{ top: number; left?: number; right?: number } | null>(null);

  // Pass 1: place it below the trigger, aligned per `align`.
  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos(
      align === 'end'
        ? { top: rect.bottom + GUTTER, right: window.innerWidth - rect.right }
        : { top: rect.bottom + GUTTER, left: rect.left },
    );
  }, [open, align, anchorRef]);

  // Pass 2: now that the panel has real dimensions, flip it above the
  // trigger if it would overflow the viewport's bottom edge.
  React.useLayoutEffect(() => {
    if (!open || !pos || !contentRef.current || !anchorRef.current) return;
    const contentRect = contentRef.current.getBoundingClientRect();
    if (contentRect.bottom <= window.innerHeight - GUTTER) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const flippedTop = anchorRect.top - contentRect.height - GUTTER;
    if (flippedTop >= GUTTER && Math.abs(flippedTop - pos.top) > 0.5) {
      setPos((p) => (p ? { ...p, top: flippedTop } : p));
    }
    // Only re-check when the candidate position changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.top, pos?.left, pos?.right]);

  // A scroll elsewhere (the table, the page) would leave a `fixed`-position
  // portal anchored to a stale spot since it's no longer a DOM descendant of
  // the scrolling ancestor — closing is simpler and safer than re-tracking.
  React.useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (contentRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Deferred by a frame: the click that opens the menu can itself trigger a
    // scroll (e.g. the browser scrolling the newly-focused trigger into view)
    // — attaching synchronously would catch that scroll and immediately close
    // the menu it was just opening.
    const raf = requestAnimationFrame(() => {
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, setOpen, contentRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right }}
      className={cn(
        'z-50 min-w-[10rem] rounded-lg border border-line bg-card p-1 shadow-md',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-fast motion-safe:ease-out-soft',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  /** Tints the row as the current selection (bg-acc/10 + text-acc). */
  active?: boolean;
  /** Tints the row for a destructive action (text-bad). */
  danger?: boolean;
  /** Close the menu after this item is clicked. Default true. */
  closeOnSelect?: boolean;
}

/** Item — one row. Closes the menu on click unless `closeOnSelect={false}`. */
export const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ icon, active, danger, closeOnSelect = true, className, onClick, children, type = 'button', ...props }, ref) => {
    const { setOpen } = useDropdownMenuContext('DropdownMenuItem');
    return (
      <button
        ref={ref}
        type={type}
        role="menuitem"
        onClick={(e) => { onClick?.(e); if (closeOnSelect) setOpen(false); }}
        className={cn(
          'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-acc',
          active && 'bg-acc/10 text-acc',
          danger && 'text-bad hover:bg-bad/10',
          className,
        )}
        {...props}
      >
        {icon}
        <span className="flex-1">{children}</span>
      </button>
    );
  },
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

/** Small uppercase group heading inside the menu (e.g. a body-type category). */
export function DropdownMenuLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn('px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-mute', className)}>
      {children}
    </p>
  );
}

/** Hairline divider between item groups. */
export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 border-t border-line', className)} />;
}
