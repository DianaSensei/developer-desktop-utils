import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  fullScreen?: boolean;
  className?: string;
}

export function LoadingOverlay({
  visible,
  message = 'Loading...',
  fullScreen = false,
  className,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 animate-fade-in',
        fullScreen
          ? 'fixed inset-0 bg-background/50 backdrop-blur-sm z-50'
          : 'absolute inset-0 bg-background/40 backdrop-blur-xs rounded-lg',
        className
      )}
    >
      <Spinner size="lg" className="text-primary" />
      {message && <p className="text-sm text-muted-foreground loading-text">{message}</p>}
    </div>
  );
}
