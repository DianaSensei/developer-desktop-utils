import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { Layers, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allTools } from '@/lib/toolRegistry';
import { toolMatchesQuery } from '@/lib/toolSearch';
import { DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { detectClipboardIntent, type ClipboardIntent } from '@/lib/clipboardIntent';
import { readTextFromClipboard } from '@/lib/clipboard';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useWorkspaces, workspaceLabel } from '@/contexts/WorkspaceContext';
import type { Workspace } from '@/lib/workspaces';
import { StatusChip } from '@/components/ui/status-chip';
import { Keycap } from '@/components/ui/keycap';

type Tool = (typeof allTools)[number];

type Item =
  | { kind: 'tool'; tool: Tool; clipboard?: boolean }
  | { kind: 'workspace'; ws: Workspace; name: string }
  | { kind: 'newWorkspace'; name: string };

const OPEN_EVENT = 'devtool:open-command-palette';

/** Opens ⌘K from elsewhere in the shell (the workspace bar's "+"). */
export function requestCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * ⌘K command palette. Results on the left; a preview (description, keywords,
 * enabled state) on the right so users can confirm before pressing Enter.
 *
 * Manages its own open state with a global key listener. Render it once
 * inside <Router> and the app providers.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const [clipboardIntent, setClipboardIntent] = React.useState<ClipboardIntent | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const { isFeatureEnabled, toggleFeature, toolOrder } = useFeatures();
  const { t } = useLocale();
  const navigate = useNavigate();
  const { workspaces, active: activeWs, switchWorkspace, promptCreateWorkspace } = useWorkspaces();

  // ⌘K / Ctrl+K toggles from anywhere; other keys pass through.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    const onRequest = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_EVENT, onRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_EVENT, onRequest);
    };
  }, []);

  // On open: clear the query and read the clipboard once.
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    let cancelled = false;
    readTextFromClipboard().then((text) => {
      if (!cancelled) setClipboardIntent(detectClipboardIntent(text));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const rankOf = React.useMemo(() => {
    const order = toolOrder.length ? toolOrder : DEFAULT_TOOL_ORDER;
    const rank = new Map(order.map((id, i) => [id, i]));
    return (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  }, [toolOrder]);

  // With a query: matches. Without: every tool in sidebar order.
  const results = React.useMemo(() => {
    if (query.trim()) return allTools.filter((tool) => toolMatchesQuery(tool, query));
    return [...allTools].sort((a, b) => rankOf(a.featureId) - rankOf(b.featureId));
  }, [query, rankOf]);

  // The clipboard suggestion only shows when not searching.
  const clipboardTool: Tool | null =
    !query.trim() && clipboardIntent
      ? allTools.find((tl) => tl.featureId === clipboardIntent.toolId) ?? null
      : null;

  // Other workspaces: first when the query is empty, matched by name
  // otherwise.
  const workspaceItems: Item[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: Item[] = workspaces
      .map((ws, i) => ({ ws, name: workspaceLabel(ws, i, (n) => t('shell.workspace.defaultName', { n })) }))
      .filter(({ ws, name }) => ws.id !== activeWs.id && (!q || name.toLowerCase().includes(q)))
      .map(({ ws, name }) => ({ kind: 'workspace' as const, ws, name }));
    // "New workspace" command: the workspace menu only appears with 2+
    // tabs, so ⌘K is the other way in.
    const newLabel = t('shell.workspace.new');
    const wantsNew = !!q && (newLabel.toLowerCase().includes(q) || 'workspace'.includes(q) || q.includes('workspace'));
    return wantsNew ? [...list, { kind: 'newWorkspace' as const, name: newLabel }] : list;
  }, [workspaces, activeWs.id, query, t]);

  const items: Item[] = [
    ...(clipboardTool ? [{ kind: 'tool' as const, tool: clipboardTool, clipboard: true }] : []),
    ...workspaceItems,
    ...results.map((tool) => ({ kind: 'tool' as const, tool })),
  ];
  const activeItem = items[selected] ?? null;

  React.useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const select = React.useCallback(
    (tool: Tool) => {
      if (!isFeatureEnabled(tool.featureId)) toggleFeature(tool.featureId);
      navigate(tool.path);
      setOpen(false);
    },
    [isFeatureEnabled, toggleFeature, navigate],
  );

  const pick = (item: Item) => {
    if (item.kind === 'tool') {
      select(item.tool);
    } else if (item.kind === 'workspace') {
      switchWorkspace(item.ws.id);
      setOpen(false);
    } else {
      setOpen(false);
      promptCreateWorkspace();
    }
  };

  function onQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeItem) pick(activeItem);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs duration-fast ease-out-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            'fixed left-1/2 top-[14%] z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden',
            'rounded-lg border border-line glass-strong glass-sheen shadow-lift duration-base ease-out-soft',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t('palette.title')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t('palette.placeholder')}
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2 border-b border-line px-3.5">
            <Search className="h-4 w-4 shrink-0 text-fg-mute/60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(0);
              }}
              onKeyDown={onQueryKeyDown}
              placeholder={t('palette.placeholder')}
              className="h-ctl-lg w-full bg-transparent text-sm text-fg outline-hidden placeholder:text-fg-mute/60"
            />
          </div>

          <div className="flex h-[380px]">
            <div className="w-[56%] shrink-0 overflow-y-auto border-r border-line p-1.5">
              {items.length === 0 && (
                <p className="px-2.5 py-8 text-center text-dense text-fg-mute">
                  {t('palette.empty', { query })}
                </p>
              )}

              {items.map((item, index) => {
                const refCb = (el: HTMLButtonElement | null) => {
                  itemRefs.current[index] = el;
                };
                if (item.kind === 'workspace' || item.kind === 'newWorkspace') {
                  const isWs = (it?: Item) => it?.kind === 'workspace' || it?.kind === 'newWorkspace';
                  const first = index === 0 || !isWs(items[index - 1]);
                  const last = !isWs(items[index + 1]);
                  return (
                    <div key={item.kind === 'workspace' ? item.ws.id : 'new-workspace'} className={cn(last && 'mb-1.5 border-b border-line-soft pb-1.5')}>
                      {first && (
                        <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
                          {t('palette.section.workspaces')}
                        </p>
                      )}
                      <WorkspaceRow
                        name={item.name}
                        count={item.kind === 'workspace' ? item.ws.toolIds.length : null}
                        active={selected === index}
                        onHover={() => setSelected(index)}
                        onPick={() => pick(item)}
                        refCb={refCb}
                      />
                    </div>
                  );
                }
                if (item.clipboard && clipboardIntent) {
                  return (
                    <div key={`clip-${item.tool.featureId}`} className="mb-1.5 border-b border-line-soft pb-1.5">
                      <ClipboardRow
                        tool={item.tool}
                        reasonKey={clipboardIntent.reasonKey}
                        active={selected === index}
                        onHover={() => setSelected(index)}
                        onPick={() => pick(item)}
                        refCb={refCb}
                      />
                    </div>
                  );
                }
                return (
                  <ToolRow
                    key={item.tool.featureId}
                    tool={item.tool}
                    active={selected === index}
                    enabled={isFeatureEnabled(item.tool.featureId)}
                    disabledHint={t('palette.disabledHint')}
                    onHover={() => setSelected(index)}
                    onPick={() => pick(item)}
                    refCb={refCb}
                  />
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeItem?.kind === 'tool' ? (
                <Preview
                  tool={activeItem.tool}
                  enabled={isFeatureEnabled(activeItem.tool.featureId)}
                  disabledHint={t('palette.disabledHint')}
                />
              ) : activeItem?.kind === 'workspace' ? (
                <WorkspacePreview ws={activeItem.ws} name={activeItem.name} />
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
            <span className="flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>↑</Keycap>
              <Keycap>↓</Keycap> {t('palette.footer.navigate')}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>⏎</Keycap> {t('palette.footer.select')}
            </span>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-fg-mute">
              <Keycap>Esc</Keycap> {t('palette.footer.close')}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ToolRow({
  tool,
  active,
  enabled,
  disabledHint,
  onHover,
  onPick,
  refCb,
}: {
  tool: Tool;
  active: boolean;
  enabled: boolean;
  disabledHint: string;
  onHover: () => void;
  onPick: () => void;
  refCb: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = tool.icon;
  return (
    <button
      ref={refCb}
      type="button"
      onClick={onPick}
      onMouseEnter={onHover}
      title={!enabled ? disabledHint : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors',
        active ? 'bg-acc-tint text-acc-ink' : 'text-fg hover:bg-bg-2/50',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-acc-ink' : 'text-fg-mute')} />
      <span className="min-w-0 flex-1 truncate">{tool.label}</span>
      {!enabled && (
        <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-fg-mute/40" aria-hidden />
      )}
    </button>
  );
}

function ClipboardRow({
  tool,
  reasonKey,
  active,
  onHover,
  onPick,
  refCb,
}: {
  tool: Tool;
  reasonKey: Parameters<ReturnType<typeof useLocale>['t']>[0];
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  refCb: (el: HTMLButtonElement | null) => void;
}) {
  const { t } = useLocale();
  const Icon = tool.icon;
  return (
    <button
      ref={refCb}
      type="button"
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full flex-col gap-1 rounded-sm px-2.5 py-2 text-left transition-colors',
        active ? 'bg-acc-tint' : 'hover:bg-bg-2/50',
      )}
    >
      <span className="flex items-center gap-2.5">
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-acc-ink' : 'text-fg-mute')} />
        <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', active && 'text-acc-ink')}>
          {tool.label}
        </span>
        <StatusChip tone="info" hidePip className="shrink-0">
          {t('palette.clipboardHint')}
        </StatusChip>
      </span>
      <span className="truncate pl-[26px] text-xs text-fg-mute">{t(reasonKey)}</span>
    </button>
  );
}

function Preview({
  tool,
  enabled,
  disabledHint,
}: {
  tool: Tool;
  enabled: boolean;
  disabledHint: string;
}) {
  const Icon = tool.icon;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-ctl w-ctl shrink-0 place-items-center rounded-sm border border-line bg-sunk">
          <Icon className="h-4 w-4 text-acc-ink" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{tool.label}</h3>
          {!enabled && (
            <StatusChip tone="idle" className="mt-1">
              {disabledHint}
            </StatusChip>
          )}
        </div>
      </div>
      {tool.description && (
        <p className="text-dense leading-relaxed text-fg-mute">{tool.description}</p>
      )}
      {tool.keywords && tool.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tool.keywords.slice(0, 8).map((k) => (
            <span
              key={k}
              className="rounded-xs bg-bg-2 px-1.5 py-0.5 text-[11px] text-fg-mute"
            >
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceRow({
  name,
  count,
  active,
  onHover,
  onPick,
  refCb,
}: {
  name: string;
  /** `null` for the "New workspace…" command row. */
  count: number | null;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  refCb: (el: HTMLButtonElement | null) => void;
}) {
  const { t } = useLocale();
  return (
    <button
      ref={refCb}
      type="button"
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors',
        active ? 'bg-acc-tint text-acc-ink' : 'text-fg hover:bg-bg-2/50',
      )}
    >
      <Layers className={cn('h-4 w-4 shrink-0', active ? 'text-acc-ink' : 'text-fg-mute')} />
      <span className="min-w-0 flex-1 truncate">
        {count !== null && <span className="text-fg-mute">{t('palette.workspace.switch')} </span>}
        {name}
      </span>
      {count !== null && <span className="shrink-0 text-[11px] text-fg-mute">{t('shell.workspace.tabCount', { n: count })}</span>}
    </button>
  );
}

function WorkspacePreview({ ws, name }: { ws: Workspace; name: string }) {
  const { t } = useLocale();
  const tools = ws.toolIds
    .map((id) => allTools.find((tool) => tool.featureId === id))
    .filter((tool): tool is Tool => !!tool);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-ctl w-ctl shrink-0 place-items-center rounded-sm border border-line bg-sunk">
          <Layers className="h-4 w-4 text-acc-ink" />
        </span>
        <h3 className="min-w-0 truncate text-sm font-semibold">{name}</h3>
      </div>
      {tools.length === 0 ? (
        <p className="text-dense text-fg-mute">{t('palette.workspace.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <li key={tool.featureId} className="flex items-center gap-2 text-dense text-fg-mute">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tool.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
