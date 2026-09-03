// Dòng cấu hình — MỘT hình dạng, NHIỀU loại điều khiển.
//
// Học từ màn hình "Cài đặt tài khoản" của MoMo: hình dạng dòng cố định (icon ·
// tiêu đề · mô tả), còn phần bên phải đổi theo việc dòng đó làm:
//
//   chevron ›       mở màn/panel khác
//   toggle          bật/tắt tại chỗ — LUÔN xanh lá khi bật, không theo accent
//   chip trạng thái chỉ đọc
//   nút viền nhỏ    hành động một lần ("Nhập lại", "Cập nhật")
//   chip đổ xuống   chọn một giá trị gọn
//
// Năm loại, không loại nào cần component mới. Đây là pattern chính cho trang
// Settings và mọi bảng cấu hình của tool.
//
// Component chỉ dựng khung; điều khiển truyền vào qua `control`. Trường hợp
// chevron dùng nhiều nhất nên có sẵn `onOpen` để khỏi phải tự dựng.

import * as React from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SettingRowProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Điều khiển bên phải — Switch, StatusChip, Button, Select… */
  control?: React.ReactNode;
  /**
   * Biến cả dòng thành nút mở màn khác và hiện chevron. Loại trừ với `control`:
   * một dòng bấm được mà bên trong lại có điều khiển bấm được nữa là bẫy chuột.
   */
  onOpen?: () => void;
  disabled?: boolean;
  className?: string;
}

export function SettingRow({
  icon: Icon,
  title,
  description,
  control,
  onOpen,
  disabled,
  className,
}: SettingRowProps) {
  const interactive = Boolean(onOpen) && !disabled;

  const body = (
    <>
      {Icon && (
        <span
          className={cn(
            'grid h-ctl w-ctl shrink-0 place-items-center rounded-sm border border-line bg-sunk',
            'text-fg-mute',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{title}</span>
        {description && (
          <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-mute">
            {description}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {control}
        {interactive && <ChevronRight className="h-4 w-4 text-fg-mute/70" />}
      </span>
    </>
  );

  const shared = cn(
    'flex w-full items-center gap-3 px-3.5 py-3 text-left',
    'border-b border-line-soft last:border-b-0',
    disabled && 'pointer-events-none opacity-50',
    className,
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          shared,
          // Rê chuột đổi NỀN, không đổi vị trí — design/RULES.md.
          'transition-colors hover:bg-bg-2/40',
          'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={shared}>{body}</div>;
}

/**
 * Khung bao quanh một nhóm SettingRow. Đây là TẦNG NỔI duy nhất — các dòng bên
 * trong chỉ ngăn nhau bằng đường mảnh, không thẻ nào đổ bóng thêm.
 * Xem "chỉ một tầng được đổ bóng" trong design/RULES.md.
 */
export function SettingGroup({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-mute">
          {title}
        </h3>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-soft">
        {children}
      </div>
    </section>
  );
}
