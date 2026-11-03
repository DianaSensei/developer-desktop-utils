// Settings → Keyboard Shortcuts → "Open a tool": assign, change or remove the
// combo that opens each tool from anywhere (GlobalToolShortcuts.tsx). Click
// Set, press the keys; invalid or reserved combos are explained in place.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import { useFeatures } from '@/contexts/FeatureContext';
import { allTools } from '@/lib/toolRegistry';
import { toolMatchesQuery } from '@/lib/toolSearch';
import { IS_MAC } from '@/lib/platform';
import {
  assignShortcut, checkCombo, comboFromEvent, comboKeys, parseCombo, serializeCombo, type ComboCheck,
} from '@/lib/toolShortcuts';
import { RECORDER_ATTR, useToolShortcuts } from './GlobalToolShortcuts';
import MESSAGES from './ToolShortcutSettings.messages';

type Translate = ReturnType<typeof useMessages<typeof MESSAGES>>;

interface Note {
  toolId: string;
  tone: 'bad' | 'warn' | 'info';
  text: string;
}

const toolLabel = (id: string) => allTools.find((t) => t.featureId === id)?.label ?? id;

function errorText(check: Exclude<ComboCheck, { ok: true }>, m: Translate): string {
  if (check.reason === 'reserved') return m(`err.reserved.${check.detail}` as 'err.reserved.editing');
  return m(`err.${check.reason}` as 'err.key');
}

export function ToolShortcutSettings() {
  const m = useMessages(MESSAGES);
  const [map, setMap] = useToolShortcuts();
  const { isFeatureEnabled, toolOrder } = useFeatures();
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const tools = useMemo(() => {
    const rank = new Map(toolOrder.map((id, i) => [id, i]));
    return allTools
      .filter((t) => !query.trim() || toolMatchesQuery(t, query))
      .sort((a, b) => (rank.get(a.featureId) ?? 999) - (rank.get(b.featureId) ?? 999));
  }, [query, toolOrder]);
  const assignedCount = Object.keys(map).length;
  const listRef = useRef<HTMLUListElement>(null);

  // A note under the last visible row would sit below the scroll edge.
  useEffect(() => {
    if (!note) return;
    listRef.current?.querySelector(`[data-tool-row="${note.toolId}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [note]);

  const stop = () => { setRecording(null); setHeld([]); };

  const onRecordKey = (toolId: string, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.key === 'Escape' && plain) { stop(); return; }
    if (e.key === 'Tab' && plain) { stop(); return; }
    const combo = comboFromEvent(e.nativeEvent);
    if (!combo) {
      // Only modifiers so far: show them as they are held.
      setHeld(comboKeys({ mod: IS_MAC ? e.metaKey : e.ctrlKey, ctrl: IS_MAC && e.ctrlKey, alt: e.altKey, shift: e.shiftKey, code: '' }).slice(0, -1));
      return;
    }
    const check = checkCombo(combo);
    if (!check.ok) {
      setNote({ toolId, tone: 'bad', text: errorText(check, m) });
      setHeld([]);
      return;
    }
    const { map: next, displaced } = assignShortcut(map, toolId, serializeCombo(combo));
    setMap(next);
    stop();
    if (displaced) setNote({ toolId, tone: 'info', text: m('displaced', { tool: toolLabel(displaced) }) });
    else if (check.overlaps.length) {
      const o = check.overlaps[0];
      setNote({ toolId, tone: 'warn', text: m('overlap', { tool: toolLabel(o.toolId), action: o.action }) });
    } else setNote(null);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{m('title')}</p>
          <p className="mt-0.5 text-[11px] text-fg-mute">{m('description')}</p>
        </div>
        {assignedCount > 0 && (
          <Button variant="ghost" size="sm" className="text-xs text-fg-mute" onClick={() => setConfirmClear(true)}>
            {m('clearAll')}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder={m('search')} aria-label={m('search')} containerClassName="flex-1" clearable />
        {assignedCount > 0 && <span className="shrink-0 text-[11px] text-fg-mute">{m('assigned', { n: assignedCount })}</span>}
      </div>
      <ul ref={listRef} className="max-h-[420px] divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {tools.length === 0 && <li className="px-4 py-3 text-xs text-fg-mute">{m('none')}</li>}
        {tools.map((tool) => {
          const Icon = tool.icon;
          const combo = map[tool.featureId] ? parseCombo(map[tool.featureId]) : null;
          const isRecording = recording === tool.featureId;
          const rowNote = note?.toolId === tool.featureId ? note : null;
          const off = tool.featureId !== 'settings' && !isFeatureEnabled(tool.featureId);
          return (
            <li key={tool.featureId} data-tool-row={tool.featureId} className="px-4 py-2">
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 shrink-0 text-acc" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {tool.label}
                  {off && <span className="ml-1.5 text-[11px] text-fg-mute">· {m('off')}</span>}
                </span>
                {isRecording ? (
                  <button
                    type="button"
                    autoFocus
                    {...{ [RECORDER_ATTR]: '' }}
                    aria-label={m('recordAria', { tool: tool.label })}
                    onKeyDown={(e) => onRecordKey(tool.featureId, e)}
                    onKeyUp={(e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) setHeld([]); }}
                    onBlur={stop}
                    className="flex h-ctl min-w-[180px] items-center justify-between gap-2 rounded-sm border border-acc bg-acc-tint px-2.5 text-[11px] text-acc-ink ring-[3px] ring-focus focus-visible:outline-hidden"
                  >
                    <span className="flex items-center gap-0.5">
                      {held.length ? held.map((k) => <Cap key={k}>{k}</Cap>) : m('recording')}
                    </span>
                    <span className="text-fg-mute">{m('recordingHint')}</span>
                  </button>
                ) : (
                  <>
                    {combo && <span className="flex items-center gap-0.5">{comboKeys(combo).map((k) => <Cap key={k}>{k}</Cap>)}</span>}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      aria-label={m('recordAria', { tool: tool.label })}
                      onClick={() => { setNote(null); setRecording(tool.featureId); }}
                    >
                      {combo ? m('change') : m('set')}
                    </Button>
                    {combo && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-fg-mute"
                        title={m('clear')}
                        aria-label={`${m('clear')}: ${tool.label}`}
                        onClick={() => { setMap(assignShortcut(map, tool.featureId, null).map); setNote(null); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </>
                )}
              </div>
              {rowNote && (
                <p
                  role={rowNote.tone === 'bad' ? 'alert' : 'status'}
                  className={cn('mt-1 pl-7 text-[11px]', rowNote.tone === 'bad' && 'text-bad', rowNote.tone === 'warn' && 'text-warn', rowNote.tone === 'info' && 'text-fg-mute')}
                >
                  {rowNote.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={m('clearAllTitle')}
        description={m('clearAllBody')}
        confirmLabel={m('clearAll')}
        onConfirm={() => { setMap({}); setNote(null); }}
      />
    </div>
  );
}

function Cap({ children }: { children: string }) {
  return <kbd className="rounded-xs border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[11px] text-fg">{children}</kbd>;
}
