import React from 'react';
import { cn } from '@/lib/utils';

/* ── Premium Card Component ──────────────────────────────────────────
   Enhanced card with premium shadow system and smooth transitions */
export const PremiumCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { elevated?: boolean }
>(({ className, elevated = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-border bg-card transition-all duration-200 ease-out',
      elevated ? 'shadow-lg-premium' : 'shadow-sm-premium',
      className
    )}
    {...props}
  />
));
PremiumCard.displayName = 'PremiumCard';

/* ── Premium Container ──────────────────────────────────────────────
   Sophisticated container for tool sections with backdrop blur */
export const PremiumContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-border bg-card/50 backdrop-blur-sm p-4 sm:p-5',
      'transition-colors duration-150',
      className
    )}
    {...props}
  />
));
PremiumContainer.displayName = 'PremiumContainer';

/* ── Premium Section ────────────────────────────────────────────────
   Grouped content section with clear visual hierarchy */
export const PremiumSection = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('space-y-3', className)}
    {...props}
  />
));
PremiumSection.displayName = 'PremiumSection';

/* ── Premium Label ──────────────────────────────────────────────────
   Enhanced form label with improved typography */
export const PremiumLabel = React.forwardRef<
  HTMLLabelElement,
  React.HTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'block text-sm font-semibold text-foreground leading-relaxed tracking-tight',
      className
    )}
    {...props}
  />
));
PremiumLabel.displayName = 'PremiumLabel';

/* ── Premium Hint ───────────────────────────────────────────────────
   Helper text with proper visual hierarchy */
export const PremiumHint = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'text-xs leading-relaxed text-muted-foreground',
      className
    )}
    {...props}
  />
));
PremiumHint.displayName = 'PremiumHint';

/* ── Premium Divider ────────────────────────────────────────────────
   Subtle separation line */
export const PremiumDivider = React.forwardRef<
  HTMLHRElement,
  React.HTMLAttributes<HTMLHRElement>
>(({ className, ...props }, ref) => (
  <hr
    ref={ref}
    className={cn(
      'border-none h-px bg-border/50 transition-colors duration-150',
      className
    )}
    {...props}
  />
));
PremiumDivider.displayName = 'PremiumDivider';

/* ── Premium Badge ──────────────────────────────────────────────────
   Pill-shaped badge for status, tags, or metadata */
export const PremiumBadge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'primary' | 'destructive' }
>(({ className, variant = 'default', ...props }, ref) => {
  const variants = {
    default: 'bg-muted/60 text-foreground border border-border/50',
    primary: 'bg-primary/10 text-primary border border-primary/30',
    destructive: 'bg-destructive/10 text-destructive border border-destructive/30',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
        'transition-colors duration-150',
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
PremiumBadge.displayName = 'PremiumBadge';

/* ── Premium Stat Card ──────────────────────────────────────────────
   Display statistic with label and value */
export const PremiumStatCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { label: string; value: string | number; color?: string }
>(({ className, label, value, color = 'text-foreground', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex flex-col items-center justify-center p-3 sm:p-4 rounded-lg',
      'border border-border bg-card/50',
      'transition-all duration-150 ease-out',
      'hover:bg-card/80 hover:border-border/70 hover:shadow-sm-premium',
      className
    )}
    {...props}
  >
    <div className={cn('text-lg sm:text-xl font-bold', color)}>{value}</div>
    <div className="text-xs text-muted-foreground mt-1 text-center leading-tight">{label}</div>
  </div>
));
PremiumStatCard.displayName = 'PremiumStatCard';

/* ── Premium Tab ────────────────────────────────────────────────────
   Premium tab navigation item */
export const PremiumTab = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }
>(({ className, isActive = false, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'px-4 py-2.5 rounded-t-lg border border-b-0 border-border text-sm font-medium',
      'transition-all duration-150 ease-out',
      isActive
        ? 'bg-card border-border text-foreground shadow-sm-premium'
        : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted/70',
      className
    )}
    {...props}
  />
));
PremiumTab.displayName = 'PremiumTab';

/* ── Premium Header ────────────────────────────────────────────────
   Section header with proper typography hierarchy */
export const PremiumHeader = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { level?: 'lg' | 'md' | 'sm' }
>(({ className, level = 'md', ...props }, ref) => {
  const sizes = {
    lg: 'text-lg font-semibold leading-snug',
    md: 'text-base font-semibold leading-relaxed',
    sm: 'text-sm font-semibold leading-relaxed',
  };

  return (
    <h3
      ref={ref}
      className={cn('text-foreground tracking-tight', sizes[level], className)}
      {...props}
    />
  );
});
PremiumHeader.displayName = 'PremiumHeader';

/* ── Premium Input Group ────────────────────────────────────────────
   Container for label + input/textarea with consistent spacing */
export const PremiumInputGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('space-y-2.5', className)}
    {...props}
  />
));
PremiumInputGroup.displayName = 'PremiumInputGroup';

/* ── Premium Output Group ───────────────────────────────────────────
   Container for label + output with consistent spacing and dividers */
export const PremiumOutputGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'space-y-2.5 pb-5 sm:pb-6 border-b last:border-0 last:pb-0',
      className
    )}
    {...props}
  />
));
PremiumOutputGroup.displayName = 'PremiumOutputGroup';

/* ── Premium Content Wrapper ────────────────────────────────────────
   Wrapper for scrollable content with consistent padding */
export const PremiumContentWrapper = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex-1 min-h-0 overflow-y-auto',
      'px-4 py-5 sm:px-5 sm:py-6 lg:px-6',
      'space-y-6 sm:space-y-7',
      className
    )}
    {...props}
  />
));
PremiumContentWrapper.displayName = 'PremiumContentWrapper';

/* ── Premium Grid ───────────────────────────────────────────────────
   Responsive grid for stat cards and similar components */
export const PremiumGrid = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { cols?: 2 | 3 | 4 }
>(({ className, cols = 4, ...props }, ref) => {
  const colClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
  }[cols];

  return (
    <div
      ref={ref}
      className={cn(
        'grid gap-2 sm:gap-3',
        colClass,
        className
      )}
      {...props}
    />
  );
});
PremiumGrid.displayName = 'PremiumGrid';

/* ── Premium Action Button Group ────────────────────────────────────
   Container for action buttons with consistent spacing */
export const PremiumActionGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex gap-2.5 flex-wrap', className)}
    {...props}
  />
));
PremiumActionGroup.displayName = 'PremiumActionGroup';
