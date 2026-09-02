/**
 * Vá các API trình duyệt mà jsdom không có.
 *
 * `ResizeObserver` là API thật, có ở cả ba webview của Tauri (WKWebView,
 * WebView2, WebKitGTK) — chỉ jsdom là thiếu. Các component đo đạc bố cục
 * (`Segmented`, `Tabs`) dùng nó để giữ con trượt / gạch chân bám đúng nút khi
 * bề rộng đổi, nên vá ở tầng môi trường test đúng hơn là bắt component phải
 * mang theo một nhánh `typeof ResizeObserver === 'undefined'` chỉ để chiều
 * jsdom.
 *
 * Bản vá này KHÔNG gọi callback: test trong repo dựng cây trong jsdom, nơi mọi
 * phép đo đều trả về 0, nên không có thay đổi kích thước thật nào để báo.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
