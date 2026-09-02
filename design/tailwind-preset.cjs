/**
 * DevTool Design Kit — preset Tailwind.
 *
 * Ánh xạ token trong `design/tokens.css` thành utility. Preset này KHÔNG định
 * nghĩa giá trị màu nào — nó chỉ trỏ vào biến CSS, nên đổi theme và đổi tone
 * hoạt động hoàn toàn qua biến, không cần Tailwind build lại.
 *
 * Cách dùng:
 *   // tailwind.config.js
 *   presets: [require('./design/tailwind-preset.cjs')]
 *
 *   // global CSS, TRƯỚC các @tailwind
 *   @import "../../design/tokens.css";
 *
 * ── Vì sao màu trỏ vào biến `-c` chứ không phải biến màu hoàn chỉnh ──────
 * Tailwind chỉ chèn được `<alpha-value>` vào màu dạng kênh ("218 76% 48%").
 * Nếu trỏ vào `var(--acc)` (đã bọc hsl) thì `bg-acc/20` mất tác dụng.
 * Xem phần "Biến KÊNH" trong tokens.css.
 *
 * @type {import('tailwindcss').Config}
 */

/** Màu dạng kênh → hàm màu Tailwind có hỗ trợ alpha. */
const ch = (name) => `hsl(var(--${name}-c) / <alpha-value>)`;

module.exports = {
  darkMode: ['class'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: {
        sans: ['var(--sans)'],
        // Lần đầu tiên `mono` được khai báo. Trước đây `font-mono` dùng 356 lần
        // mà không có khai báo → rơi về Courier New trên Windows/Linux.
        mono: ['var(--mono)'],
      },

      colors: {
        /* ── Accent: đổi được. KHÔNG BAO GIỜ mang nghĩa trạng thái. ──────── */
        acc: {
          DEFAULT: ch('acc'),
          hi: ch('acc-hi'),
          tint: ch('acc-tint'),
          'tint-2': ch('acc-tint-2'),
          ink: ch('acc-ink'),
          edge: ch('acc-edge'),
          fg: ch('acc-fg'),
        },

        /* ── Bề mặt ──────────────────────────────────────────────────────── */
        bg: { DEFAULT: ch('bg'), 2: ch('bg-2') },
        card: ch('card'),
        sunk: ch('sunk'),
        chrome: ch('chrome'),

        /* ── Chữ & đường kẻ ──────────────────────────────────────────────── */
        fg: { DEFAULT: ch('fg'), mute: ch('fg-mute'), faint: ch('fg-faint') },
        line: { DEFAULT: ch('line'), soft: ch('line-soft') },

        /* ── Trạng thái: nghĩa CỐ ĐỊNH, không đổi khi swap tone ──────────── */
        ok:   { DEFAULT: ch('ok'),   tint: ch('ok-tint'),   edge: ch('ok-edge') },
        warn: { DEFAULT: ch('warn'), tint: ch('warn-tint'), edge: ch('warn-edge') },
        bad:  { DEFAULT: ch('bad'),  tint: ch('bad-tint'),  edge: ch('bad-edge') },
        info: { DEFAULT: ch('info'), tint: ch('info-tint'), edge: ch('info-edge') },
      },

      /* Thang rời nhau — mỗi bậc mang một nghĩa. Xem TOKENS.md. */
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        full: 'var(--r-full)',
      },

      /* Chỉ ba bậc bóng. Lồng sâu hơn dùng viền, không bóng. */
      boxShadow: {
        soft: 'var(--sh-sm)',
        DEFAULT: 'var(--sh)',
        lift: 'var(--sh-lg)',
        none: 'none',
      },

      /* Chiều cao control — chỉ hai. `width` đi kèm cho nút icon vuông. */
      height: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },
      minHeight: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },
      width: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },
      minWidth: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },

      ringColor: { DEFAULT: 'var(--acc-ring)' },

      transitionTimingFunction: {
        'out-soft': 'var(--ease-out-soft)',
        'in-soft': 'var(--ease-in-soft)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        press: 'var(--dur-press)',
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
        exit: 'var(--dur-exit)',
      },

      keyframes: {
        'accordion-down': { from: { height: 0 }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: 0 } },
        // Vệt trượt cho thanh tiến trình không xác định (việc chưa biết dài bao lâu).
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },

        /* ── Bật ra / thu vào ────────────────────────────────────────────
           Cho menu, popover, chip trạng thái. Đi kèm `transform-origin` do
           call site đặt, nên cùng một keyframe phục vụ được cả menu neo ở
           trên lẫn neo ở dưới — nó "mọc ra" từ nút bấm chứ không nở ra từ
           giữa chính nó. Vào 96% (không phải 95%): ở kích thước menu thật,
           95% đã đủ lớn để đọc ra là "giật một cái". */
        'pop-in': {
          from: { opacity: 0, transform: 'scale(.96)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        'pop-out': {
          from: { opacity: 1, transform: 'scale(1)' },
          to: { opacity: 0, transform: 'scale(.97)' },
        },

        /* Nét tick tự vẽ. `stroke-dasharray` đặt ở component; ở đây chỉ kéo
           dashoffset về 0. Vì sao không fade: một cái tick fade vào trông
           như nó vốn ở đó rồi, còn nét vẽ đọc ra là "vừa mới xong" — đúng
           nghĩa của hành động người dùng vừa làm. */
        'tick-draw': {
          from: { strokeDashoffset: 'var(--tick-len, 22)' },
          to: { strokeDashoffset: '0' },
        },

        /* Vệt sáng quét qua khối chờ (skeleton). Không phải trang trí: nó là
           thứ phân biệt "đang tải" với "tải xong và rỗng". */
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },

        /* Vòng sáng lan ra một lần khi một việc THÀNH CÔNG (copy, lưu, gửi).
           Một lần, rồi hết — không lặp. */
        'ring-ping': {
          from: { opacity: '.5', transform: 'scale(.9)' },
          to: { opacity: 0, transform: 'scale(1.5)' },
        },
      },
      animation: {
        // One tempo scale: reference the same --dur-base/--ease-out-soft
        // tokens everything else uses, instead of a hardcoded .2s ease-out
        // that drifts from them by coincidence rather than by reference.
        'accordion-down': 'accordion-down var(--dur-base) var(--ease-out-soft)',
        'accordion-up': 'accordion-up var(--dur-base) var(--ease-out-soft)',
        // Continuous indeterminate sweep, not an entrance/exit — its 1.1s
        // linear-ish loop is a deliberate pace unrelated to the UI tempo scale.
        'progress-indeterminate': 'progress-indeterminate 1.1s ease-in-out infinite',

        // Vào/ra bất đối xứng — luật 1 trong `tokens.css`. Cùng một cặp cho
        // mọi bề mặt bật ra, nên menu, popover và chip nhả ra cùng một nhịp.
        'pop-in': 'pop-in var(--dur-base) var(--ease-out-soft)',
        'pop-out': 'pop-out var(--dur-exit) var(--ease-in-soft) forwards',
        'tick-draw': 'tick-draw var(--dur-fast) var(--ease-out-soft) forwards',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        'ring-ping': 'ring-ping var(--dur-slow) var(--ease-out-soft) forwards',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
