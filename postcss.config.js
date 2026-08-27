// Tailwind 4 ships its own vendor-prefixing (via Lightning CSS), so the separate
// autoprefixer step that v3 needed is gone.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
