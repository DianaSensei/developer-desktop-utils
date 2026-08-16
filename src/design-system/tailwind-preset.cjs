/**
 * DevTool — preset Tailwind lớp app.
 *
 * Kế thừa preset của design kit (`design/tailwind-preset.cjs`). Từ vựng màu
 * (`acc`, `bg`, `fg`, `line`, `ok/warn/bad/info`…) đến thẳng từ preset kit —
 * lớp bắc cầu từ vựng cũ (`background`, `primary`, `muted`…) đã bị xoá ở G5,
 * sau khi toàn bộ ~2430 chỗ gọi trong `src/` đổi sang tên của kit.
 *
 *   // tailwind.config.js
 *   presets: [require('./src/design-system/tailwind-preset.cjs')]
 *
 *   // global CSS, TRƯỚC các @tailwind
 *   @import "../design-system/tokens.css";
 *
 * @type {import('tailwindcss').Config}
 */

module.exports = {
  presets: [require('../../design/tailwind-preset.cjs')],
  theme: {
    extend: {
      /* Bí danh bóng cũ → 3 bậc thật của kit. Còn ~75 chỗ gọi
         `shadow-sm/md/lg/xl/2xl` gốc của Tailwind (không phải `-premium`) —
         giữ bí danh này để chúng không phải sửa; không thuộc phạm vi từ
         vựng MÀU nên G5 không đụng tới. */
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
