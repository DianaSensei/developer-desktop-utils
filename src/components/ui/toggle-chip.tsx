import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ToggleChipProps extends Omit<ButtonProps, 'onClick' | 'variant'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/**
 * Toolbar on/off option ("Uppercase keywords", "Pretty XML"...), with
 * `aria-pressed`. On uses the accent tint, since accent means "selected"
 * (RULES.md); settings switches use the fixed green instead.
 */
export const ToggleChip = React.forwardRef<HTMLButtonElement, ToggleChipProps>(
  ({ pressed, onPressedChange, className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'h-ctl select-none rounded-sm text-xs',
        pressed && 'border-acc-edge bg-acc-tint text-acc-ink hover:border-acc-edge hover:bg-acc-tint-2',
        className,
      )}
      {...props}
    />
  ),
);
ToggleChip.displayName = 'ToggleChip';
