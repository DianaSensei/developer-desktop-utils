// Search input with a leading icon.

import * as React from 'react';
import { Search, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from '@/components/ui/input';
import { useMessages } from '@/contexts/LocaleContext';
import UI from '@/components/ui/ui.messages';

export interface SearchInputProps extends Omit<InputProps, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  /** Shows a × button to clear the value when non-empty. Default true. */
  clearable?: boolean;
  containerClassName?: string;
  /** Leading icon; a magnifier by default. Change it for non-search fields (e.g. a domain). */
  icon?: LucideIcon;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, clearable = true, placeholder, className, containerClassName, icon: Icon = Search, ...props }, ref) => {
    const ui = useMessages(UI);
    placeholder ??= ui('search');
    return (
    <div className={cn('relative', containerClassName)}>
      <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-mute/60" />
      <Input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // Callers rarely add a visible label, so fall back to the placeholder
        // as the accessible name; an explicit `aria-label` wins.
        aria-label={props['aria-label'] ?? (typeof placeholder === 'string' ? placeholder : undefined)}
        className={cn('pl-8', clearable && value && 'pr-7', className)}
        {...props}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={ui('clearSearch')}
          title={ui('clear')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-mute transition-colors hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';
