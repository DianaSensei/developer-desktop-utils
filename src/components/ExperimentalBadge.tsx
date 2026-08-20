import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLocale } from '@/contexts/LocaleContext';

/**
 * The single "Experimental" marker shown everywhere an experimental tool is
 * listed — sidebar row, Settings tool row, app titlebar — so a user learns to
 * recognize it as one glyph instead of three slightly different ones.
 */
export function ExperimentalBadge({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <Badge tone="warning" variant="soft" uppercase className={cn('gap-1', className)}>
      <FlaskConical className="h-2.5 w-2.5" />
      {t('shell.experimental.badge')}
    </Badge>
  );
}

/** Collapsed-sidebar equivalent: a small dot on the tool icon, positioned so
 *  it never collides with the live-connection dot (top-right). */
export function ExperimentalDot({ title }: { title?: string }) {
  return (
    <span
      className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-warn ring-2 ring-[hsl(var(--chrome-c))]"
      title={title}
    />
  );
}
