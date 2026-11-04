// Bottom status bar for the active file, VS Code's layout: path on the left;
// on the right cursor position, indentation (click: spaces/tabs, size,
// re-detect), line endings, encoding, language (click: Change Language Mode),
// formatter (click: Format Document, Format on Save) and word wrap. Only the
// cursor readout re-renders on typing.

import { Check, Minus, Plus, WrapText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IS_MAC } from '@/components/ui/keycap';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './WorkspaceEditor.messages';
import type { EditorStore, Tab } from './store';
import { useCursor } from './EditorPane';
import { relativeTo } from './paths';
import { formatterFor } from './format';
import {
  DEFAULT_APPEARANCE, EDITOR_FONTS, EDITOR_THEMES, MAX_FONT_SIZE, MIN_FONT_SIZE, fontFamilyFor,
  type EditorAppearance, type EditorFont,
} from './appearance';

interface Props {
  store: EditorStore;
  tab: Tab | null;
  wrap: boolean;
  formatOnSave: boolean;
  appearance: EditorAppearance;
  onFormat: () => void;
  onChangeLanguage: () => void;
}

const ITEM = cn(
  'flex h-full items-center gap-1 rounded-xs px-1.5 transition-colors hover:bg-bg-2 hover:text-fg',
  'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
);

export function StatusBar({ store, tab, wrap, formatOnSave, appearance, onFormat, onChangeLanguage }: Props) {
  const m = useMessages(MESSAGES);
  const root = tab ? store.rootOf(tab.path) : null;
  const viewer = tab?.mode === 'viewer';
  const ready = tab?.status === 'ready' && !viewer;
  const fmt = ready ? formatterFor(tab.language) : null;
  const formatKeys = IS_MAC ? '⇧⌥F' : 'Shift+Alt+F';
  return (
    <div className="flex h-6 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap border-t border-line bg-chrome px-2 text-[11px] text-fg-mute">
      <span className="min-w-0 truncate px-1" title={tab?.kind === 'untitled' ? m('untitledHint') : tab?.path}>
        {tab?.kind === 'untitled'
          ? <>{tab.name} <span className="text-fg-mute/80">· {m('untitledHint')}</span></>
          : tab ? (root ? relativeTo(tab.path, root) || tab.name : tab.path) : ''}
      </span>
      {tab?.saving && <span className="flex items-center gap-1"><Spinner size="xs" />{m('saving')}</span>}
      <span className="ml-auto" />
      {viewer && <span className="px-1">{m('viewerReadOnly')}</span>}
      {ready && <CursorReadout store={store} />}
      {ready && (
        <DropdownMenu className="h-full">
          <DropdownMenuTrigger className={ITEM} title={m('indentUsingSpaces')}>
            {tab.indent.useTabs ? m('tabSize', { n: tab.indent.size }) : m('spaces', { n: tab.indent.size })}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-1.5">
            {[false, true].map((useTabs) => (
              <DropdownMenuItem
                key={String(useTabs)}
                icon={tab.indent.useTabs === useTabs ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                onClick={() => store.setIndent(tab.id, { useTabs, size: tab.indent.size })}
              >
                {useTabs ? m('indentUsingTabs') : m('indentUsingSpaces')}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {[2, 4, 8].map((size) => (
              <DropdownMenuItem
                key={size}
                icon={tab.indent.size === size ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                onClick={() => store.setIndent(tab.id, { useTabs: tab.indent.useTabs, size })}
              >
                {m('indentSize', { n: size })}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<span className="w-3.5" />} onClick={() => store.setIndent(tab.id, null)}>
              {m('detectIndent')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {ready && <span className="px-1">{tab.eol === '\r\n' ? 'CRLF' : 'LF'}</span>}
      {ready && <span className="px-1">{tab.bom ? m('utf8Bom') : m('utf8')}</span>}
      {ready && (
        <button type="button" className={ITEM} title={m('changeLanguage')} onClick={onChangeLanguage}>
          {tab.language ?? m('plainText')}
        </button>
      )}
      {fmt && (
        <DropdownMenu className="h-full">
          <DropdownMenuTrigger className={ITEM} title={m('formatter', { name: fmt.label })}>
            {formatOnSave && <Check className="h-3 w-3" />}
            {fmt.label}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 p-1.5">
            <DropdownMenuItem icon={<span className="w-3.5" />} onClick={onFormat}>
              <span className="flex-1">{m('formatDocument')}</span>
              <span className="ml-4 text-[11px] text-fg-mute">{formatKeys}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={formatOnSave ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
              onClick={() => store.setFormatOnSave(!formatOnSave)}
            >
              {m('formatOnSave')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AppearanceMenu store={store} appearance={appearance} />
      <button
        type="button"
        onClick={() => store.toggleWrap()}
        title={wrap ? m('wrapOn') : m('wrapOff')}
        aria-pressed={wrap}
        className={cn(ITEM, wrap && 'text-acc-ink')}
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
    <span className="px-1 tabular-nums">
      {m('lnCol', { line: c.line, col: c.col })}
      {c.selected > 0 && ` ${m('selected', { n: c.selected })}`}
    </span>
  );
}

const FONT_LABEL: Record<Exclude<EditorFont, 'app'>, string> = {
  'jetbrains-mono': 'JetBrains Mono',
  'ibm-plex-mono': 'IBM Plex Mono',
  'fira-code': 'Fira Code',
};

/** "Aa": color theme, font, size and SQL hints, for every tab. */
function AppearanceMenu({ store, appearance: a }: { store: EditorStore; appearance: EditorAppearance }) {
  const m = useMessages(MESSAGES);
  const tick = (on: boolean) => (on ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />);
  const step = 'inline-flex h-6 w-6 items-center justify-center rounded-xs border border-line text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus';
  return (
    <DropdownMenu className="h-full">
      <DropdownMenuTrigger className={ITEM} title={m('appearance')} aria-label={m('appearance')}>
        <span className="font-medium">Aa</span>
        <span className="tabular-nums">{a.fontSize}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-1.5">
        <DropdownMenuLabel>{m('appearanceTheme')}</DropdownMenuLabel>
        {EDITOR_THEMES.map((theme) => (
          <DropdownMenuItem key={theme} icon={tick(a.theme === theme)} closeOnSelect={false} onClick={() => store.setAppearance({ theme })}>
            {theme === 'intellij' ? m('themeIntellij') : m('themeVscode')}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{m('appearanceFont')}</DropdownMenuLabel>
        {EDITOR_FONTS.map((font) => (
          <DropdownMenuItem key={font} icon={tick(a.font === font)} closeOnSelect={false} onClick={() => store.setAppearance({ font })}>
            <span style={{ fontFamily: fontFamilyFor(font) }}>{font === 'app' ? m('fontApp') : FONT_LABEL[font]}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs">
          <span className="flex-1">{m('appearanceSize')}</span>
          <button type="button" className={step} disabled={a.fontSize <= MIN_FONT_SIZE} onClick={() => store.setAppearance({ fontSize: a.fontSize - 1 })} title={m('fontSmaller')} aria-label={m('fontSmaller')}>
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-7 text-center tabular-nums">{a.fontSize}</span>
          <button type="button" className={step} disabled={a.fontSize >= MAX_FONT_SIZE} onClick={() => store.setAppearance({ fontSize: a.fontSize + 1 })} title={m('fontLarger')} aria-label={m('fontLarger')}>
            <Plus className="h-3 w-3" />
          </button>
          <button type="button" className={cn(step, 'w-auto px-1.5 text-[11px]')} disabled={a.fontSize === DEFAULT_APPEARANCE.fontSize} onClick={() => store.setAppearance({ fontSize: DEFAULT_APPEARANCE.fontSize })}>
            {m('fontReset')}
          </button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={tick(a.hints)} closeOnSelect={false} onClick={() => store.setAppearance({ hints: !a.hints })}>
          {m('sqlHints')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
