import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type Side = 'right' | 'top' | 'bottom' | 'left';

export interface TooltipProps {
  /** Bold title line. */
  label: React.ReactNode;
  /** Optional secondary description line. */
  description?: React.ReactNode;
  /** Side to anchor the tooltip on. Default 'right'. */
  side?: Side;
  /** Hover delay before showing, ms. Default 400. */
  delay?: number;
  /** Disable the tooltip entirely (still renders children). */
  disabled?: boolean;
  /** Fixed width for the bubble; defaults to fit-content up to ~13rem. */
  width?: number;
  /** Class for the tooltip bubble. */
  className?: string;
  /** Class for the trigger wrapper (e.g. 'block w-full' for full-width rows). */
  triggerClassName?: string;
  children: React.ReactNode;
}

/**
 * Lightweight, dependency-free hover tooltip rendered through a portal so it
 * escapes overflow/transform ancestors. Single source of truth for hover hints
 * across the app (premium popover styling, app motion). Positions itself from
 * the trigger's bounding rect and animates in.
 */
export function Tooltip({
  label,
  description,
  side = 'right',
  delay = 400,
  disabled = false,
  width,
  className,
  triggerClassName,
  children,
}: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const [coords, setCoords] = React.useState({ top: 0, left: 0 });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = () => {
    if (disabled) return;
    timer.current = setTimeout(() => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 10;
      const pos = {
        right: { top: r.top + r.height / 2, left: r.right + gap },
        left: { top: r.top + r.height / 2, left: r.left - gap },
        top: { top: r.top - gap, left: r.left + r.width / 2 },
        bottom: { top: r.bottom + gap, left: r.left + r.width / 2 },
      }[side];
      setCoords(pos);
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  };

  const transform = {
    right: '-translate-y-1/2',
    left: '-translate-x-full -translate-y-1/2',
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
  }[side];

  const enterFrom = {
    right: 'slide-in-from-left-1',
    left: 'slide-in-from-right-1',
    top: 'slide-in-from-bottom-1',
    bottom: 'slide-in-from-top-1',
  }[side];

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className={cn('inline-flex', triggerClassName)}
    >
      {children}
      {visible && createPortal(
        <div
          role="tooltip"
          className={cn(
            'fixed z-[9999] pointer-events-none rounded-md border border-border/70 glass-strong px-3 py-2 shadow-lg-premium',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 ease-out',
            enterFrom,
            transform,
            className
          )}
          style={{ top: coords.top, left: coords.left, width: width ?? 'max-content', maxWidth: '13rem' }}
        >
          <p className="text-xs font-semibold leading-none text-popover-foreground">{label}</p>
          {description && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
