// Bottom status bar for the active file: cursor position, language, line
// endings, encoding, word wrap. Only the cursor readout re-renders on typing.

import { WrapText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorStore, Tab } from './store';
import { useCursor } from './EditorPane';
import { relativeTo } from './paths';

export function StatusBar({ store, tab, wrap }: { store: EditorStore; tab: Tab | null; wrap: boolean }) {
  const m = useMessages(MESSAGES);
  const root = tab ? store.rootOf(tab.path) : null;
  const ready = tab?.status === 'ready';
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-line bg-chrome px-3 text-[11px] text-fg-mute">
      <span className="min-w-0 truncate" title={tab?.path}>
        {tab ? (root ? relativeTo(tab.path, root) || tab.name : tab.path) : ''}
      </span>
      {tab?.saving && <span className="flex items-center gap-1"><Spinner size="xs" />{m('saving')}</span>}
      <span className="ml-auto" />
      {ready && <CursorReadout store={store} />}
      {ready && <span>{tab.language ?? m('plainText')}</span>}
      {ready && <span>{tab.eol === '\r\n' ? 'CRLF' : 'LF'}</span>}
      {ready && <span>{tab.bom ? m('utf8Bom') : m('utf8')}</span>}
      <button
        type="button"
        onClick={() => store.toggleWrap()}
        title={wrap ? m('wrapOn') : m('wrapOff')}
        aria-pressed={wrap}
        className={cn(
          'flex items-center gap-1 rounded-xs px-1 transition-colors hover:bg-bg-2 hover:text-fg',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
          wrap && 'text-acc-ink',
        )}
      >
        <WrapText className="h-3 w-3" />
        <span className="sr-only">{wrap ? m('wrapOn') : m('wrapOff')}</span>
      </button>
    </div>
  );
}

function CursorReadout({ store }: { store: EditorStore }) {
  const m = useMessages(MESSAGES);
  const c = useCursor(store);
  return (
    <span className="tabular-nums">
      {m('lnCol', { line: c.line, col: c.col })}
      {c.selected > 0 && ` ${m('selected', { n: c.selected })}`}
    </span>
  );
}
