import { Loader2 } from 'lucide-react';
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
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      {message && <p className="text-sm text-muted-foreground loading-text">{message}</p>}
    </div>
  );
}
