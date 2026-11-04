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
import { Segmented } from '@/components/ui/segmented';
import {
  DEFAULT_APPEARANCE, EDITOR_FONTS, EDITOR_PADDINGS, EDITOR_SMOOTHING, EDITOR_THEMES, EDITOR_WEIGHTS,
  MAX_FONT_SIZE, MAX_LETTER_SPACING, MAX_LINE_HEIGHT, MIN_FONT_SIZE, MIN_LETTER_SPACING, MIN_LINE_HEIGHT,
  fontFamilyFor, type EditorAppearance, type EditorFont, type EditorWeight,
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

/** One labelled −/value/+ row. */
function Stepper({ label, value, display, min, max, step, onChange, lessLabel, moreLabel }: {
  label: string; value: number; display: string; min: number; max: number; step: number;
  onChange: (v: number) => void; lessLabel: string; moreLabel: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs">
      <span className="flex-1">{label}</span>
      <button type="button" className={STEP} disabled={value <= min} onClick={() => onChange(value - step)} title={lessLabel} aria-label={`${label}: ${lessLabel}`}>
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-10 text-center tabular-nums">{display}</span>
      <button type="button" className={STEP} disabled={value >= max} onClick={() => onChange(value + step)} title={moreLabel} aria-label={`${label}: ${moreLabel}`}>
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

const STEP = 'inline-flex h-6 w-6 items-center justify-center rounded-xs border border-line text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus';

/** "Aa": color theme, font, size, spacing and SQL hints, for every tab. */
function AppearanceMenu({ store, appearance: a }: { store: EditorStore; appearance: EditorAppearance }) {
  const m = useMessages(MESSAGES);
  const set = (patch: Partial<EditorAppearance>) => store.setAppearance(patch);
  const tick = (on: boolean) => (on ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />);
  const isDefault = (Object.keys(DEFAULT_APPEARANCE) as (keyof EditorAppearance)[])
    .every((k) => k === 'theme' || k === 'font' || k === 'hints' || a[k] === DEFAULT_APPEARANCE[k]);
  return (
    <DropdownMenu className="h-full">
      <DropdownMenuTrigger className={ITEM} title={m('appearance')} aria-label={m('appearance')}>
        <span className="font-medium">Aa</span>
        <span className="tabular-nums">{a.fontSize}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(80vh,640px)] w-80 overflow-y-auto p-1.5">
        <DropdownMenuLabel>{m('appearanceTheme')}</DropdownMenuLabel>
        {EDITOR_THEMES.map((theme) => (
          <DropdownMenuItem key={theme} icon={tick(a.theme === theme)} closeOnSelect={false} onClick={() => set({ theme })}>
            {theme === 'intellij' ? m('themeIntellij') : m('themeVscode')}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{m('appearanceFont')}</DropdownMenuLabel>
        {EDITOR_FONTS.map((font) => (
          <DropdownMenuItem key={font} icon={tick(a.font === font)} closeOnSelect={false} onClick={() => set({ font })}>
            <span style={{ fontFamily: fontFamilyFor(font) }}>{font === 'app' ? m('fontApp') : FONT_LABEL[font]}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{m('appearanceText')}</DropdownMenuLabel>
        <Stepper
          label={m('appearanceSize')} value={a.fontSize} display={`${a.fontSize}px`} min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1}
          onChange={(fontSize) => set({ fontSize })} lessLabel={m('fontSmaller')} moreLabel={m('fontLarger')}
        />
        <Stepper
          label={m('lineHeight')} value={a.lineHeight} display={a.lineHeight.toFixed(1)} min={MIN_LINE_HEIGHT} max={MAX_LINE_HEIGHT} step={0.1}
          onChange={(lineHeight) => set({ lineHeight })} lessLabel={m('less')} moreLabel={m('more')}
        />
        <Stepper
          label={m('letterSpacing')} value={a.letterSpacing} display={`${a.letterSpacing > 0 ? '+' : ''}${a.letterSpacing}`} min={MIN_LETTER_SPACING} max={MAX_LETTER_SPACING} step={0.25}
          onChange={(letterSpacing) => set({ letterSpacing })} lessLabel={m('less')} moreLabel={m('more')}
        />
        <ChoiceRow label={m('fontWeight')}>
          <Segmented
            size="sm"
            aria-label={m('fontWeight')}
            value={String(a.weight) as `${EditorWeight}`}
            onValueChange={(v) => set({ weight: Number(v) as EditorWeight })}
            options={EDITOR_WEIGHTS.map((w) => ({ value: String(w) as `${EditorWeight}`, label: m(WEIGHT_LABEL[w]) }))}
          />
        </ChoiceRow>
        <ChoiceRow label={m('smoothing')} title={m('smoothingHint')}>
          <Segmented
            size="sm"
            aria-label={m('smoothing')}
            value={a.smoothing}
            onValueChange={(smoothing) => set({ smoothing })}
            options={EDITOR_SMOOTHING.map((v) => ({ value: v, label: v === 'thin' ? m('smoothingThin') : m('smoothingFull') }))}
          />
        </ChoiceRow>
        <ChoiceRow label={m('padding')}>
          <Segmented
            size="sm"
            aria-label={m('padding')}
            value={a.padding}
            onValueChange={(padding) => set({ padding })}
            options={EDITOR_PADDINGS.map((v) => ({ value: v, label: m(PADDING_LABEL[v]) }))}
          />
        </ChoiceRow>
        <DropdownMenuItem
          icon={<span className="w-3.5" />}
          closeOnSelect={false}
          disabled={isDefault}
          className="disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => set({
            fontSize: DEFAULT_APPEARANCE.fontSize, lineHeight: DEFAULT_APPEARANCE.lineHeight, letterSpacing: DEFAULT_APPEARANCE.letterSpacing,
            weight: DEFAULT_APPEARANCE.weight, smoothing: DEFAULT_APPEARANCE.smoothing, padding: DEFAULT_APPEARANCE.padding,
          })}
        >
          {m('resetText')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={tick(a.hints)} closeOnSelect={false} onClick={() => set({ hints: !a.hints })}>
          {m('sqlHints')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const WEIGHT_LABEL = { 300: 'weightLight', 400: 'weightRegular', 500: 'weightMedium' } as const;
const PADDING_LABEL = { compact: 'paddingCompact', normal: 'paddingNormal', roomy: 'paddingRoomy' } as const;

function ChoiceRow({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs" title={title}>
      <span className="flex-1">{label}</span>
      {children}
    </div>
  );
}
