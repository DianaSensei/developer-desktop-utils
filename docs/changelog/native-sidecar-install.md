# Cài đặt sidecar native (Tier B) từ URL

## Vì sao

Mục tiêu cuối: app release gốc rất nhẹ, không đóng gói sẵn Kafka/RabbitMQ/
Redis/Container — người dùng tải sidecar riêng qua URL khi cần, giống cách
plugin JS được cài từ Phase 1. Điểm khởi đầu là một hiểu nhầm cần đính chính:
Phase 2 (đưa 4 tool nặng thành sidecar Tier B) chỉ tách được TIẾN TRÌNH
(crash isolation), không tự động giảm dung lượng tải về — sidecar vẫn đóng
gói sẵn trong installer qua `bundle.externalBin` trừ khi có thêm cơ chế này.

## Phương án đã chọn (và vì sao)

Gộp chung `plugin_installer.rs` + cơ chế mới thành `artifact_installer.rs`
tổng quát, phân biệt bằng `kind: "plugin" | "service"` trong cùng
`extensions/index.json`, thay vì tách hai module hoàn toàn độc lập (phương án
kia — xem phần "Rejected" trong `docs/plans/native-sidecar-install.md`).
Người dùng ưu tiên một UI/index duy nhất hơn là giảm rủi ro migration.

Đánh đổi chấp nhận: phải viết migration reader cho `index.json` cũ (không có
trường `kind`, mảng phẳng `InstalledPluginRecord`) — xử lý bằng `Deserialize`
viết tay (peek `serde_json::Value` trước khi chọn biến thể enum, vì serde's
derive cho tagged enum không hỗ trợ "thiếu tag thì mặc định biến thể X"), test
bằng chính hình dạng JSON `plugin_installer.rs` cũ đang ghi ra — không phải dữ
liệu tự bịa.

**Không mâu thuẫn với ranh giới tin cậy hiện có** — đây là điểm mấu chốt suýt
bị đóng khung sai bởi phân tích ban đầu (business-analyst kết luận nhầm
"không khả thi"): `ALLOWED_SERVICES` (`service_host.rs`) chặn theo TÊN, quyết
định lúc biên dịch. Tên nào được phép chạy vẫn do người viết code quyết định
khi tới lượt port một tool — không đổi. Việc mở rộng chỉ là `sidecar_path()`
tìm thêm ở một thư mục ghi được (`extensions/index.json` → `services/<bin>/`),
ưu tiên TRƯỚC bản đóng gói sẵn cạnh file thực thi — thứ tự có chủ đích để sau
này bỏ hẳn một sidecar khỏi `bundle.externalBin` không cần sửa lại hàm này.

Ký code (macOS) không cần thêm việc: Apple Silicon tự ký ad-hoc mọi binary
lúc `cargo build --release` (bắt buộc của kernel), và cơ chế tải chỉ ghi
đúng byte tải về nên chữ ký giữ nguyên — xác minh Gatekeeper thật trên máy
macOS vẫn là việc CHƯA làm, để sau.

## Behavior Preservation Checklist (kết quả)

- Nhánh plugin JS: hành vi/test Phase 1 giữ nguyên 100% — không regress.
- `index.json` cũ không có `kind`: đọc đúng, không mất bản ghi.
- `ALLOWED_SERVICES`: không đổi.

## Trạng thái AC/DoD

Toàn bộ AC/edge case/DoD trong `docs/plans/native-sidecar-install.md` đã đạt.
146 unit + 19 (`devtool-svc-redis`) + 9 integration Rust, 1407 vitest,
`tsc --noEmit` và `npm run build` sạch.

## Rủi ro còn lại

- Gatekeeper/quarantine thật trên macOS Apple Silicon — chưa xác minh bằng
  máy thật, chỉ suy luận từ cơ chế (không quarantine xattr vì tải bằng
  `reqwest`, không mở qua LaunchServices).
- Thời điểm thêm `devtool-svc-redis` vào `ALLOWED_SERVICES`/`bundle.externalBin`
  rồi bỏ khỏi mặc định — quyết định riêng, sau khi Redis Phase 2 Bước 2-5 xong.

## Files changed

Rust: `src-tauri/src/artifact_installer.rs` (mới, thay `plugin_installer.rs`),
`src-tauri/src/service_host.rs`, `src-tauri/src/main.rs`.
TS/React: `src/platform/installer.ts` (+test), `src/platform/index.ts`,
`src/components/SettingsExtensionInstaller.tsx` (+test, thay
`SettingsPluginInstaller.tsx`), `src/components/SettingsPlugins.tsx`,
`src/lib/i18n.ts`.
Docs: `docs/ai/CLAUDE.md`, `docs/decisions/platform-plugin-architecture.md`,
`docs/plans/native-sidecar-install.md`.
