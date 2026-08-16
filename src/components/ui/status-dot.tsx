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
  // `recording` KHÔNG dùng --bad: một đồng hồ đang chạy và một lỗi thật không
  // được cùng màu, nếu không đỏ mất nghĩa "có gì đó sai". --live là hệ quy ước
  // riêng cho trạng thái đang-ghi (xem design-system/tokens.css).
  recording: 'bg-[var(--live)]',
};

// Soft ring shadow for the `glow` prop, one per tone that actually gets glowed
// in practice (idle/error dots don't need the emphasis).
// Quầng sáng lấy màu từ chính token của tông, thay cho rgba() viết cứng — nên
// nó theo được theme thay vì giữ nguyên một màu cho cả sáng lẫn tối.
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
 * Small colored dot for connection/live/recording state — the pattern every
 * tool with a connect/disconnect flow or a live consumer (Kafka, RabbitMQ,
 * API Client environments, Time Tracker) used to hand-roll as a raw
 * `<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />` with its own
 * slightly different color logic. Centralizing it here means a palette or
 * sizing change is one edit instead of an app-wide grep.
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
