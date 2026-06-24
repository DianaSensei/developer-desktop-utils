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

// Fixed top control row — frosted glass chrome, matches the app header.
const ToolToolbar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('shrink-0 header-premium px-4 py-2.5', className)} {...props} />
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
      'flex-1 min-h-0 grid divide-y divide-border overflow-hidden',
      rows === 3 ? 'grid-rows-3' : 'grid-rows-2',
      className
    )}
    {...props}
  />
));
ToolPanes.displayName = 'ToolPanes';

// A single pane within ToolPanes — a column that owns its header + scroll body.
const ToolPane = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col min-h-0', className)} {...props} />
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
        'shrink-0 px-4 py-1.5 border-b border-border bg-muted/10 flex items-center justify-between gap-2',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <span className="truncate text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {action}
    </div>
  )
);
PaneHeader.displayName = 'PaneHeader';

export { ToolToolbar, ToolPanes, ToolPane, PaneHeader };
