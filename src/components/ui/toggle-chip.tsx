import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ToggleChipProps extends Omit<ButtonProps, 'onClick' | 'variant'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/**
 * Tuỳ chọn bật/tắt trên toolbar ("Uppercase keywords", "Pretty XML",
 * "Remove whitespace"…). Trước đây SQL Formatter, Data Converter, Text
 * Transformer và Encode Pipeline mỗi nơi tự vẽ một kiểu (rounded-lg, viền
 * acc/50, nền acc/10…), có chỗ thiếu `aria-pressed` nên trình đọc màn hình
 * không biết nó đang bật.
 *
 * Bật = nhuộm accent (`acc-tint`): theo RULES.md accent nghĩa là "đang được
 * chọn". Khác `Switch` của dòng cấu hình (xanh lá cố định) — đây là lựa chọn
 * trong toolbar, không phải trạng thái hệ thống.
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
