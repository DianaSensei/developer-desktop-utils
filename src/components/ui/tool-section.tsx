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
const ToolLabel = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('block text-xs font-medium text-fg', className)} {...props} />
  )
);
ToolLabel.displayName = 'ToolLabel';

// Consistent hint text
const ToolHint = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-[11px] text-fg-mute', className)} {...props} />
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

// One labelled form control: label row (+ optional right-aligned actions),
// the control itself, and an optional hint underneath. `ToolLabel`/`ToolHint`
// give the type styles but leave the assembly to the caller, which is why the
// API Client's runner and cookie manager and RabbitMQ's RPC view each grew a
// private `Field` wrapper with slightly different label sizes and gaps.
//
//   <Field label="Timeout" hint="Per request, in milliseconds.">
//     <Input value={timeout} onChange={…} />
//   </Field>
//
// Pass `htmlFor` (with a matching input `id`) whenever the control is a real
// form element, so clicking the label focuses it.
interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** Right-aligned controls in the label row — a reset link, a small toggle. */
  actions?: React.ReactNode;
  htmlFor?: string;
  /** Marks the field required with a muted asterisk. */
  required?: boolean;
  /** Error text shown in place of the hint, in the destructive tone. */
  error?: React.ReactNode;
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ label, hint, actions, htmlFor, required, error, className, children, ...props }, ref) => (
    <div ref={ref} className={cn('space-y-1.5', className)} {...props}>
      <div className="flex min-h-[1.25rem] items-center gap-2">
        <ToolLabel htmlFor={htmlFor} className="min-w-0 flex-1 truncate">
          {label}
          {required && <span className="ml-0.5 text-fg-mute">*</span>}
        </ToolLabel>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
      {error
        ? <p className="text-[11px] text-destructive">{error}</p>
        : hint && <ToolHint>{hint}</ToolHint>}
    </div>
  )
);
Field.displayName = 'Field';

export { ToolSection, ToolLabel, ToolHint, ToolContent, Field, type FieldProps };
