import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Status = 'success' | 'error' | 'warning' | 'info';

interface StatusMessageProps {
  status: Status;
  message: string;
  onDismiss?: () => void;
  dismissible?: boolean;
  className?: string;
}

/* Status colors use design tokens directly. */
const STATUS_CONFIG: Record<Status, { icon: React.ComponentType<any>; className: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'bg-ok-tint border-ok-edge text-ok',
  },
  error: {
    icon: AlertCircle,
    className: 'bg-bad-tint border-bad-edge text-bad',
  },
  warning: {
    icon: AlertTriangle,
    className: 'bg-warn-tint border-warn-edge text-warn',
  },
  info: {
    icon: Info,
    className: 'bg-info-tint border-info-edge text-info',
  },
};

export function StatusMessage({
  status,
  message,
  onDismiss,
  dismissible = true,
  className,
}: StatusMessageProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        // Enter with the preset's `pop-in` animation.
        'flex items-start gap-3 rounded-lg border px-4 py-3',
        'motion-safe:animate-pop-in',
        config.className,
        className
      )}
      role="alert"
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">{message}</div>
      {dismissible && onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="h-5 w-5 p-0 ml-2"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
