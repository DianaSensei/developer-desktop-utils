import * as React from 'react';
import { cn } from '@/lib/utils';

// Consistent container for tool input/output sections
const ToolSection = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('space-y-2.5', className)} {...props} />
  )
);
ToolSection.displayName = 'ToolSection';

// Consistent label for tool sections
const ToolLabel = React.forwardRef<HTMLLabelElement, React.HTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('block text-xs font-medium text-foreground', className)} {...props} />
  )
);
ToolLabel.displayName = 'ToolLabel';

// Consistent hint text
const ToolHint = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-[11px] text-muted-foreground', className)} {...props} />
  )
);
ToolHint.displayName = 'ToolHint';

// Consistent container for tool content (scrollable area)
const ToolContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex-1 min-h-0 overflow-y-auto',
        'px-3 py-4 sm:px-4 sm:py-5',
        className
      )}
      {...props}
    />
  )
);
ToolContent.displayName = 'ToolContent';

export { ToolSection, ToolLabel, ToolHint, ToolContent };
