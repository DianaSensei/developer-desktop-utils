import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared full-height tool scaffolding so every tool (and the app chrome) speaks
 * one layout vocabulary instead of re-deriving the same flex/grid/border markup.
 *
 *   <ToolToolbar>            ← fixed glass header row for mode toggles / controls
 *   <ToolPanes>             ← vertical input/output split (each child = one pane)
 *     <ToolPane>
 *       <PaneHeader label="Input" hint={quickPasteHint} />
 *       <Textarea … />
 *     </ToolPane>
 *     <ToolPane>
 *       <PaneHeader label="Output" action={<CopyButton … />} />
 *       <Textarea readOnly … />
 *     </ToolPane>
 *   </ToolPanes>
 */

// Fixed top control row — opaque chrome, matches the app header.
const ToolToolbar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('shrink-0 header-chrome px-4 py-2.5', className)} {...props} />
  )
);
ToolToolbar.displayName = 'ToolToolbar';

// Vertical split filling the remaining height. `rows` controls the split count.
const ToolPanes = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { rows?: 2 | 3 }
>(({ className, rows = 2, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex-1 min-h-0 grid divide-y divide-line overflow-hidden',
      rows === 3 ? 'grid-rows-3' : 'grid-rows-2',
      className
    )}
    {...props}
  />
));
ToolPanes.displayName = 'ToolPanes';

// A single pane within ToolPanes: a column with its own header and scroll
// body. Uses `--card`, the brightest surface, with the surrounding chrome a
// step darker, as in IDEs.
const ToolPane = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col min-h-0 bg-card', className)} {...props} />
  )
);
ToolPane.displayName = 'ToolPane';

// The thin labelled bar atop a pane: label on the left, optional action on the
// right (e.g. a CopyButton), with an optional muted hint beside the label.
export interface PaneHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}
const PaneHeader = React.forwardRef<HTMLDivElement, PaneHeaderProps>(
  ({ className, label, hint, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // Solid `--chrome` bar separated by a `--line` border.
        'shrink-0 px-4 py-1.5 border-b border-line bg-chrome flex items-center justify-between gap-2',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* Eyebrow label (small caps, wide tracking) so it reads as a label,
            not data. */}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-mute">{label}</span>
        {hint && <span className="truncate text-[11px] text-fg-mute">{hint}</span>}
      </div>
      {action}
    </div>
  )
);
PaneHeader.displayName = 'PaneHeader';

export { ToolToolbar, ToolPanes, ToolPane, PaneHeader };
