import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allTools } from '@/lib/toolRegistry';
import { toolMatchesQuery } from '@/lib/toolSearch';
import { DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { detectClipboardIntent, type ClipboardIntent } from '@/lib/clipboardIntent';
import { readTextFromClipboard } from '@/lib/clipboard';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale } from '@/contexts/LocaleContext';
import { StatusChip } from '@/components/ui/status-chip';
import { Keycap } from '@/components/ui/keycap';

type Tool = (typeof allTools)[number];

/**
 * ⌘K — trung tâm điều hướng của app.
 *
 * Hai cột: danh sách khớp truy vấn bên trái, xem trước (mô tả + từ khoá + trạng
 * thái bật/tắt) bên phải. Đây là điểm khác Spotlight/Alfred — palette thường chỉ
 * có một cột, nhưng DevTool có 24 tool với mô tả dài, nên xem trước giúp người
 * dùng chắc chắn trước khi Enter thay vì đoán qua nhãn.
 *
 * Tự quản lý trạng thái mở/đóng qua listener bàn phím toàn cục — không cần App
 * truyền `open` xuống. Chỉ cần render `<CommandPalette />` một lần, ở đâu cũng
 * được miễn trong <Router> (cần useNavigate) và trong mọi provider (cần
 * useFeatures/useLocale).
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

  // ⌘K / Ctrl+K mở-đóng, hoạt động bất kể đang focus ở đâu — đúng kỳ vọng của
  // một command palette. Không chặn phím khác nên không đụng shortcut của tool.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Mỗi lần mở: xoá truy vấn cũ, đọc lại clipboard. Đọc MỘT LẦN lúc mở, không
  // theo dõi liên tục — palette không cần biết clipboard đổi trong lúc đang mở.
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

  // Gõ gì đó → khớp truy vấn. Để trống → toàn bộ tool theo thứ tự sidebar, để
  // palette dùng được cả lúc chỉ muốn NHẢY tới một tool đã biết vị trí quen.
  const results = React.useMemo(() => {
    if (query.trim()) return allTools.filter((tool) => toolMatchesQuery(tool, query));
    return [...allTools].sort((a, b) => rankOf(a.featureId) - rankOf(b.featureId));
  }, [query, rankOf]);

  // Gợi ý clipboard chỉ hiện khi KHÔNG tìm kiếm — gõ gì đó nghĩa là người dùng
  // đã biết mình cần gì, gợi ý lúc đó chỉ vướng chân.
  const clipboardTool: Tool | null =
    !query.trim() && clipboardIntent
      ? allTools.find((tl) => tl.featureId === clipboardIntent.toolId) ?? null
      : null;

  const items = clipboardTool ? [clipboardTool, ...results] : results;
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

  function onQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeItem) select(activeItem);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            'fixed left-1/2 top-[14%] z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden',
            'rounded-lg border border-line/70 glass-strong glass-sheen shadow-lift',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
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
              className="h-ctl-lg w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-mute/60"
            />
          </div>

          <div className="flex h-[380px]">
            <div className="w-[56%] shrink-0 overflow-y-auto border-r border-line p-1.5">
              {items.length === 0 && (
                <p className="px-2.5 py-8 text-center text-[13px] text-fg-mute">
                  {t('palette.empty', { query })}
                </p>
              )}

              {clipboardTool && clipboardIntent && (
                <div className="mb-1.5 border-b border-line-soft pb-1.5">
                  <ClipboardRow
                    tool={clipboardTool}
                    reasonKey={clipboardIntent.reasonKey}
                    active={selected === 0}
                    onHover={() => setSelected(0)}
                    onPick={() => select(clipboardTool)}
                    refCb={(el) => {
                      itemRefs.current[0] = el;
                    }}
                  />
                </div>
              )}

              {results.map((tool, i) => {
                const index = clipboardTool ? i + 1 : i;
                return (
                  <ToolRow
                    key={tool.featureId}
                    tool={tool}
                    active={selected === index}
                    enabled={isFeatureEnabled(tool.featureId)}
                    disabledHint={t('palette.disabledHint')}
                    onHover={() => setSelected(index)}
                    onPick={() => select(tool)}
                    refCb={(el) => {
                      itemRefs.current[index] = el;
                    }}
                  />
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeItem ? (
                <Preview
                  tool={activeItem}
                  enabled={isFeatureEnabled(activeItem.featureId)}
                  disabledHint={t('palette.disabledHint')}
                />
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
      <span className="truncate pl-[26px] text-[12px] text-fg-mute">{t(reasonKey)}</span>
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
        <p className="text-[13px] leading-relaxed text-fg-mute">{tool.description}</p>
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
