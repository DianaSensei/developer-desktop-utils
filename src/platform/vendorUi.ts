/**
 * Shared UI for installed plugins, exposed as `window.__DEVTOOL_VENDOR__.ui`.
 *
 * Installed plugins cannot import `@/design-system`, so without this each
 * would copy its own components: they would drift from the design system,
 * their Tailwind classes would have no CSS in the host stylesheet, and the
 * paste/undo conventions would not apply.
 *
 * Loaded lazily by `ensureVendorUi` in installer.ts because the design
 * system pulls in CodeMirror. Available since SDK 1.1.0.
 */
export * from '@/design-system';
export { useQuickPaste, useQuickPasteHint, quickPasteHint } from '@/hooks/useQuickPaste';
export { useInputHistory } from '@/hooks/useInputHistory';
export { useImagePaste } from '@/hooks/useImagePaste';
export { useLocale, useMessages, useCurrentLocale } from '@/contexts/LocaleContext';
export { defineMessages } from '@/lib/i18n';
export { ToolHeaderActions } from '@/components/ToolHeaderActions';
