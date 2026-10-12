/**
 * DevTool Design Kit — Tailwind preset.
 *
 * Maps the tokens in `design/tokens.css` to utilities. It defines no colour
 * values, only CSS variable references, so theme and tone switches need no
 * Tailwind rebuild.
 *
 * Usage:
 *   // tailwind.config.js
 *   presets: [require('./design/tailwind-preset.cjs')]
 *
 *   // global CSS, before the @tailwind directives
 *   @import "../../design/tokens.css";
 *
 * Colours reference the `-c` channel variables because Tailwind can only
 * inject `<alpha-value>` into channel form ("218 76% 48%").
 *
 * @type {import('tailwindcss').Config}
 */

/** Channel-form colour → Tailwind colour function with alpha support. */
const ch = (name) => `hsl(var(--${name}-c) / <alpha-value>)`;

module.exports = {
  darkMode: ['class'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      // Between `text-xs` (12px) and `text-sm` (14px), for dense panel text.
      fontSize: {
        dense: ['13px', { lineHeight: '1.45' }],
      },
      fontFamily: {
        sans: ['var(--sans)'],
        // Without this `font-mono` falls back to Courier New on Windows/Linux.
        mono: ['var(--mono)'],
      },

      colors: {
        /* ── Accent: user-selectable, never carries status meaning ──────── */
        /* Focus ring colour, one for the whole app. Not `ch()`: `--acc-ring`
           already includes alpha, so don't write `ring-focus/50`. Needed because
           Tailwind v4 `ring-<width>` otherwise uses `currentcolor`. */
        focus: 'var(--acc-ring)',

        acc: {
          DEFAULT: ch('acc'),
          hi: ch('acc-hi'),
          tint: ch('acc-tint'),
          'tint-2': ch('acc-tint-2'),
          ink: ch('acc-ink'),
          edge: ch('acc-edge'),
          fg: ch('acc-fg'),
        },

        /* ── Surfaces ───────────────────────────────────────────────────── */
        bg: { DEFAULT: ch('bg'), 2: ch('bg-2') },
        card: ch('card'),
        sunk: ch('sunk'),
        chrome: ch('chrome'),

        /* ── Text & lines ───────────────────────────────────────────────── */
        fg: { DEFAULT: ch('fg'), mute: ch('fg-mute'), faint: ch('fg-faint') },
        line: { DEFAULT: ch('line'), soft: ch('line-soft'), strong: ch('line-strong') },

        /* ── Data types: fixed meaning, independent of the accent ─────────── */
        type: {
          string: ch('type-string'), number: ch('type-number'), bool: ch('type-bool'),
          date: ch('type-date'), null: ch('type-null'), binary: ch('type-binary'),
          object: ch('type-object'),
        },

        /* ── Status: fixed meaning, unaffected by the accent tone ─────────── */
        ok:   { DEFAULT: ch('ok'),   tint: ch('ok-tint'),   edge: ch('ok-edge') },
        warn: { DEFAULT: ch('warn'), tint: ch('warn-tint'), edge: ch('warn-edge') },
        bad:  { DEFAULT: ch('bad'),  tint: ch('bad-tint'),  edge: ch('bad-edge') },
        info: { DEFAULT: ch('info'), tint: ch('info-tint'), edge: ch('info-edge') },
      },

      /* Distinct radius steps, see TOKENS.md. */
      borderRadius: {
        /* Bare `rounded`, so it follows the [data-corner] presets
           (see --r-default in tokens.css). */
        DEFAULT: 'var(--r-default)',
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        full: 'var(--r-full)',
      },

      /* Three shadow levels; deeper nesting uses borders. `btn` / `btn-press`
         are `--sh-sm` plus 1px edges (see --sh-btn), for solid clickable
         surfaces only, not cards or panels. */
      boxShadow: {
        soft: 'var(--sh-sm)',
        DEFAULT: 'var(--sh)',
        lift: 'var(--sh-lg)',
        btn: 'var(--sh-btn)',
        'btn-press': 'var(--sh-btn-press)',
        none: 'none',
      },

      /* Control heights (two only); `width` is for square icon buttons. */
      height: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },
      minHeight: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },
      width: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },
      minWidth: { ctl: 'var(--h)', 'ctl-lg': 'var(--h-lg)' },

      /* No `ringColor`: it does not carry over to Tailwind v4. The focus ring
         colour is `colors.focus` above. */

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
        // Sweep for an indeterminate progress bar.
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },

        /* ── Pop in / out ────────────────────────────────────────────────
           Menus, popovers, status chips. The call site sets `transform-origin`
           so the surface grows from its trigger. Starts at 96%: 95% reads as a jump. */
        'pop-in': {
          from: { opacity: 0, transform: 'scale(.96)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        'pop-out': {
          from: { opacity: 1, transform: 'scale(1)' },
          to: { opacity: 0, transform: 'scale(.97)' },
        },

        /* Self-drawing tick; the component sets `stroke-dasharray`, this animates
           dashoffset to 0. Drawn rather than faded so it reads as "just done". */
        'tick-draw': {
          from: { strokeDashoffset: 'var(--tick-len, 22)' },
          to: { strokeDashoffset: '0' },
        },

        /* Skeleton shimmer: tells "loading" apart from "loaded and empty". */
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },

        /* One-shot ring when an action succeeds (copy, save, send). */
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

        // Asymmetric enter/exit (rule 1 in tokens.css), shared by every pop-up surface.
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
