/** @type {import('tailwindcss').Config} */
module.exports = {
  // Theme, colors, shadows, radius, fonts, motion + dark mode + plugins all live
  // in the portable design-system preset (src/design-system/tailwind-preset.cjs).
  presets: [require('./src/design-system/tailwind-preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
};
