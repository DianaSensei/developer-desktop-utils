import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: LucideIcon;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * Pill / segmented toggle — the canonical mode-switch control for tools.
 * The active segment rides a raised premium chip with a soft shadow that
 * cross-fades between options; inactive segments stay quiet until hover.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  ...props
}: SegmentedProps<T>) {
  // Chiều cao đặt ở KHUNG NGOÀI (h-ctl) và các nút con kéo `h-full`, để tổng
  // chiều cao đúng bằng --h thay vì --h + đệm — nếu không, segmented sẽ cao hơn
  // input/button đứng cạnh nó vài pixel.
  const pad = size === 'sm' ? 'h-7 text-xs' : 'text-sm';
  return (
    <div
      role="tablist"
      aria-label={props['aria-label']}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm border border-border bg-muted/60 p-0.5',
        size === 'md' && 'h-ctl',
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xs px-3 font-medium',
              'transition-[color,background-color,box-shadow,transform] duration-200 ease-out motion-safe:active:scale-[0.97]',
              size === 'md' && 'h-full',
              pad,
              active
                ? 'bg-card text-foreground shadow-sm-premium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
