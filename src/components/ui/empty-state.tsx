import { Button, type ButtonProps } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: ButtonProps['variant'];
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * Centered icon + title + optional description/actions. The single empty-state
 * primitive for the whole app (placeholders in tools, no-data lists, etc.).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center motion-safe:animate-fade-in-up',
        className
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
        <Icon className="h-8 w-8 text-muted-foreground/40" />
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        {description && (
          <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="mt-4 flex gap-2">
          {action && (
            <Button onClick={action.onClick} variant={action.variant || 'default'} size="sm" className="h-8">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button onClick={secondaryAction.onClick} variant="outline" size="sm" className="h-8">
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
