// Icon-in-input search box — the `<Search className="absolute left-2.5 ..." />`
// + `<Input className="pl-8" />` pair that was hand-rolled nearly identically in
// ~14 places (API Client's sidebar, every Kafka/RabbitMQ list view, Clockify,
// JSON Formatter, 2FA...). Use this instead of repositioning the icon by hand
// again.

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from '@/components/ui/input';

export interface SearchInputProps extends Omit<InputProps, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  /** Shows a × button to clear the value when non-empty. Default true. */
  clearable?: boolean;
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, clearable = true, placeholder = 'Search', className, containerClassName, ...props }, ref) => (
    <div className={cn('relative', containerClassName)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-mute/60" />
      <Input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // None of the ~20 call sites pairs this with a visible <Label> — the
        // magnifier and the placeholder are the whole affordance — so without a
        // fallback name a screen reader reaches an unlabelled text field. The
        // placeholder is the name the sighted user gets; use it, and let a call
        // site pass its own `aria-label` to win.
        aria-label={props['aria-label'] ?? (typeof placeholder === 'string' ? placeholder : undefined)}
        className={cn('pl-8', clearable && value && 'pr-7', className)}
        {...props}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          title="Clear"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-mute transition-colors hover:text-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ),
);
SearchInput.displayName = 'SearchInput';
