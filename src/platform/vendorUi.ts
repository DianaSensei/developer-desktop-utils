/**
 * Bộ UI DÙNG CHUNG cho plugin cài từ bên ngoài — `window.__DEVTOOL_VENDOR__.ui`.
 *
 * Trước đây vendor object chỉ đưa React + các hook `platform.*`. Plugin cài từ
 * URL không `import` được `@/design-system` (module của app chủ, không nằm
 * trong build của plugin), nên mỗi plugin phải tự chép lại Button/Input/
 * Select… Hệ quả: (1) giao diện trôi khỏi design system theo thời gian, (2)
 * class Tailwind chỉ có trong mã plugin không có rule nào trong stylesheet của
 * app chủ (xem docs/plugin-sdk/05-external-install.md, mục CSS), (3) các
 * convention UX bắt buộc (⌘V quick paste, ⌘Z undo) không áp được cho plugin.
 *
 * Dùng component của app chủ thì cả ba biến mất: class đã có rule vì chính app
 * chủ dùng chúng, và hành vi luôn là bản mới nhất.
 *
 * Nạp LƯỜI (`ensureVendorUi`, gọi trong `installer.ts` trước khi `import()`
 * bundle plugin) chứ không gắn sẵn trong `main.tsx`: design system kéo theo
 * CodeMirror, và gắn tĩnh ở entry nghĩa là mọi lần mở app đều trả giá đó dù
 * người dùng không cài plugin nào.
 *
 * Có từ SDK 1.1.0 — plugin dùng `ui` khai `sdk: '^1.1.0'`.
 */
export * from '@/design-system';
export { useQuickPaste, useQuickPasteHint, quickPasteHint } from '@/hooks/useQuickPaste';
export { useInputHistory } from '@/hooks/useInputHistory';
export { useImagePaste } from '@/hooks/useImagePaste';
export { useLocale, useMessages, useCurrentLocale } from '@/contexts/LocaleContext';
export { defineMessages } from '@/lib/i18n';
export { ToolHeaderActions } from '@/components/ToolHeaderActions';
