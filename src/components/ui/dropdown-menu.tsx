// Dependency-free popover menu — the single foundation for every "▾ button
// that opens a small list of actions" pattern in the app. Before this existed,
// each tool hand-rolled its own `open` state + useDismissable + absolutely
// positioned panel (API Client's Sidebar, RequestPanel, ResponsePanel, and
// ResponsiveTabBar each had a slightly different copy). Use this instead of
// reinventing it.
//
// Not a Radix primitive — the app has no dropdown-menu/popover dependency, and
// this composes the existing `useDismissable` hook the same way the date/time/
// color pickers already do, so it stays consistent with the rest of the
// codebase and adds no new dependency.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useDismissable } from '@/hooks/useDismissable';

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
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
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div ref={ref} className={cn('relative inline-block', className)}>
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

/** Content — the floating panel. Unmounts entirely while closed. */
export function DropdownMenuContent({ align = 'start', className, children }: DropdownMenuContentProps) {
  const { open } = useDropdownMenuContext('DropdownMenuContent');
  if (!open) return null;
  return (
    <div
      role="menu"
      className={cn(
        'absolute z-50 mt-1 min-w-[10rem] rounded-lg border border-line bg-card p-1 shadow-md',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
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
