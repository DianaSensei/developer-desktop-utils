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
  // `--dur-press` 90ms lúc `:active`, rồi trả về `--dur-fast` khi nhả tay.
  //
  // ── HAI HỆ BÓNG TRÊN CÙNG MỘT NÚT: nguồn gốc của "dính viền" ───────────────
  // `.shadow-primary` (đã xoá) ghi THẲNG `box-shadow`, còn `.shadow-soft` và
  // `.ring-*` của Tailwind ghi qua chuỗi biến `--tw-shadow` / `--tw-ring-shadow`:
  //
  //   .shadow-primary { box-shadow: 0 2px 8px … }                  ← ghi thẳng
  //   .ring-2         { box-shadow: …, var(--tw-ring-shadow), var(--tw-shadow) }
  //
  // Hai khai báo cùng thuộc tính, cùng độ cụ thể (một class) — nên THỨ TỰ TRONG
  // FILE quyết định, không phải ý đồ. Trong bundle, `.shadow-primary` nằm ở
  // ~18k còn các biến thể `focus-visible:` nằm ở ~112k, nghĩa là hễ nút nhận
  // tiêu điểm thì vòng focus XOÁ SẠCH cái bóng, và ngược lại ở những tổ hợp
  // khác. Nút đổi hẳn diện mạo tuỳ trạng thái, theo một luật không ai viết ra.
  // `design/RULES.md` cấm "hai hệ shadow song song" đúng vì chuyện này.
  //
  // Cách sửa không phải là chỉnh thứ tự mà là bỏ hẳn một hệ: giờ mọi bóng trên
  // nút đều đi qua thang `--sh-sm/--sh/--sh-lg` của kit.
  //
  // ── Vì sao bỏ bóng ngả accent ─────────────────────────────────────────────
  // `shadow-primary` là một quầng sáng MÀU ACCENT, và nó còn PHÌNH TO khi rê
  // chuột (`shadow-primary-lg`: 20px, alpha .45). `design/RULES.md` viết thẳng
  // "không hover-lift, không glow" — quầng sáng màu nở ra dưới nút là định
  // nghĩa của cái cảm giác nhựa, bóng loáng, rẻ tiền.
  //
  // Nút chuẩn của kit (`design/preview/standalone.html`, `.btn.solid`) chỉ có
  // `box-shadow: var(--sh-sm)` và khi hover thì ĐỔI NỀN sang `--acc-hi`, không
  // đụng gì tới bóng. Bên dưới là đúng công thức đó.
  [
    'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-out-soft',
    'motion-safe:active:scale-[0.97] motion-safe:active:duration-press',
    // Đúng công thức của kit: `outline:none; box-shadow:0 0 0 3px var(--acc-ring)`.
    // `ring-[3px]` không kèm `ring-offset` — màu mặc định của `ring` trong preset
    // ĐÃ là `--acc-ring`, nên không cần viết lại.
    'focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
    'disabled:pointer-events-none disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-acc text-acc-fg shadow-soft hover:bg-acc-hi active:bg-acc-hi',
        // `tint` — nền nhuộm nhạt, chữ đậm cùng tông. Đây là bậc còn THIẾU giữa
        // `default` (đặc, chói) và `outline`/`ghost` (gần như vô hình): không có
        // nó, mọi màn chỉ còn hai thái cực và giao diện đọc ra tẻ nhạt. Dùng cho
        // hành động phụ vẫn cần trọng lượng — "Định dạng lại", "Chạy thử".
        tint: 'bg-acc-tint text-acc-ink hover:bg-acc-tint-2 active:bg-acc-tint-2',
        destructive:
          'bg-bad text-white shadow-soft hover:bg-bad/90',
        // Kit: `border-color:--line; background:--card; box-shadow:--sh-sm`, hover
        // đổi viền sang `--acc-edge` và nền sang `--chrome`. Bóng KHÔNG đổi khi
        // rê chuột — đổi bóng lúc hover chính là hover-lift trá hình.
        outline:
          'border border-line bg-card shadow-soft hover:border-acc-edge hover:bg-chrome active:bg-sunk',
        secondary:
          'bg-bg-2 text-fg hover:bg-bg-2/80 active:bg-sunk',
        // Kit đặt `color:--fg-mute` cho ghost, nhưng ở app này ghost là nền của
        // `CopyButton` và hàng chục nút icon vốn tự đặt màu chữ theo ngữ cảnh —
        // ép màu ở đây sẽ đổi diện mạo của những chỗ không liên quan gì tới lỗi
        // đang sửa. Chỉ lấy phần hover của kit (`--sunk`), giữ nguyên màu chữ.
        ghost: 'hover:bg-sunk hover:text-fg active:bg-sunk',
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
