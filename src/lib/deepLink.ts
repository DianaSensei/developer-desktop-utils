// Nhận link `devtool://install?manifest=<url>&service=<url>` từ trang plugin
// (starlight-site's plugins.astro) và đưa app tới đúng màn hình xác nhận cài
// đặt đã có sẵn (`SettingsExtensionInstaller`) — xem
// `src-tauri/src/main.rs` cho phần đăng ký scheme/plugin phía Rust và
// `pendingInstall.ts` cho hàng đợi URL nằm giữa hai bên.
//
// CHỦ ĐÍCH KHÔNG tự cài ngay khi nhận link: một link `devtool://` có thể đến
// từ bất kỳ đâu (trang web giả mạo, tin nhắn), nên bước xem trước/xác nhận
// của SettingsExtensionInstaller (tên, quyền, nguồn) vẫn bắt buộc — file này
// chỉ tự động điền URL và cuộn tới đó, không thay cho cú bấm "Cài đặt".

import { isTauri } from '@/lib/platform';
import { pendingInstall } from '@/lib/pendingInstall';

/** Parse một chuỗi URL thành danh sách URL manifest cần cài, theo thứ tự
 *  plugin trước rồi tới sidecar service — bỏ qua im lặng nếu không phải
 *  đúng dạng `devtool://install?...` (vd một CLI argument không liên quan
 *  lọt vào `getCurrent()`/`onOpenUrl`). */
function parseInstallUrls(raw: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [];
  }
  if (parsed.protocol !== 'devtool:' || parsed.hostname !== 'install') return [];
  const urls: string[] = [];
  const manifest = parsed.searchParams.get('manifest');
  const service = parsed.searchParams.get('service');
  if (manifest) urls.push(manifest);
  if (service) urls.push(service);
  return urls;
}

let started = false;

/** Gắn một lần từ `App.tsx`. No-op trên web (deep link là tính năng OS-level
 *  của bản desktop — xem `isTauri`) và nếu gọi lại lần hai (StrictMode mount
 *  kép trong dev). */
export async function initDeepLinkHandling(navigate: (path: string) => void): Promise<void> {
  if (!isTauri || started) return;
  started = true;

  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');

  const handle = (urls: string[]) => {
    const toInstall = urls.flatMap(parseInstallUrls);
    if (toInstall.length === 0) return;
    pendingInstall.enqueue(toInstall);
    navigate('/settings');
  };

  // Khởi động lạnh: app được chính link này MỞ LÊN (chưa chạy sẵn).
  const current = await getCurrent();
  if (current) handle(current);

  // App đã chạy sẵn: single-instance (main.rs) chuyển tiếp URL sang đây thay
  // vì mở thêm cửa sổ mới.
  await onOpenUrl(handle);
}
