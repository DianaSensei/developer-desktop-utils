// Recently closed tabs — closed untitled tabs keep their text (restorable),
// closed file tabs reopen the file. Shown on the welcome screen and in the
// tab strip's history menu.

import { History, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import { SectionLabel } from '@/components/ui/section-label';
import { useMessages, useCurrentLocale } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { ClosedEntry, EditorStore } from './store';
import { fileIcon } from './fileIcons';
import { dirname } from './paths';

function when(ts: number, locale: string): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

interface Props {
  store: EditorStore;
  closed: ClosedEntry[];
  limit?: number;
  /** Called after an entry was restored (e.g. to close a menu). */
  onDone?: () => void;
  className?: string;
}

export function RecentlyClosed({ store, closed, limit = 10, onDone, className }: Props) {
  const m = useMessages(MESSAGES);
  const locale = useCurrentLocale();
  if (closed.length === 0) return null;
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-1.5 px-2 pb-1">
        <SectionLabel className="mr-auto flex items-center gap-1.5">
          <History className="h-3 w-3" />{m('recentlyClosed')}
        </SectionLabel>
        <IconButton size="xs" title={m('clearClosed')} aria-label={m('clearClosed')} onClick={() => store.clearClosed()}>
          <Trash2 className="h-3 w-3" />
        </IconButton>
      </div>
      {closed.slice(0, limit).map((entry) => {
        const Icon = fileIcon(entry.kind === 'file' ? entry.path : 'x.txt');
        return (
          <div key={entry.key} className="group flex items-center gap-1 rounded-xs pr-1 hover:bg-bg-2/60">
            <button
              type="button"
              title={entry.kind === 'file' ? entry.path : m('restore')}
              onClick={() => { void store.reopenClosed(entry.key); onDone?.(); }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1 text-left text-xs focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
              <span className="truncate">{entry.name}</span>
              <span className="min-w-0 truncate text-[11px] text-fg-mute">
                {entry.kind === 'file' ? dirname(entry.path) : m('closedText')}
              </span>
              <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-fg-mute">{when(entry.closedAt, locale)}</span>
            </button>
            <IconButton
              size="xs"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title={m('discard')}
              aria-label={`${m('discard')} ${entry.name}`}
              onClick={() => store.discardClosed(entry.key)}
            >
              <X className="h-3 w-3" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
