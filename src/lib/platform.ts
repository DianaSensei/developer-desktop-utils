// Nguồn sự thật DUY NHẤT cho hai câu hỏi phát sinh khắp app: "đang chạy
// trong Tauri hay trình duyệt thường?" và "hệ điều hành có phải macOS
// không?". Trước khi có file này, cả hai đều bị khai báo lại tay ở hơn 20
// chỗ khác nhau — một vài bản thiếu `typeof window !== 'undefined'` (ném
// lỗi nếu module load trước khi `window` tồn tại, ví dụ trong test), và
// bản IS_MAC cũ nhất (từng sống trong keycap.tsx) dùng `navigator.platform`
// (API đã deprecated, thiếu "iPod") trong khi 3 bản sao chép sau lại dùng
// `navigator.userAgent` — hai kỹ thuật khác nhau có thể cho kết quả khác
// nhau trên cùng một máy, tuỳ bản build/engine webview. Gộp về một chỗ để
// đổi kỹ thuật phát hiện (vd chuyển sang `@tauri-apps/plugin-os` sau này)
// chỉ cần sửa một file, không phải rà lại toàn bộ codebase.

/** True khi code đang chạy trong webview của Tauri (không phải trình duyệt
 *  thường hay môi trường test không có `window`). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** True trên macOS/iOS. Dùng `navigator.userAgent` (không phải
 *  `navigator.platform`, đã deprecated) — đọc một lần lúc nạp module. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Phím lệnh theo hệ điều hành, dùng cho hiển thị phím tắt (⌘K / Ctrl+K…). */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
