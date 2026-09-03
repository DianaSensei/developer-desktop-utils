import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Khối chờ có hình dạng — thay cho một cái spinner đặt giữa panel trống.
 *
 * ── Vì sao cần, khi đã có `<Spinner>` ───────────────────────────────────────
 * `docs/ai` và `.claude/skills/taste-skill` đều đặt ra bốn trạng thái bắt buộc
 * cho mọi khung dữ liệu: đang tải / rỗng / lỗi / có dữ liệu. Trong app hiện
 * tại, "đang tải" ở hầu hết mọi nơi là `<LoadingRow>` — một dòng "Loading…"
 * duy nhất giữa một panel trống. Nó nói được ĐÚNG MỘT điều ("chờ đi"), và bỏ
 * sót hai điều người dùng thật sự cần:
 *
 *   1. Sắp có bao nhiêu thứ, hình dạng ra sao. Khung xương giữ nguyên bố cục
 *      của thứ sắp đến, nên lúc dữ liệu về thì nó THAY CHỖ chứ không đẩy cả
 *      trang nhảy xuống — cú nhảy đó là thứ khiến một app đọc ra là rẻ tiền,
 *      bất kể phần còn lại chỉn chu đến đâu.
 *   2. Rằng có việc đang chạy thật. Một spinner đứng giữa panel trống trông y
 *      hệt nhau ở giây thứ nhất và giây thứ hai mươi.
 *
 * Vệt sáng quét ngang là thứ phân biệt "đang tải" với "đã tải xong và rỗng" —
 * hai trạng thái mà một khối xám tĩnh không tách nổi. Nó lặp vô hạn, đúng một
 * ngoại lệ được phép so với luật "không animation lặp" trong `taste-skill`, vì
 * nó là CHỈ BÁO TRẠNG THÁI chứ không phải trang trí — cùng lý do `<Spinner>`
 * được phép quay mãi. Người bật "giảm chuyển động" thì chốt chặn toàn cục
 * trong `design/tokens.css` giữ vệt sáng đứng im; hình dạng khung xương vẫn
 * còn nguyên nên không mất thông tin nào.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Bo tròn hoàn toàn — cho avatar, chấm trạng thái, chip. */
  circle?: boolean;
}

export function Skeleton({ circle, className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-sunk',
        circle ? 'rounded-full' : 'rounded-sm',
        // Vệt sáng là một lớp phủ gradient trượt qua, KHÔNG phải `animate-pulse`
        // trên chính khối: nhấp nháy độ mờ làm cả vùng thở phập phồng và ở một
        // danh sách 8 dòng thì tám khối cùng thở là chóng mặt. Vệt quét đọc ra
        // là một chuyển động duy nhất đi qua cả nhóm.
        'motion-safe:after:absolute motion-safe:after:inset-0',
        'motion-safe:after:bg-gradient-to-r motion-safe:after:from-transparent motion-safe:after:via-fg/[0.07] motion-safe:after:to-transparent',
        'motion-safe:after:-translate-x-full motion-safe:after:animate-shimmer motion-safe:after:content-[""]',
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  /** Số dòng. Dòng cuối ngắn hơn — đoạn văn thật không bao giờ kết thúc đúng mép. */
  lines?: number;
  className?: string;
}

/** Vài dòng chữ giả — cho mô tả, thân thông báo, ô chú thích. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div role="status" aria-label="Đang tải" className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-2/5' : i % 2 ? 'w-4/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

export interface SkeletonListProps {
  /** Số hàng giả. Đặt bằng số hàng thường thấy, không phải một con số tròn trịa. */
  rows?: number;
  /** Chừa chỗ cho icon/avatar đầu hàng. */
  leading?: boolean;
  className?: string;
}

/**
 * Danh sách hàng đang tải — hình dạng của mọi bảng key Redis, topic Kafka,
 * queue RabbitMQ trong app. Bề rộng mỗi hàng lệch nhau một chút (dựng từ chỉ
 * số, không phải `Math.random`, để không đổi mỗi lần render và không nhấp
 * nháy): các hàng dài bằng nhau chằn chặn đọc ra là đồ hoạ, không phải dữ liệu.
 */
export function SkeletonList({ rows = 6, leading, className }: SkeletonListProps) {
  const WIDTHS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-5/12', 'w-7/12', 'w-1/2'];
  return (
    <div role="status" aria-label="Đang tải" className={cn('divide-y divide-line/60', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          {leading && <Skeleton circle className="h-5 w-5 shrink-0" />}
          <Skeleton className={cn('h-3', WIDTHS[i % WIDTHS.length])} />
          <Skeleton className="ml-auto h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}
