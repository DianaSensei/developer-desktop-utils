import { cn } from '@/lib/utils';

/**
 * Semantic tones for the live/connection/state indicator dot. Kept small and
 * closed-ended on purpose — add a tone here rather than reaching for a raw
 * color class at the call site, so "what does a green dot mean in this app"
 * has exactly one answer.
 */
export type StatusDotTone = 'live' | 'starting' | 'paused' | 'idle' | 'error' | 'recording';

const TONE_CLASS: Record<StatusDotTone, string> = {
  live: 'bg-ok',
  starting: 'bg-warn',
  paused: 'bg-warn',
  idle: 'bg-fg-mute/40',
  error: 'bg-bad',
  // `recording` uses --live, not --bad: a running timer must not look
  // like an error (see design-system/tokens.css).
  recording: 'bg-[var(--live)]',
};

// Halo for the `glow` prop, for tones that are glowed in practice. Uses
// the tone's own token so it follows the theme.
const TONE_GLOW: Partial<Record<StatusDotTone, string>> = {
  live: 'shadow-[0_0_0_3px_hsl(var(--ok-c)/0.22)]',
  recording: 'shadow-[0_0_0_3px_hsl(var(--live-c)/0.22)]',
  starting: 'shadow-[0_0_0_3px_hsl(var(--warn-c)/0.22)]',
  paused: 'shadow-[0_0_0_3px_hsl(var(--warn-c)/0.22)]',
};

export interface StatusDotProps {
  tone: StatusDotTone;
  /** Pulses the dot (used for "actively recording/streaming right now"). */
  pulse?: boolean;
  /** Adds a soft halo ring in the tone color — for a more prominent "this is the headline state" dot. */
  glow?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  title?: string;
}

/**
 * Dot sizes. StatusDot is the shared connection/live/recording indicator.
 */
const SIZE_CLASS: Record<NonNullable<StatusDotProps['size']>, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

export function StatusDot({ tone, pulse, glow, size = 'sm', className, title }: StatusDotProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block shrink-0 rounded-full',
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        glow && TONE_GLOW[tone],
        pulse && 'motion-safe:animate-pulse',
        className,
      )}
    />
  );
}
