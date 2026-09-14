# Postmortem: API Client RequestPanel không dùng hết chiều rộng panel - 2026-09-13

## Time Discovered

2026-09-13, người dùng gửi 3 ảnh chụp thật (tab Params/Tests/Settings của API Client, layout xếp
chồng) kèm nhận xét: "các tính năng này không điều chỉnh theo kích thước cửa sổ/vị trí, để lại
nhiều khoảng trống vô nghĩa".

## Timeline of Events

- `workflow-router` phân loại đây là bug-fix (hành vi hiện tại thực sự lãng phí không gian, không
  phải yêu cầu tính năng mới).
- Vòng hỏi đáp đầu tiên (checkpoint) hiểu sai trục: tưởng vấn đề là tỉ lệ chia đôi SplitPane
  50/50 lãng phí chiều CAO khi chưa có response — người dùng chỉnh lại: vấn đề là chiều RỘNG
  không được tận dụng khi ở layout xếp chồng ("chia ngang" theo cách gọi của người dùng =
  `direction: 'vertical'`/stacked trong code), buộc phải cuộn dọc nhiều hơn cần thiết.
- Đọc `RequestPanel.tsx`: phát hiện `max-w-5xl` (tab Params) và `max-w-3xl` (tab Tests) — comment
  sẵn trong code giải thích lý do: chặn cột VALUE của `KeyValueEditor` (vốn `minmax(0,1fr)`) biến
  giá trị ngắn thành ô input 600px khi panel chiếm trọn chiều rộng cửa sổ.
- Checkpoint thứ hai: trình bày đúng nguyên nhân + hướng sửa (bỏ giới hạn ở cấp section, chuyển
  giới hạn xuống cấp CỘT của bảng) — người dùng đồng ý, chọn cụ thể "giữ cột VALUE vừa phải".
- Lần sửa đầu tiên đổi `minmax(0,1fr)` → `minmax(0,16rem)`/`minmax(0,40rem)` cho Name/Value.
  Dựng Playwright đo `getBoundingClientRect()` thật (cả trang HTML cô lập tối giản lẫn app thật,
  cả chế độ side-by-side và xếp chồng) để xác minh trước khi báo cáo xong — phát hiện hành vi CSS
  Grid đúng như dự tính (khoảng trống thừa được phân bổ dần cho các track chưa chạm trần, mỗi
  track dừng đúng ở mức trần riêng) chứ không phải "không giãn ra" như lo ngại ban đầu.
- Áp dụng tương tự cho bảng Assertions (tab Tests, dùng cùng khuôn mẫu `minmax(0,1fr)` cho cột
  Expression/Value) để không tái diễn vấn đề y hệt ở đó sau khi bỏ `max-w-3xl`.
- Viết 2 test hồi quy trong `KeyValueEditor.test.tsx`, xác nhận fail trên code cũ / pass trên code
  mới (`git stash`). Chạy toàn bộ 1242 test + `tsc` — sạch.

## Initial Symptoms

Ở layout xếp chồng (Request pane chiếm trọn chiều rộng cửa sổ), các bảng Query/Headers (tab
Params) và Assertions (tab Tests) chỉ dùng một phần nhỏ chiều rộng sẵn có, để lại một khối trống
lớn bên cạnh — không có cách nào tận dụng phần đó để hiện nhiều hơn/giảm nhu cầu cuộn dọc.

## Root Cause

`RequestPanel.tsx` bọc nội dung tab Params trong `<div className="... max-w-5xl ...">` và tab
Tests trong `<div className="... max-w-3xl ...">`. Đây là một cơ chế PHÒNG THỦ đã có từ trước:
`KeyValueEditor`'s cột Name/Value (và tương tự cột Expression/Value của bảng Assertions) dùng
`grid-cols-[..._minmax(0,1fr)_minmax(0,1fr)_..._]` — track `1fr` là LINH HOẠT, tự hấp thụ MỌI
khoảng trống thừa của container. Không có `max-w` ở cấp section, một giá trị ngắn như `profile`
sẽ nhận một ô input dài cả nghìn pixel khi panel chiếm trọn cửa sổ. Cách khắc phục TRƯỚC đó (chặn
cả section bằng `max-w-5xl`/`max-w-3xl`) đúng là ngăn được điều đó, nhưng đổi lại: toàn bộ phần
rộng còn dư của panel (vượt quá 1024px/768px) bị bỏ hoang hoàn toàn thay vì bảng dùng nốt.

## Impact

Người dùng dùng layout xếp chồng (mặc định hoặc do chọn) trên màn hình rộng bị lãng phí phần lớn
chiều rộng cửa sổ ở mọi tab có bảng (Params, Tests) — không mất chức năng, nhưng phải cuộn dọc
nhiều hơn cần thiết cho nội dung lẽ ra vừa đủ nếu bảng dùng hết chiều ngang sẵn có.

## How It Was Found/Reproduced

Đọc trực tiếp `RequestPanel.tsx`, tìm thấy chú thích có sẵn giải thích chính xác lý do của
`max-w-5xl`/`max-w-3xl` — xác nhận nguyên nhân từ chính comment của tác giả trước, không phải suy
đoán. Ảnh chụp thật do người dùng gửi khớp chính xác với layout xếp chồng + giới hạn width mô tả
trong comment đó.

## The Fix

- Bỏ `max-w-5xl` (tab Params) và `max-w-3xl` (tab Tests) ở `RequestPanel.tsx` — section dùng hết
  chiều rộng panel thay vì bị chặn.
- Chuyển giới hạn xuống CẤP CỘT thay vì cấp section: `KeyValueEditor`'s `gridCols` đổi cột
  Name/Value/Resolved từ `minmax(0,1fr)` sang `minmax(0,16rem)`/`minmax(0,40rem)`/`minmax(0,20rem)`
  — vẫn sàn 0 (co lại bình thường ở pane hẹp) nhưng có TRẦN, nên khi panel rộng, khoảng trống thừa
  (nếu có, sau khi cả hai cột đã chạm trần) chỉ còn là một dải nhỏ bên cạnh bảng, không phải một
  khối lớn choán cả phần dưới/bên cạnh tab.
- Áp dụng cùng cách cho bảng Assertions (`RequestPanel.tsx`): cột Expression/Value từ
  `minmax(0,1fr)` sang `minmax(0,28rem)`.
- Đã đo bằng Playwright thật (không chỉ suy luận) để xác nhận CSS Grid phân bổ khoảng trống thừa
  đúng như kỳ vọng (dần cho tới khi mỗi track chạm trần riêng), không phải "đứng yên không giãn".

## Tests Added to Prevent Recurrence

`KeyValueEditor.test.tsx` — 2 test mới kiểm tra `gridCols` không còn là `minmax(0,1fr)` trần trụi
cho Name/Value/Resolved mà đã có mức trần cụ thể (16rem/40rem/20rem). Xác nhận cả 2 fail trên code
cũ, pass trên code mới (`git stash`).

Không có test tự động cho phần `RequestPanel.tsx` (bỏ `max-w-5xl`/`max-w-3xl`) vì đây thuần là bố
cục CSS không thể quan sát qua jsdom (không có layout engine thật) — đã xác minh bằng Playwright
chạy trên Chrome thật thay thế, chụp ảnh và đo `getBoundingClientRect()` ở cả hai layout
(side-by-side và xếp chồng).

## Lessons / Prevention Recommendations

- `minmax(0, 1fr)` (linh hoạt, tự hấp thụ khoảng trống thừa của container) và
  `minmax(0, <độ dài cố định>)` (chỉ là TRẦN, không tự hấp thụ khoảng trống nếu không còn track
  `fr` nào khác trong cùng grid) trông giống hệt nhau khi đọc code nhưng cho kết quả bố cục hoàn
  toàn khác một khi container rộng hơn tổng các mức trần — đừng suy luận suông, đo bằng
  `getBoundingClientRect()` thật (Playwright + Chrome hệ thống, không cần tải Chromium) trước khi
  kết luận, kể cả dựng một trang HTML cô lập tối giản để tách biến số khỏi phần còn lại của app.
- Khi một section-level `max-w` tồn tại chỉ để che một vấn đề ở TẦNG CON (một track `1fr` không
  giới hạn bên trong), việc bỏ nó đi phải đi kèm việc sửa đúng tầng con đó — bỏ mỗi `max-w` mà
  không sửa track con sẽ tái tạo lại đúng vấn đề gốc (input giãn quá cỡ) ở quy mô lớn hơn.
