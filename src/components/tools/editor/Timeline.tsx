// Timeline — the active file's Local History, at the bottom of the Explorer
// as in VS Code. The switch turns recording on or off (one setting for all
// files); while on, every save adds a snapshot. Each snapshot can be compared
// with the current text, restored into the editor, or deleted.

import { useEffect, useState } from 'react';
import { ChevronRight, History, RotateCcw, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/icon-button';
import { SectionLabel } from '@/components/ui/section-label';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCurrentLocale, useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorSnapshot, EditorStore, Tab } from './store';
import type { HistoryEntry } from './fs';

const SOURCE_KEY = { save: 'sourceSave', previous: 'sourcePrevious', restore: 'sourceRestore' } as const;

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "5 minutes ago" / "yesterday", localised; absolute time goes in the title. */
export function useRelativeTime() {
  const locale = useCurrentLocale();
  const m = useMessages(MESSAGES);
  return (ts: number) => {
    const s = Math.round((ts - Date.now()) / 1000);
    if (Math.abs(s) < 45) return m('justNow');
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const abs = Math.abs(s);
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
    return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  };
}

export function absoluteTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' });
}

interface Props {
  store: EditorStore;
  snap: EditorSnapshot;
  tab: Tab | null;
  onView: (entry: HistoryEntry) => void;
}

export function Timeline({ store, snap, tab, onView }: Props) {
  const m = useMessages(MESSAGES);
  const locale = useCurrentLocale();
  const relative = useRelativeTime();
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [toDelete, setToDelete] = useState<HistoryEntry | null>(null);
  const [clearing, setClearing] = useState(false);
  const path = tab?.kind === 'file' ? tab.path : null;

  useEffect(() => {
    if (!path) { setEntries([]); return; }
    let cancelled = false;
    store.listHistory(path).then((list) => { if (!cancelled) setEntries(list); }, () => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [store, path, snap.historyVersion]);

  const restore = async (entry: HistoryEntry) => {
    if (!tab) return;
    if (await store.restoreSnapshot(tab.id, entry.id)) {
      store.notify(m('restoredNotice'), 'info');
      store.focusEditor();
    }
  };

  return (
    <div className={cn('flex shrink-0 flex-col border-t border-line', open && 'max-h-[40%]')}>
      <div className="flex h-ctl shrink-0 items-center gap-1 pl-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-xs py-1 text-left focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-fg-mute transition-transform duration-fast', open && 'rotate-90')} />
          <SectionLabel>{m('timeline')}</SectionLabel>
          {entries.length > 0 && <span className="text-[11px] tabular-nums text-fg-mute">{entries.length}</span>}
        </button>
        {path && entries.length > 0 && (
          <IconButton size="xs" title={m('clearHistory')} aria-label={m('clearHistory')} onClick={() => setClearing(true)}>
            <Trash2 className="h-3 w-3" />
          </IconButton>
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-fg-mute" title={snap.historyEnabled ? m('historyOnHint') : m('historyPaused')}>
          {m('localHistory')}
          <Switch
            checked={snap.historyEnabled}
            onCheckedChange={(on) => store.setHistoryEnabled(on)}
            aria-label={m('localHistory')}
          />
        </label>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1.5">
          {!tab && <Hint>{m('historyNoFile')}</Hint>}
          {tab?.kind === 'untitled' && <Hint>{m('historyUntitled')}</Hint>}
          {path && entries.length === 0 && <Hint>{snap.historyEnabled ? m('historyEmpty') : m('historyOffHint')}</Hint>}
          {path && entries.map((entry) => (
            <div key={entry.id} className="group flex items-center gap-1 rounded-xs pr-1 hover:bg-bg-2/60">
              <button
                type="button"
                onClick={() => onView(entry)}
                title={`${absoluteTime(entry.ts, locale)} · ${formatSize(entry.size)} — ${m('viewSnapshot')}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1 text-left text-xs focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
              >
                <History className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
                <span className="shrink-0">{m(SOURCE_KEY[entry.source] ?? 'sourceSave')}</span>
                <span className="ml-auto min-w-0 truncate pl-2 text-[11px] text-fg-mute">{relative(entry.ts)}</span>
              </button>
              <IconButton
                size="xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title={m('restoreSnapshot')}
                aria-label={m('restoreSnapshot')}
                onClick={() => void restore(entry)}
              >
                <RotateCcw className="h-3 w-3" />
              </IconButton>
              <IconButton
                size="xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title={m('deleteSnapshot')}
                aria-label={m('deleteSnapshot')}
                onClick={() => setToDelete(entry)}
              >
                <X className="h-3 w-3" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => { if (!o) setToDelete(null); }}
        title={m('deleteSnapshotTitle', { time: toDelete ? absoluteTime(toDelete.ts, locale) : '' })}
        description={m('deleteSnapshotDesc')}
        confirmLabel={m('delete')}
        onConfirm={async () => { if (path && toDelete) await store.deleteSnapshot(path, toDelete.id); }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={m('clearHistoryTitle', { n: entries.length, name: tab?.name ?? '' })}
        description={m('clearHistoryDesc')}
        confirmLabel={m('delete')}
        onConfirm={async () => { if (path) await store.clearHistory(path); }}
      />
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-[11px] leading-relaxed text-fg-mute">{children}</p>;
}
