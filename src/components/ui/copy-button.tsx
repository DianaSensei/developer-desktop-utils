import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { cn } from '@/lib/utils';

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'value'> {
  /** Text to copy, or a (possibly async) getter resolved at click time. */
  value?: string | (() => string | null | undefined | Promise<string | null | undefined>);
  /**
   * Custom copy action (e.g. copying an image). When provided it replaces the
   * default text copy and `value` is ignored. Return `false` to signal "nothing
   * copied" and suppress the success animation.
   */
  copyAction?: () => boolean | void | Promise<boolean | void>;
  /** Optional label shown next to the icon (e.g. "Copy"). */
  label?: React.ReactNode;
  /** Label shown while in the copied state. Defaults to "Copied". */
  copiedLabel?: React.ReactNode;
  /** Tailwind sizing for the icons (default h-3.5 w-3.5). */
  iconClassName?: string;
  /** Glyph shown in the idle state. Defaults to the Copy icon. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Fires after a successful copy. */
  onCopied?: () => void;
}

/**
 * Single source of truth for "copy to clipboard" buttons across the app.
 *
 * Gives every copy action the same affordance: a smooth cross-fade from the
 * Copy icon to a green Check (no hard icon swap), with the confirmation held
 * for the user-configurable `editor.copyFeedbackMs` duration. Previously each
 * tool either re-implemented this (with differing timings) or — more often —
 * gave no feedback at all, leaving users unsure the copy had happened.
 */
export const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      value,
      copyAction,
      label,
      copiedLabel = 'Copied',
      iconClassName = 'h-3.5 w-3.5',
      icon: Icon = Copy,
      onCopied,
      className,
      variant = 'ghost',
      size = label ? 'sm' : 'icon',
      title,
      disabled,
      ...props
    },
    ref
  ) => {
    const { config } = useAppConfig();
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const handleCopy = React.useCallback(async () => {
      try {
        if (copyAction) {
          if ((await copyAction()) === false) return;
        } else {
          const text = typeof value === 'function' ? await value() : value;
          if (text == null || text === '') return;
          await copyToClipboard(String(text));
        }
        setCopied(true);
        onCopied?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), config.editor.copyFeedbackMs);
      } catch {
        /* clipboard write can reject (denied permission) — fail silently */
      }
    }, [value, copyAction, onCopied, config.editor.copyFeedbackMs]);

    return (
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={handleCopy}
        title={title ?? (copied ? 'Copied' : 'Copy')}
        aria-label={typeof label === 'string' ? label : 'Copy'}
        className={className}
        {...props}
      >
        {/* Hai icon chung một hộp và mờ chéo nhau, nên cú tráo là trượt chứ
            không phải nhấp.

            Hai đường cong KHÁC NHAU, cố ý: icon Copy đi ra bằng `ease-in-soft`
            (dứt khoát, nó đã xong việc), cái Check đi vào bằng `ease-spring`
            (vọt qua một chút rồi lắc về, đọc ra là "xong rồi!"). Bản trước
            dùng chung `duration-200 ease-out` cho cả hai chiều, nên khoảnh khắc
            DUY NHẤT mà app xác nhận với người dùng rằng thao tác đã thành công
            lại là khoảnh khắc phẳng nhất trong toàn bộ giao diện. */}
        <span className={cn('relative inline-flex items-center justify-center', iconClassName)}>
          {/* Vòng sáng lan ra một lần ngay lúc copy xong. Nó không thay thế cái
              Check — nó bắt lấy ánh mắt đang ở CHỖ KHÁC (người dùng vừa bấm
              copy thì thường đang nhìn vùng văn bản, không nhìn cái nút). */}
          {copied && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full bg-ok/40 motion-safe:animate-ring-ping motion-reduce:hidden"
            />
          )}
          <Icon
            className={cn(
              'absolute inset-0 m-auto transition-all duration-fast ease-in-soft motion-reduce:transition-none',
              iconClassName,
              copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
            )}
          />
          <Check
            className={cn(
              'absolute inset-0 m-auto text-ok transition-all duration-base ease-spring motion-reduce:transition-none',
              iconClassName,
              copied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
            )}
          />
        </span>
        {label != null && (
          <span className="ml-1.5 whitespace-nowrap">{copied ? copiedLabel : label}</span>
        )}
      </Button>
    );
  }
);
CopyButton.displayName = 'CopyButton';
