import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: React.ComponentType<any>;
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
        'flex flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center animate-fade-in',
        className
      )}
    >
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-muted/20">
        <Icon className="h-8 w-8 text-muted-foreground/40" />
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex gap-2 mt-4">
          {action && (
            <Button
              onClick={action.onClick}
              variant={action.variant || 'default'}
              size="sm"
              className="h-8"
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant="outline"
              size="sm"
              className="h-8"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
