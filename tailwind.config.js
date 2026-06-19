/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
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
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      /* Cross-platform shadow scale. Tailwind's defaults use wide blur + spread,
         which WebKitGTK (Linux) and WebView2 (Windows) render with visible
         banding and hard edges. These are layered, low-alpha, low-spread
         shadows that stay soft and identical across macOS / Windows / Linux. */
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
