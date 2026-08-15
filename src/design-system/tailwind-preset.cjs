/**
 * DevTool — preset Tailwind lớp app.
 *
 * Kế thừa preset của design kit (`design/tailwind-preset.cjs`) rồi bổ sung lớp
 * BẮC CẦU: giữ nguyên từ vựng màu cũ của app (`background`, `foreground`,
 * `primary`, `muted`…) để ~2430 chỗ gọi không phải sửa, trong khi giá trị bên
 * dưới đã là của kit (xem lớp ánh xạ trong `tokens.css`).
 *
 * Từ G2 trở đi, code MỚI dùng từ vựng của kit — `acc`, `bg`, `fg`, `line`,
 * `ok/warn/bad/info` — đã có sẵn nhờ preset kit. G4 di cư từng tool, G5 xoá
 * khối `colors` bắc cầu bên dưới.
 *
 *   // tailwind.config.js
 *   presets: [require('./src/design-system/tailwind-preset.cjs')]
 *
 *   // global CSS, TRƯỚC các @tailwind
 *   @import "../design-system/tokens.css";
 *
 * @type {import('tailwindcss').Config}
 */

/** Token dạng kênh → hàm màu Tailwind có hỗ trợ alpha (`bg-card/50`). */
const ch = (name) => `hsl(var(--${name}) / <alpha-value>)`;

module.exports = {
  presets: [require('../../design/tailwind-preset.cjs')],
  theme: {
    extend: {
      colors: {
        /* ── BẮC CẦU: từ vựng cũ ─────────────────────────────────────────
           Tên giữ nguyên, giá trị đã trỏ sang kênh của kit qua tokens.css. */
        border: ch('border'),
        input: ch('input'),
        ring: ch('ring'),
        background: ch('background'),
        foreground: ch('foreground'),
        sidebar: ch('sidebar'),
        elevated: ch('elevated'),
        primary: {
          DEFAULT: ch('primary'),
          foreground: ch('primary-foreground'),
        },
        secondary: {
          DEFAULT: ch('secondary'),
          foreground: ch('secondary-foreground'),
        },
        destructive: {
          DEFAULT: ch('destructive'),
          foreground: ch('destructive-foreground'),
        },
        muted: {
          DEFAULT: ch('muted'),
          foreground: ch('muted-foreground'),
        },
        accent: {
          DEFAULT: ch('accent'),
          foreground: ch('accent-foreground'),
        },
        popover: {
          DEFAULT: ch('popover'),
          foreground: ch('popover-foreground'),
        },
        card: {
          DEFAULT: ch('card'),
          foreground: ch('card-foreground'),
        },
      },

      /* Bí danh bóng cũ → 3 bậc thật của kit.
         75 chỗ gọi `shadow-sm/md/lg/xl/2xl` không phải sửa. G5 gộp lại. */
      boxShadow: {
        sm: 'var(--sh-sm)',
        DEFAULT: 'var(--sh)',
        md: 'var(--sh)',
        lg: 'var(--sh-lg)',
        xl: 'var(--sh-lg)',
        '2xl': 'var(--sh-lg)',
        inner: 'inset 0 1px 2px 0 hsl(var(--fg-c) / 0.06)',
        none: 'none',
      },
    },
  },
};
