import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: LucideIcon;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * Pill / segmented toggle — the canonical mode-switch control for tools.
 *
 * ── Vì sao mục đang chọn là NỀN ĐẶC màu accent ──────────────────────────────
 * Bản trước dùng thẻ trắng (`bg-card`) trên nền xám nhạt (`bg-bg-2`). Trong
 * bảng màu mới hai màu đó gần nhau, nên tương phản gần bằng không — nhìn không
 * ra đang chọn cái nào. Nền đặc + chữ nghịch đảo thì không thể nhầm được, ở cả
 * light lẫn dark, ở cả bốn tone accent.
 *
 * ── Máng lõm ────────────────────────────────────────────────────────────────
 * Máng dùng `bg-sunk` + bóng inset để đọc ra là một RÃNH mà con trượt chạy
 * trong đó. Nếu máng phẳng ngang mặt nền, mục đang chọn trông như một nút rời
 * bay lơ lửng chứ không phải một lựa chọn trong nhóm.
 *
 * ── Con trượt CÓ THẬT, và nó TRƯỢT ──────────────────────────────────────────
 * Bản trước gọi cái rãnh là "máng mà con trượt chạy trong đó" nhưng lại không
 * có con trượt nào: nền accent chỉ TẮT ở mục cũ và BẬT ở mục mới, cách nhau cả
 * chiều rộng control. Cái tên hứa một thứ mà mắt không thấy, và người dùng mất
 * luôn thông tin "vừa đi từ đâu sang đâu" — thứ duy nhất mà chuyển động ở một
 * bộ chọn cần nói.
 *
 * Giờ có đúng MỘT ô nền accent nằm dưới các nút, được đo theo nút đang chọn và
 * dịch bằng `transform` (không phải `left`, để không gây reflow mỗi khung
 * hình). Chữ vẫn đổi màu trong `--dur-fast`, con trượt đi trong `--dur-base`
 * bằng `--ease-spring`.
 *
 * Lần render đầu con trượt được đặt KHÔNG có transition (`ready`), nếu không
 * nó sẽ bay từ mép trái sang mục đang chọn ngay khi mở trang — một chuyển động
 * chẳng kể chuyện gì vì người dùng chưa làm gì cả.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  ...props
}: SegmentedProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));

  // Vị trí + bề rộng con trượt, đo từ nút đang chọn. `ready` phân biệt lần đặt
  // đầu tiên (nhảy thẳng vào chỗ) với các lần đổi sau (trượt).
  const [thumb, setThumb] = React.useState<{ x: number; w: number } | null>(null);
  const ready = React.useRef(false);

  React.useLayoutEffect(() => {
    const track = trackRef.current;
    const el = refs.current[activeIndex];
    if (!track || !el) return;
    const measure = () => {
      // `offsetLeft` là toạ độ so với máng (máng có `position: relative`), nên
      // không phải gọi getBoundingClientRect hai lần và trừ cho nhau.
      setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Nhãn đổi (đổi ngôn ngữ, badge hiện ra) hoặc panel co lại thì bề rộng nút
    // đổi theo — con trượt phải đo lại, nếu không nó lệch khỏi nút.
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    for (const b of refs.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  React.useEffect(() => {
    if (thumb) {
      const id = requestAnimationFrame(() => { ready.current = true; });
      return () => cancelAnimationFrame(id);
    }
  }, [thumb]);

  /**
   * `role="tablist"` HỨA điều hướng bằng mũi tên; trước đây component không cài
   * gì cả nên mỗi segment là một tab-stop riêng — trái hẳn với kỳ vọng của
   * trình đọc màn hình. Giờ chỉ mục đang chọn nhận Tab (roving tabindex), còn
   * mũi tên/Home/End di chuyển giữa các mục.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = activeIndex === last ? 0 : activeIndex + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = activeIndex === 0 ? last : activeIndex - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  }

  const trackH = size === 'sm' ? 'h-ctl' : 'h-ctl';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={props['aria-label']}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-sm border border-line bg-sunk p-0.5',
        'shadow-[inset_0_1px_2px_hsl(var(--fg-c)/0.05)]',
        trackH,
        className
      )}
    >
      {thumb && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0.5 left-0 rounded-xs bg-acc shadow-soft',
            ready.current && 'motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-spring',
          )}
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((opt, i) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={opt.title}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={onKeyDown}
            className={cn(
              // `relative` + `z-10`: chữ nằm TRÊN con trượt, không bị nó phủ.
              'relative z-10 inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xs px-3',
              'transition-colors duration-fast ease-out-soft',
              // Vòng focus vẽ VÀO TRONG (offset âm) để không bị máng cắt mất —
              // trước đây component không có focus-visible nào, người dùng bàn
              // phím không thấy mình đang ở đâu.
              'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
              textSize,
              active
                ? 'font-semibold text-acc-fg'
                : 'font-medium text-fg-mute hover:text-fg'
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
