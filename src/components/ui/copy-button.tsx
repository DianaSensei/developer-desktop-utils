import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import UI from '@/components/ui/ui.messages';

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
 * The app's copy-to-clipboard button: the Copy icon cross-fades to a green
 * Check, held for the configurable `editor.copyFeedbackMs`.
 */
export const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      value,
      copyAction,
      label,
      copiedLabel,
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
    const ui = useMessages(UI);
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
        title={title ?? (copied ? ui('copied') : ui('copy'))}
        aria-label={typeof label === 'string' ? label : ui('copy')}
        className={className}
        {...props}
      >
        {/* Both icons share one box and cross-fade. Copy leaves with
            `ease-in-soft`; Check enters with `ease-spring` so success reads
            clearly. */}
        <span className={cn('relative inline-flex items-center justify-center', iconClassName)}>
          {/* A one-time ring at the moment of copy, to catch eyes that are on
              the text rather than the button. */}
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
          <span className="ml-1.5 whitespace-nowrap">{copied ? (copiedLabel ?? ui('copied')) : label}</span>
        )}
      </Button>
    );
  }
);
CopyButton.displayName = 'CopyButton';
