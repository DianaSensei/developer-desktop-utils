// Hàng đợi URL manifest chờ cài — cầu nối giữa `deepLink.ts` (nhận
// `desktop-devtool-app://install?...` từ hệ điều hành) và `SettingsExtensionInstaller`
// (UI xác nhận cài đặt đã có sẵn). Không tự cài gì ở đây: hàng đợi chỉ giữ
// URL, còn bước xem trước/xác nhận/cài thật vẫn đi qua đúng luồng
// `fetchArtifactManifestPreview`/`installArtifact` người dùng đã dùng khi tự
// dán URL — deep link chỉ thay việc copy/dán bằng một cú bấm, không bỏ qua
// bước xác nhận (một manifest độc hại trỏ tới từ một link giả mạo vẫn phải
// qua đúng màn hình xem trước đó).
//
// CÓ subscribe/notify (không chỉ enqueue/dequeue tay): nếu người dùng ĐANG
// đứng ở Settings → Plugin và một link `desktop-devtool-app://` thứ hai tới trong lúc đó,
// `SettingsExtensionInstaller` không remount (điều hướng tới path đang đứng
// sẵn không mount lại component) — effect chỉ chạy lúc mount sẽ bỏ lỡ URL
// mới. `notify()` cho listener đang mount một cơ hội tự kéo hàng đợi mà
// không cần đợi remount.

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

let queue: string[] = [];

export const pendingInstall = {
  /** Nạp một hoặc nhiều URL manifest mới (plugin trước, service sau — theo
   *  đúng thứ tự deep link truyền vào), rồi báo cho mọi listener đang mount
   *  (nếu có) để tự kéo ngay, không cần remount.
   *
   *  THAY THẾ toàn bộ hàng đợi cũ thay vì nối vào cuối: mỗi lần `handle()`
   *  (deepLink.ts) gọi đây là một cú bấm "Install" MỚI từ bên ngoài — nếu
   *  người dùng bấm link cho plugin B trong khi vẫn còn URL service của
   *  plugin A đang treo trong hàng đợi (chưa xác nhận cài xong ở
   *  `SettingsExtensionInstaller`), nối vào cuối sẽ khiến `dequeue()` (FIFO)
   *  trả về đúng cái URL cũ của A trước, khiến người dùng thấy "dữ liệu cũ"
   *  thay vì bản xem trước của B mà họ vừa yêu cầu. Ý định mới luôn thắng ý
   *  định cũ chưa hoàn tất.
   */
  enqueue(urls: string[]) {
    const cleaned = urls.map((u) => u.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    queue = cleaned;
    notify();
  },
  /** Lấy và xoá URL kế tiếp, hoặc `null` nếu hàng đợi rỗng. */
  dequeue(): string | null {
    if (queue.length === 0) return null;
    const [next, ...rest] = queue;
    queue = rest;
    return next;
  },
  /** Đăng ký nghe "có URL mới vừa được thêm". Trả về hàm huỷ đăng ký. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
