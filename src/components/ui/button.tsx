import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Keycap } from '@/components/ui/keycap';

const buttonVariants = cva(
  // Rê chuột đổi màu/bóng, KHÔNG đổi vị trí — design/RULES.md. `transform` vẫn
  // nằm trong transition cho hiệu ứng lún khi bấm (active:scale), là phản hồi
  // trực tiếp dưới ngón tay chứ không phải chuyển động khi chỉ lướt qua.
  //
  // NHẤN NHANH, NHẢ CHẬM — luật 3 trong `design/tokens.css`. Nền/viền/bóng đổi
  // trong `--dur-fast`, nhưng `transform` (cái lún xuống) có nhịp RIÊNG:
  // `--dur-press` 90ms lúc `:active`, rồi trả về `--dur-fast` khi nhả tay. Bản
  // trước dùng chung một `duration-200` cho tất cả, nên cú nhấn đến chậm hơn
  // ngón tay một nhịp rõ rệt — nút đọc ra là "nặng", không phải "mượt".
  //
  // Lún 0.97 giữ nguyên; chỗ đổi là bóng — mọi variant có bóng đều SỤP xuống
  // bậc thấp hơn lúc nhấn. Vật thật bị ấn thì áp sát mặt bàn và bóng co lại;
  // chỉ thu nhỏ mà bóng đứng yên thì đọc ra là ảnh bị scale, không phải nút
  // bị ấn.
  [
    'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium ring-offset-bg',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-out-soft',
    'motion-safe:active:scale-[0.97] motion-safe:active:duration-press',
    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-acc/40 focus-visible:ring-offset-1',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-acc text-acc-fg shadow-primary hover:bg-acc/95 hover:shadow-primary-lg active:bg-acc active:shadow-soft',
        // `tint` — nền nhuộm nhạt, chữ đậm cùng tông. Đây là bậc còn THIẾU giữa
        // `default` (đặc, chói) và `outline`/`ghost` (gần như vô hình): không có
        // nó, mọi màn chỉ còn hai thái cực và giao diện đọc ra tẻ nhạt. Dùng cho
        // hành động phụ vẫn cần trọng lượng — "Định dạng lại", "Chạy thử".
        tint: 'bg-acc-tint text-acc-ink hover:bg-acc-tint-2 active:bg-acc-tint-2',
        destructive:
          'bg-bad text-white shadow-sm hover:bg-bad/90 hover:shadow active:shadow-none',
        outline:
          'border border-sunk bg-bg shadow-sm hover:bg-acc/10 hover:text-fg hover:border-line/70 hover:shadow active:bg-acc/15 active:shadow-none',
        secondary:
          'bg-bg-2 text-fg hover:bg-bg-2/80 hover:shadow-sm active:bg-bg-2 active:shadow-none',
        ghost: 'hover:bg-acc/15 hover:text-fg active:bg-acc/25',
        link: 'text-acc underline-offset-4 hover:underline',
      },
      size: {
        // Một chiều cao control cho cả app: --h (34px). `lg` dùng --h-lg (40px)
        // cho hành động chính của trang. `sm` giữ lại cho toolbar dày đặc.
        default: 'h-ctl px-3 py-2',
        sm: 'h-ctl rounded-sm px-2.5',
        lg: 'h-ctl-lg rounded-sm px-5',
        icon: 'h-ctl w-ctl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Phím tắt hiện nội tuyến trong nút, ngăn bằng một vạch mảnh:
   * `<Button sc="⏎">Chạy</Button>` → `[ Chạy │ ⏎ ]`
   *
   * Dùng `scMod` để tự thêm ⌘/Ctrl theo hệ điều hành.
   * Bỏ qua khi `asChild` — lúc đó nút chỉ là lớp bọc, không sở hữu nội dung.
   */
  sc?: string;
  /** Thêm ⌘ (macOS) hoặc Ctrl vào trước `sc`. */
  scMod?: boolean;
  /**
   * Việc gắn với nút đang chạy: xoay icon đầu tiên trong nút, khoá nút lại và
   * báo `aria-busy`.
   *
   * Có 81 nút Tải lại / Làm mới trong app; trước đây đúng 2 nút cho biết là
   * bấm rồi thì đang có việc chạy. 79 nút còn lại: bấm → không có gì đổi →
   * người dùng bấm lại → hai lượt gọi mạng. Đó không phải chuyện "thiếu
   * animation cho đẹp", đó là app đang giấu trạng thái của chính nó.
   *
   * Xoay CHÍNH icon đang có chứ không tráo sang `<Spinner>`: hai glyph khác bề
   * rộng thì nút nhấp một cái ngay lúc bấm.
   */
  busy?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, sc, scMod, busy, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size }),
          busy && '[&>svg:first-child]:animate-spin',
          className,
        )}
        ref={ref}
        disabled={disabled ?? busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {children}
            {sc && (
              <Keycap inline mod={scMod}>
                {sc}
              </Keycap>
            )}
          </>
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
