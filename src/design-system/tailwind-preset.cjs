/**
 * DevTool Design System — Tailwind preset.
 *
 * Portable: drop `src/design-system/` into another project, then in its
 * tailwind.config.js do:
 *
 *   presets: [require('./src/design-system/tailwind-preset.cjs')]
 *
 * and import `src/design-system/tokens.css` once at the top of your global CSS.
 * The colors below are token-driven (CSS variables defined in tokens.css), so
 * theming/dark-mode is handled entirely by those variables.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI Variable Text',
          'Segoe UI',
          'Ubuntu',
          'Cantarell',
          'Noto Sans',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        sidebar: 'hsl(var(--sidebar))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        elevated: 'hsl(var(--elevated))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      /* Cross-platform shadow scale — layered, low-alpha, low-spread so it stays
         soft and identical across macOS / Windows / Linux webviews (the default
         Tailwind scale bands on WebKitGTK / WebView2). */
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.06)',
        DEFAULT: '0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 0 rgb(0 0 0 / 0.07)',
        md: '0 2px 4px -1px rgb(0 0 0 / 0.07), 0 4px 8px -2px rgb(0 0 0 / 0.06)',
        lg: '0 4px 8px -2px rgb(0 0 0 / 0.08), 0 8px 16px -4px rgb(0 0 0 / 0.06)',
        xl: '0 8px 16px -4px rgb(0 0 0 / 0.08), 0 16px 32px -8px rgb(0 0 0 / 0.07)',
        '2xl': '0 12px 28px -6px rgb(0 0 0 / 0.12), 0 24px 48px -12px rgb(0 0 0 / 0.08)',
        inner: 'inset 0 1px 2px 0 rgb(0 0 0 / 0.06)',
        none: 'none',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
