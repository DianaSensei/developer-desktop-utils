# Feature: API Client dùng chung ToolToolbar/PaneHeader

## ✅ Chosen: Phương án 1 — Viền + bậc tông, không sửa RULES.md

Xác nhận qua checkpoint. Triển khai: `RequestTabs.tsx` chuyển sang `ToolToolbar`, thêm `.press` cho
IconButton trong toolbar, không đụng `RULES.md`, không thêm shadow.

<details>
<summary>Rejected: Phương án 2 — thêm ngoại lệ RULES.md cho shadow</summary>

Đúng nghĩa đen "đổ bóng" hơn nhưng là vết nứt đầu tiên trong luật "chỉ viền, không shadow/gradient"
đang tuyệt đối — cần sửa `RULES.md`, ảnh hưởng cách đánh giá mọi tool khác. Không chọn vì Phương án 1
đã đủ giải quyết ý "độ nổi" mà không cần đánh đổi đó.

</details>

## Overview

API Client hiện tự dựng layout toolbar riêng (`RequestTabs.tsx`'s outer div, nền `bg-bg-2/10` gần
như trong suốt) thay vì dùng `ToolToolbar` dùng chung mà mọi tool khác trong app đã dùng. Đây là gap
đã được chẩn đoán từ trước (`ANALYSIS-DBX.md`, "Đợt 2 chưa sửa") nhưng chưa sửa. Đợt này: chuyển
toolbar của API Client sang dùng chung `ToolToolbar`, đồng thời quyết định cách áp dụng cảm hứng
độ-sâu/viền/đổ-bóng/hoạt-ảnh kiểu Apple mà người dùng yêu cầu cho riêng vùng chrome này.

Phạm vi: **thuần styling/layout của vùng toolbar** (tab strip + cụm nút/select bên phải trong
`RequestTabs.tsx`). Không đụng sidebar, không đụng bảng Params/Headers, không đổi mô hình dữ liệu.

## Bối cảnh tham khảo

- `design/reference/ANALYSIS-DBX.md` — "Đợt 2 chưa sửa": API Client không dùng `ToolPane` chung.
- `design/reference/ANALYSIS-COMPETITORS.md` — ảnh thật Hoppscotch/Insomnia/Thunder Client (không có
  ảnh thật Requestly) — không nguồn nào gợi ý mở rộng kính mờ; đều phẳng, viền mảnh.
- `design/RULES.md` — luật hiện tại: độ sâu đến từ VIỀN + bậc tông (`--chrome`/`--card`), không phải
  shadow/gradient; chỉ 3 tầng shadow cố định (`--sh-sm/--sh/--sh-lg` + `--sh-btn`), không được cộng
  dồn hai tầng trên cùng một thẻ.

## Hai phương án (từ solution-architect)

### Phương án 1 — Chỉ viền + bậc tông, KHÔNG sửa RULES.md (khuyến nghị)

- `RequestTabs.tsx`'s outer `<div className="... bg-bg-2/10">` → `<ToolToolbar className="... px-0 py-0">`.
  Nền/viền giờ đến từ `header-chrome` (định nghĩa sẵn trong `tokens.css`) thay vì tái định nghĩa riêng.
- Mọi phần tử bên trong (tab pill, nút +New, icon reveal-in-sidebar, 2 select môi trường, EnvQuickView,
  icon History, icon đổi layout) giữ nguyên vị trí/khoảng cách/đường chia — không reflow.
- Thêm hiệu ứng nhấn (`.press`, đã có sẵn trong app — scale-down 90ms) cho các IconButton trong toolbar
  (hiện chỉ có transition màu, chưa có phản hồi khi nhấn) — đây là khoảng trống thật so với phần còn
  lại của app.
- Giữ nguyên animation mount hiện có (`motion-safe:animate-scale-in` khi mở tab mới).
- **Không thêm shadow nào** — độ nổi tới từ ranh giới `--chrome` (97%) vs `--card` (100%) + `border-b`,
  đúng cơ chế Sidebar đã dùng.

### Phương án 2 — Như trên, cộng thêm MỘT ngoại lệ RULES.md: shadow mỏng ở viền dưới toolbar

- Thêm class `.chrome-lip` (tái dùng giá trị `--sh-sm` có sẵn, không tạo tầng shadow mới) cho viền
  dưới cùng của `ToolToolbar` — tạo cảm giác "thanh này nổi trên nội dung", sát nghĩa đen "đổ bóng"
  hơn phương án 1.
- Cần sửa `RULES.md`: thêm 1 dòng ngoại lệ trong bảng "Được phép" (giới hạn: chỉ viền dưới
  `ToolToolbar` cấp cao nhất, không lan vào `PaneHeader` hay bất kỳ thẻ lồng nào) + 1 dòng checklist
  PR mới. Đây là thay đổi luật thiết kế, ảnh hưởng tới cách đánh giá MỌI tool khác trong app, không
  chỉ API Client.
- Rủi ro: tab pill đang active đã có `shadow-sm` riêng — cần xác nhận 2 shadow (viền toolbar + pill)
  không "đánh nhau" trong cùng dải 34px.

## Acceptance Criteria (EARS)

- AC-001: Given API Client đang mở, When nhìn vào dải chứa tab request + cụm nút bên phải, Then dải
  đó là bề mặt `--chrome` đặc với viền dưới rõ (không còn nền ~10% gần như trong suốt).
- AC-002: Given dải toolbar, When so với bản hiện tại, Then mọi phần tử giữ nguyên vị trí/khoảng
  cách/đường chia — không reflow, không thêm padding.
- AC-003: Given một IconButton trong toolbar, When nhấn giữ, Then co lại ~3% trong 90ms và nhả trong
  150ms (giống `.press` đã dùng nơi khác).
- AC-004: Given cửa sổ thu hẹp, When cụm bên phải chạm `max-w-[45%]` + cuộn ngang nội bộ hiện có,
  Then hành vi giữ nguyên như hôm nay.
- AC-005: Given sáng/tối, When đổi theme, Then toolbar đổi màu đúng theo token `--chrome`/`--line`
  có sẵn, không cần logic riêng.
- (Chỉ Phương án 2) AC-006: Given viền dưới toolbar, When nhìn so với nội dung ngay dưới nó, Then
  thấy một shadow mỏng 1-2px đổ xuống, ở cả 2 theme, không đánh nhau với `shadow-sm` của tab active.

## Edge cases

- Cửa sổ ở độ rộng tối thiểu: toolbar không được tách rời khỏi tab strip/cụm nó bọc quanh.
- Nhãn VI dài hơn EN ~25%: toolbar hiện tại không có text nhãn hiển thị (chỉ icon + tooltip) — xác
  nhận không có nhãn nào có thể tràn.
- Light/dark parity: đối chiếu với ranh giới Sidebar/AddressBar đã chứng minh cặp `--chrome`/`--line`
  hoạt động đúng ở cả hai theme.
- `prefers-reduced-motion`: `.press` phải bị vô hiệu hoá bởi block reduce-motion toàn cục đã có sẵn.
- Nhiều tab mở (cuộn ngang): nền đặc mới không được để lộ đường nối 1px nào ở ranh giới
  RequestTabs/AddressBar mà nền trong suốt trước đây tình cờ che được.

## Definition of Done

- `RequestTabs.tsx` dùng `ToolToolbar` (import từ `@/components/ui/tool-layout`), không còn div tự
  định nghĩa bg/border riêng.
- Không có hồi quy hình ảnh ở tab strip/nút/select/icon (so sánh ảnh chụp trước/sau, cả 2 theme).
- IconButton trong toolbar có `.press`.
- `rg 'bg-bg-2/10'` trong `RequestTabs.tsx` không còn kết quả.
- Checklist PR của `RULES.md` chạy lại và pass.
- Đổi VI/EN không tràn/nhảy layout ở vùng toolbar.
- Thu nhỏ cửa sổ từ full-width xuống mức tối thiểu đã công bố: không cắt/hở đường nối.
- (Chỉ Phương án 2) `RULES.md` cập nhật (bảng "Được phép" + dòng checklist mới) trong CÙNG lượt thay
  đổi, không hoãn lại; `rg '\-\-sh-'` xác nhận đây là điểm dùng shadow mới DUY NHẤT được thêm.

## Câu hỏi mở (từ solution-architect)

- Nếu chọn Phương án 2: `.chrome-lip` chỉ áp cho toolbar của API Client, hay áp luôn vào component
  `ToolToolbar` dùng chung (khiến MỌI tool khác cũng có shadow mỏng này)? Phạm vi đợt này chỉ API
  Client, nhưng sửa ở cấp component sẽ ảnh hưởng toàn app — cần trả lời rõ trước khi code.
- Ghi chú: brief tôi đưa cho solution-architect có nhắc nhầm một "nút thu gọn sidebar" như một phần
  toolbar hiện có — kiểm tra lại thì KHÔNG có nút này trong code hiện tại (chỉ có thu gọn từng
  collection/folder trong cây, không có nút ẩn/hiện toàn bộ sidebar). Đây là lỗi mô tả của tôi, không
  phải phạm vi thật — nếu bạn muốn thêm nút này, đó là một tính năng mới, cần bàn riêng.
