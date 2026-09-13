# Changelog: app-selection-shape-unification

## Chosen Proposal

Thống nhất mọi chỉ báo "đang được chọn/mở" trong toàn app về đúng một tầng bo góc:
`rounded-md`. Trước đây có 4 kiểu khác nhau: App-shell (sidebar nav, titlebar) dùng
`rounded-sm`; `Tabs`'s `variant="pill"` (RequestTabs/RequestPanel, làm đợt trước) dùng
`rounded-md`; `Segmented` toggle dùng `rounded-xs`; `Tabs`'s `variant="underline"` (mặc
định cũ — Redis Admin, EnvironmentEditor, ResponsePanel, NodeSettingsDialog) dùng gạch
chân trượt, không bo góc gì cả.

Phạm vi được người dùng xác nhận mở rộng cả sang `App.tsx` (khung chung toàn app) và việc
gộp luôn biến thể `underline` vào `pill` — không chỉ giữ trong API Client.

## Diagrams

Không cần — thay đổi thuần class CSS + xoá một nhánh code không còn dùng, không đổi cấu
trúc component nào.

## Why This Proposal

`rounded-md` được chọn (không phải `rounded-sm` hay `rounded-xs`) vì đó là tầng
`Tabs`'s `pill` variant — component dùng chung nhiều tool nhất — đã áp dụng trước, không
phải một tầng mới bịa ra để mọi nơi phải học lại.

Người dùng chọn gộp luôn `underline` vào `pill` (không giữ lại làm biến thể riêng) — quyết
định này khiến việc XOÁ HẲN code đường `underline` khỏi `Tabs.tsx` là đúng, không phải giữ
lại dưới dạng dead code: không còn consumer nào cần nó, giữ lại prop `variant` không dùng
tới chỉ tăng bề mặt phải hiểu mà không ai chọn.

## Phát hiện thêm trong lúc triển khai

`ResponsePanel.tsx` truyền `activeClassName="text-fg"` cho `Tabs` — override này hợp lý
với `underline` (chỉ cần đổi màu chữ) nhưng với `pill`-only sẽ xoá mất nền/bóng của pill,
khiến tab active không còn đọc ra là "đang chọn" nữa. Đã gỡ override, thêm `bg-bg-2/10`
(giống RequestPanel/RequestTabs) để pill có nền tương phản.

`App.tsx`'s `titlebarNav` (đường render THẬT cho app desktop) vẫn còn viên thuốc accent
cho nhãn tool đơn lẻ, trong khi `OpenToolsStrip`'s fallback (chỉ dùng khi KHÔNG có titlebar
tự vẽ — tức đường phụ, không phải cái người dùng desktop thấy) đã được sửa thành chữ
thường từ một đợt trước, với lý do ghi rõ trong comment: viên thuốc tạo ra hình dạng "đang
chọn" thứ ba/tư cho một thứ không phải lựa chọn (không có gì khác để chọn). Quyết định đã
có nhưng chưa áp dụng cho đường THẬT — đã đồng bộ cả hai theo hướng chữ thường.

## Final AC / DoD Status

| Item | Status | Notes |
|------|--------|-------|
| Mọi chỉ báo "đang chọn" dùng `rounded-md` | Met | Sidebar nav, Settings link, titlebar tab, Segmented thumb+option, mọi `Tabs` consumer — xác nhận qua ảnh chụp Playwright |
| `Tabs`'s `variant="underline"` không còn tồn tại | Met | Xoá hẳn khỏi `tabs.tsx`; `rg 'variant='` trong mọi consumer sạch |
| `RULES.md` ghi quy ước mới | Met | "Bo góc cho 'đang chọn' — rounded-md, không tầng nào khác" |
| Không hồi quy pill mất nền (ResponsePanel) | Met | Gỡ `activeClassName="text-fg"`, thêm `bg-bg-2/10` |
| Nhãn tool đơn lẻ ở titlebar nhất quán chữ thường ở cả 2 đường render | Met | `titlebarNav` đồng bộ theo `OpenToolsStrip` fallback đã đúng từ trước |
| 1249 test pass, `tsc` sạch | Met | |
| `design/reference/ANALYSIS-DBX.md` cập nhật trạng thái 4 mục "chưa sửa" | Met | 2 mục đã cũ/tự đóng (số liệu không còn đúng), 1 mục (ToolPane) đã xong đợt trước, 1 mục (shapes) xong đợt này |

## Remaining Risk

Không xác minh trực quan được Redis `AdminView.tsx`'s tabs (cần kết nối Redis thật, môi
trường hiện tại không có) — thay đổi ở đây thuần túy là bỏ `variant` prop (đã là default),
cùng cơ chế đã xác nhận đúng ở `EnvironmentEditor.tsx`/`RequestPanel.tsx`, rủi ro thấp.

## Files Changed

- `src/components/ui/tabs.tsx` — xoá `variant`/`underline` path, `TabRow`/`TabBtn` chỉ còn
  render pill; `TabOverflow`'s nút "»" style lại theo tông pill.
- `src/components/ui/tabs.test.tsx` — viết lại, chỉ còn phủ hành vi pill (không còn so sánh
  2 variant).
- `src/components/ui/segmented.tsx` — thumb + option button `rounded-xs` → `rounded-md`.
- `src/App.tsx` — sidebar nav active row, Settings link active, titlebar tool-switch tab,
  titlebar icon badge, titlebar multi-tab track (cả 2 đường render) → `rounded-md`; nhãn
  tool đơn lẻ ở `titlebarNav` từ viên thuốc accent → chữ thường (đồng bộ với
  `OpenToolsStrip` fallback).
- `src/components/tools/apiclient/RequestPanel.tsx` — gỡ `variant="pill"` (không cần nữa,
  đã là default).
- `src/components/tools/apiclient/ResponsePanel.tsx` — gỡ `activeClassName="text-fg"` (phá
  vỡ pill), thêm `bg-bg-2/10` để pill có nền tương phản.
- `design/RULES.md` — quy ước mới "Bo góc cho 'đang chọn'".
- `design/reference/ANALYSIS-DBX.md` — cập nhật trạng thái 4 mục "Chưa sửa" của Đợt 2.
