# Postmortem: Settings page khoảng trống 2 bên quá lớn - 2026-09-13

## Time Discovered

2026-09-13, người dùng gửi ảnh chụp thật của trang Settings (Appearance) trên cửa sổ rộng kèm
nhận xét: "điều chỉnh không gian trống 2 bên, nó nên tương thích gần hơn với kích thước cửa sổ
thay vì để không gian quá trống 2 bên khi cửa sổ được mở rộng chiều ngang".

## Timeline of Events

- `workflow-router` phân loại bug-fix.
- Đọc `Settings.tsx`: content pane bọc `mx-auto max-w-2xl` quanh mỗi mục.
- Checkpoint: xác nhận đây là quyết định có chủ đích từ trước (kiểu DBX, ưu tiên đọc-được) chứ
  không phải một lỗi kỹ thuật — hỏi hướng sửa cụ thể (nới rộng cố định / co giãn theo %/ bỏ hẳn
  cap). Người dùng chọn nới rộng cố định, gợi ý cụ thể 672px → 960px.
- Đổi `max-w-2xl` → `max-w-[60rem]` (960px, đúng con số đề xuất).
- Xác nhận trực quan qua Playwright (dark mode, cửa sổ 1860px): card content rộng ra rõ rệt
  (~900px, so với ~670px trước đó).

## Initial Symptoms

Trang Settings (mọi mục: Appearance, Tools, Keyboard Shortcuts...) hiện nội dung trong một card
canh giữa, rộng cố định 672px, để lại khoảng trống hai bên lớn hơn cả bản thân card trên cửa sổ
rộng.

## Root Cause

`Settings.tsx`, dòng bọc content pane: `<div className="mx-auto max-w-2xl space-y-4 px-6 py-6">`
— `max-w-2xl` (42rem/672px) là một giá trị TUYỆT ĐỐI, không theo `vw`/`%` của pane chứa nó
(`min-w-0 flex-1`). Đây là lựa chọn có chủ đích từ đợt redesign Settings trước (ưu tiên dòng mô
tả không quá dài để đọc, theo phong cách DBX), nhưng con số 672px không còn phù hợp với độ phân
giải màn hình phổ biến hiện nay, khiến khoảng trống hai bên trở nên bất cân xứng rõ rệt.

## Impact

Chỉ ảnh hưởng thẩm mỹ/cảm giác về không gian — không mất chức năng. Trang Settings trông "trống"
bất thường trên màn hình rộng, đặc biệt dễ nhận thấy vì đây là trang người dùng ghé thường xuyên.

## How It Was Found/Reproduced

Đọc trực tiếp `Settings.tsx`, xác nhận `max-w-2xl` là nguyên nhân duy nhất (không có cap nào khác
lồng bên trong ở cấp thấp hơn cho trang này, khác với case KeyValueEditor cùng ngày). Đối chiếu
với ảnh chụp thật của người dùng khớp chính xác.

## The Fix

`max-w-2xl` (672px) → `max-w-[60rem]` (960px) — vẫn là giá trị cố định (không đổi sang % cửa sổ,
theo đúng lựa chọn người dùng xác nhận ở checkpoint), chỉ nới con số để đỡ trống hơn ở độ rộng cửa
sổ phổ biến, giữ nguyên tinh thần đọc-được ban đầu của thiết kế DBX.

## Tests Added to Prevent Recurrence

Không có test tự động — đây là một hằng số CSS đơn lẻ (`max-w-2xl` → `max-w-[60rem]`), không có
logic để kiểm; xác nhận bằng Playwright chụp ảnh thật ở cửa sổ 1860px, dark mode, cho thấy card
rộng ra rõ rệt (~900px so với ~670px trước).

## Lessons / Prevention Recommendations

- Một max-width cố định phục vụ mục đích đọc-được (readability cap) không tự động sai chỉ vì để
  lại khoảng trống ở cửa sổ rộng — cần phân biệt giữa "con số đã lỗi thời, cần nới" (case này) và
  "cap đặt sai TẦNG, che luôn cả phần không cần che" (case KeyValueEditor/RequestPanel cùng ngày,
  xem `docs/postmortems/api-client-requestpanel-width-usage.md`). Xác nhận với người dùng hướng
  sửa cụ thể trước khi đụng vào một quyết định thiết kế đã có chủ đích ghi lại trong code, thay vì
  tự ý bỏ cap hoàn toàn.
