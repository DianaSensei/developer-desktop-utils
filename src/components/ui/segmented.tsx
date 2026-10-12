import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: LucideIcon;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * Pill / segmented toggle, the standard mode switch for tools.
 *
 * - The selected item is a solid accent thumb with inverted text, which is
 *   unambiguous in both themes and every accent tone.
 * - The track is sunk (`bg-sunk` plus an inset shadow) so the thumb reads
 *   as moving inside a groove.
 * - One thumb sits under the buttons, measured from the selected button and
 *   moved with `transform` (no reflow) in `--dur-base` with `--ease-spring`.
 *   The first placement has no transition (`ready`).
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  ...props
}: SegmentedProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

  // Thumb position and width, measured from the selected button. `ready`
  // separates the first placement (no animation) from later moves.
  const [thumb, setThumb] = React.useState<{ x: number; w: number } | null>(null);
  const ready = React.useRef(false);

  React.useLayoutEffect(() => {
    const track = trackRef.current;
    const el = refs.current[activeIndex];
    if (!track || !el) return;
    const measure = () => {
      // `offsetLeft` is relative to the track (position: relative).
      setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Re-measure when button widths change (language switch, badge,
    // container resize).
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    for (const b of refs.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  React.useEffect(() => {
    if (thumb) {
      const id = requestAnimationFrame(() => { ready.current = true; });
      return () => cancelAnimationFrame(id);
    }
  }, [thumb]);

  /**
   * `role="tablist"` keyboard model: only the selected item is a tab stop
   * (roving tabindex); arrows, Home and End move between items.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = activeIndex === last ? 0 : activeIndex + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = activeIndex === 0 ? last : activeIndex - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  }

  const trackH = size === 'sm' ? 'h-ctl' : 'h-ctl';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={props['aria-label']}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-sm border border-line bg-sunk p-0.5',
        'shadow-[inset_0_1px_2px_hsl(var(--fg-c)/0.05)]',
        trackH,
        className
      )}
    >
      {thumb && (
        <span
          aria-hidden="true"
          className={cn(
            // rounded-md: the app's shape for "selected" (design/RULES.md).
            'pointer-events-none absolute inset-y-0.5 left-0 rounded-md bg-acc shadow-btn',
            ready.current && 'motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-spring',
          )}
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((opt, i) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={opt.title}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={onKeyDown}
            className={cn(
              // Text above the thumb; rounded-md to match it.
              'relative z-10 inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3',
              'transition-colors duration-fast ease-out-soft',
              // Focus ring drawn inward so the track does not clip it.
              'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
              textSize,
              active
                ? 'font-semibold text-acc-fg'
                : 'font-medium text-fg-mute hover:text-fg'
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
