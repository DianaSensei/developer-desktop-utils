// Hàng đợi URL manifest chờ cài — cầu nối giữa `deepLink.ts` (nhận
// `devtool://install?...` từ hệ điều hành) và `SettingsExtensionInstaller`
// (UI xác nhận cài đặt đã có sẵn). Không tự cài gì ở đây: hàng đợi chỉ giữ
// URL, còn bước xem trước/xác nhận/cài thật vẫn đi qua đúng luồng
// `fetchArtifactManifestPreview`/`installArtifact` người dùng đã dùng khi tự
// dán URL — deep link chỉ thay việc copy/dán bằng một cú bấm, không bỏ qua
// bước xác nhận (một manifest độc hại trỏ tới từ một link giả mạo vẫn phải
// qua đúng màn hình xem trước đó).
//
let queue: string[] = [];

export const pendingInstall = {
  /** Thêm một hoặc nhiều URL manifest vào cuối hàng đợi (plugin trước,
   *  service sau — theo đúng thứ tự deep link truyền vào). */
  enqueue(urls: string[]) {
    const cleaned = urls.map((u) => u.trim()).filter(Boolean);
    queue = [...queue, ...cleaned];
  },
  /** Lấy và xoá URL kế tiếp, hoặc `null` nếu hàng đợi rỗng. */
  dequeue(): string | null {
    if (queue.length === 0) return null;
    const [next, ...rest] = queue;
    queue = rest;
    return next;
  },
};
