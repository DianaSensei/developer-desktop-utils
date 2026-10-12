/**
 * DevTool — app Tailwind preset.
 *
 * Extends the design kit preset (`design/tailwind-preset.cjs`), which
 * provides the colour vocabulary (`acc`, `bg`, `fg`, `line`, `ok/warn/bad/info`…).
 *
 *   // tailwind.config.js
 *   presets: [require('./src/design-system/tailwind-preset.cjs')]
 *
 *   // global CSS, before the @tailwind directives
 *   @import "../design-system/tokens.css";
 *
 * @type {import('tailwindcss').Config}
 */

module.exports = {
  presets: [require('../../design/tailwind-preset.cjs')],
  theme: {
    extend: {
      /* Aliases for Tailwind's stock `shadow-sm/md/lg/xl/2xl` mapped onto the
         kit's three levels, so existing call sites keep working. */
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
