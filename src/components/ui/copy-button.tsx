import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { cn } from '@/lib/utils';

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'value'> {
  /** Text to copy, or a (possibly async) getter resolved at click time. */
  value: string | (() => string | null | undefined | Promise<string | null | undefined>);
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
        const text = typeof value === 'function' ? await value() : value;
        if (text == null || text === '') return;
        await copyToClipboard(String(text));
        setCopied(true);
        onCopied?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), config.editor.copyFeedbackMs);
      } catch {
        /* clipboard write can reject (denied permission) — fail silently */
      }
    }, [value, onCopied, config.editor.copyFeedbackMs]);

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
        {/* Both icons share one box and cross-fade so the swap glides. */}
        <span className={cn('relative inline-flex items-center justify-center', iconClassName)}>
          <Icon
            className={cn(
              'absolute inset-0 m-auto transition-all duration-200 ease-out motion-reduce:transition-none',
              iconClassName,
              copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
            )}
          />
          <Check
            className={cn(
              'absolute inset-0 m-auto text-green-500 transition-all duration-200 ease-out motion-reduce:transition-none',
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
