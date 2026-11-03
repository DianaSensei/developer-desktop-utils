// "Change Language Mode" — the palette VS Code opens from the language name
// in the status bar. Lists every grammar language-data knows, plus Auto
// Detect (back to file name / content guess) and Plain Text.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Keycap } from '@/components/ui/keycap';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import { PLAIN_TEXT, type EditorStore, type Tab } from './store';
import { listLanguageNames } from './languages';
import { formatterFor } from './format';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: EditorStore;
  tab: Tab | null;
}

const AUTO = '\u0000auto';

export function LanguagePicker({ open, onOpenChange, store, tab }: Props) {
  const m = useMessages(MESSAGES);
  const [names, setNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    void listLanguageNames().then(setNames);
  }, [open]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [AUTO, PLAIN_TEXT, ...names];
    if (!q) return all;
    const starts = all.filter((n) => n !== AUTO && n.toLowerCase().startsWith(q));
    const contains = all.filter((n) => n !== AUTO && !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [names, query]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const pick = (name: string) => {
    onOpenChange(false);
    if (tab) void store.setLanguage(tab.id, name === AUTO ? null : name).then(() => store.focusEditor());
  };

  const current = tab?.languageOverride ?? null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs duration-fast ease-out-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className={cn(
            'fixed left-1/2 top-[14%] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden',
            'rounded-lg border border-line glass-strong glass-sheen shadow-lift duration-base ease-out-soft',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{m('changeLanguage')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{m('languageSearch')}</DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b border-line px-3.5">
            <Search className="h-4 w-4 shrink-0 text-fg-mute/60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, rows.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); const r = rows[selected]; if (r) pick(r); }
              }}
              placeholder={m('languageSearch')}
              aria-label={m('changeLanguage')}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="h-ctl-lg w-full bg-transparent text-sm text-fg outline-hidden placeholder:text-fg-mute/60"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto p-1.5" role="listbox" aria-label={m('changeLanguage')}>
            {rows.length === 0 && <p className="px-2.5 py-6 text-center text-dense text-fg-mute">—</p>}
            {rows.map((name, i) => {
              const active = i === selected;
              const isCurrent = name === AUTO ? current === null : current === name;
              const fmt = name === AUTO || name === PLAIN_TEXT ? null : formatterFor(name);
              return (
                <button
                  key={name}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => pick(name)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                    active ? 'bg-acc-tint text-acc-ink' : 'text-fg hover:bg-bg-2/60',
                  )}
                >
                  <span className="font-medium">{name === AUTO ? m('autoDetect') : name}</span>
                  {name === AUTO && <span className="text-[11px] text-fg-mute">{m('autoDetectHint')}{tab?.language && !current ? ` — ${tab.language}` : ''}</span>}
                  {fmt && fmt.id !== 'reindent' && <span className="text-[11px] text-fg-mute">{fmt.label}</span>}
                  {isCurrent && <span className="ml-auto text-[11px] text-fg-mute">{m('current')}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[11px] text-fg-mute">
            <span className="flex items-center gap-1"><Keycap>↑</Keycap><Keycap>↓</Keycap></span>
            <span className="flex items-center gap-1"><Keycap>⏎</Keycap></span>
            <span className="ml-auto flex items-center gap-1"><Keycap>Esc</Keycap></span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
