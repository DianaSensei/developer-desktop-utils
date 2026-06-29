import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ViewHeaderProps {
  icon: LucideIcon;
  title: React.ReactNode;
  /** Muted second line — counts, scope, context. */
  subtitle?: React.ReactNode;
  /** Right-aligned controls (buttons, toggles). */
  actions?: React.ReactNode;
  /** When set, shows a back affordance to the left of the icon. */
  onBack?: () => void;
  className?: string;
}

/**
 * The single header bar for a tool's list/detail view: an optional back button,
 * a quiet icon chip, a title with a muted subtitle, and right-aligned actions.
 * Shared so the Kafka and RabbitMQ views speak one header vocabulary instead of
 * re-deriving the icon/title/subtitle markup (which had drifted between them).
 */
export function ViewHeader({ icon: Icon, title, subtitle, actions, onBack, className }: ViewHeaderProps) {
  return (
    <div className={cn('shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border/60', className)}>
      <div className="flex items-center gap-2.5 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={() => onBack()}
            title="Back"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm leading-tight truncate">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
