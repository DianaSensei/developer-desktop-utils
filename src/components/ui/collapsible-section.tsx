// Disclosure: a header row that toggles a body open and closed.
//
// About a dozen places implement this by hand — Settings' "App permissions" and
// "Configuration", the Date/Time tool's sections, RabbitMQ's connection-form
// "Advanced" and the RPC options, Kafka's left-panel consumer list, the API
// Client's request-body section. Every one of them re-decides whether the
// chevron points down-when-open or rotates from right, and whether the header
// text is uppercase.
//
// House rule encoded here: a single chevron that rotates (no icon swap, so the
// transition is animatable), pointing right when closed and down when open.
//
//   <CollapsibleSection title="Advanced" defaultOpen={false}>…</CollapsibleSection>
//
// Controlled when you need the open state elsewhere (persisted, or driven by a
// search hit):
//
//   <CollapsibleSection title="Ports" open={open} onOpenChange={setOpen}>…</CollapsibleSection>

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CollapsibleSectionProps {
  title: React.ReactNode;
  /** Muted aside after the title — "— vhost, heartbeat, CA" style. */
  hint?: React.ReactNode;
  /** Glyph before the title. */
  icon?: React.ReactNode;
  /** Controlled open state. Omit to let the section manage its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Right-aligned content in the header — counts, a badge, a small button. */
  actions?: React.ReactNode;
  /** `bordered` wraps the whole section in a card outline; `bare` is header + body only. */
  variant?: 'bare' | 'bordered';
  /** Uppercase micro-caption header instead of the default sentence-case label. */
  eyebrow?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  hint,
  icon,
  open: openProp,
  onOpenChange,
  defaultOpen = true,
  actions,
  variant = 'bare',
  eyebrow,
  className,
  headerClassName,
  bodyClassName,
  children,
}: CollapsibleSectionProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolled;

  const toggle = () => {
    if (openProp === undefined) setUncontrolled((v) => !v);
    onOpenChange?.(!open);
  };

  return (
    <div className={cn(variant === 'bordered' && 'rounded-lg border border-line px-3', className)}>
      <div className={cn('flex items-center gap-2', headerClassName)}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left transition-colors duration-fast ease-out-soft hover:text-fg',
            eyebrow
              ? 'text-xs font-semibold uppercase tracking-wide text-fg-mute'
              : 'text-sm font-medium text-fg',
          )}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-fg-mute transition-transform duration-base ease-spring',
              open && 'rotate-90',
            )}
          />
          {icon}
          <span className="truncate">{title}</span>
          {hint && <span className="truncate text-[11px] font-normal text-fg-mute/70">{hint}</span>}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {/* ── Mở ra / thu vào có chiều cao thật ────────────────────────────────
          Bản trước là `{open && …}`: nội dung XUẤT HIỆN và BIẾN MẤT tức thì,
          mọi thứ bên dưới giật một cái, trong khi mũi tên bên trên lại quay
          mượt. Nửa có chuyển động nửa không như vậy đọc ra tệ hơn hẳn so với
          việc cả hai cùng đứng im.

          Dùng thủ thuật `grid-template-rows: 0fr → 1fr`: trình duyệt nội suy
          được giữa hai giá trị đó, nên có được đúng thứ mà `height: auto`
          không cho — chiều cao co giãn theo nội dung mà vẫn animate được, và
          không phải đo bằng JS hay đặt `max-height` phỏng chừng (đặt hụt thì
          cắt mất nội dung, đặt thừa thì đoạn cuối của animation là khoảng
          trống trôi qua).

          Nội dung vẫn nằm trong DOM khi đóng, nên `hidden` được đặt cho trình
          đọc màn hình và bàn phím không Tab vào phần đang cuộn lại. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] ease-out-soft',
          // Luật 1: mở ra chậm hơn thu vào — xem `design/tokens.css`.
          open ? 'grid-rows-[1fr] duration-base' : 'grid-rows-[0fr] duration-exit',
        )}
      >
        <div className="overflow-hidden" inert={!open || undefined}>
          <div className={cn('pb-2', bodyClassName)}>{children}</div>
        </div>
      </div>
    </div>
  );
}
