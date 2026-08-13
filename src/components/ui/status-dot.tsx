import { cn } from '@/lib/utils';

/**
 * Semantic tones for the live/connection/state indicator dot. Kept small and
 * closed-ended on purpose — add a tone here rather than reaching for a raw
 * color class at the call site, so "what does a green dot mean in this app"
 * has exactly one answer.
 */
export type StatusDotTone = 'live' | 'starting' | 'paused' | 'idle' | 'error' | 'recording';

const TONE_CLASS: Record<StatusDotTone, string> = {
  live: 'bg-emerald-500',
  starting: 'bg-amber-500',
  paused: 'bg-amber-500',
  idle: 'bg-muted-foreground/40',
  error: 'bg-destructive',
  recording: 'bg-red-500',
};

export interface StatusDotProps {
  tone: StatusDotTone;
  /** Pulses the dot (used for "actively recording/streaming right now"). */
  pulse?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
  title?: string;
}

/**
 * Small colored dot for connection/live/recording state — the pattern every
 * tool with a connect/disconnect flow or a live consumer (Kafka, RabbitMQ,
 * API Client environments, Time Tracker) used to hand-roll as a raw
 * `<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />` with its own
 * slightly different color logic. Centralizing it here means a palette or
 * sizing change is one edit instead of an app-wide grep.
 */
export function StatusDot({ tone, pulse, size = 'sm', className, title }: StatusDotProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block shrink-0 rounded-full',
        size === 'xs' ? 'h-1.5 w-1.5' : 'h-2 w-2',
        TONE_CLASS[tone],
        pulse && 'motion-safe:animate-pulse',
        className,
      )}
    />
  );
}
