# Postmortem: Environments dialog không dùng hết chiều rộng + callout luôn chiếm nhiều chỗ - 2026-09-13

## Time Discovered

2026-09-13, người dùng gửi ảnh chụp thật của dialog Environments kèm nhận xét: "thiết kế lại
popup này, đảm bảo nó tối ưu không gian cho hiển thị những thứ quan trọng, kích thước match với
kích thước cửa sổ hiện tại, những đoạn chú thích không tự động chiếm không gian quá nhiều".

## Timeline of Events

- `workflow-router` phân loại bug-fix (kích thước dialog không thích ứng cửa sổ là hành vi sai,
  không phải yêu cầu tính năng mới).
- Đọc `EnvironmentEditor.tsx`: dialog dùng `DialogContent size="full"`.
- Đọc `dialog.tsx`'s `SIZE_CLASS`: `full` = `max-w-5xl` (1024px cố định); có sẵn comment của
  phiên trước cảnh báo đúng vấn đề này ("On a 1920px window `full` left nearly half the screen
  unused") và một tier `viewport` (`max-w-[94vw]`) đã tồn tại nhưng chưa được dùng ở đây.
- Đọc thêm: callout giải thích Collection/Global/Collection Variables luôn render đầy đủ, không
  có cách thu gọn.
- Checkpoint: trình bày cả 2 nguyên nhân, hỏi hướng sửa — người dùng chọn "cả hai" (đổi size +
  thu callout mặc định, có nút mở rộng).
- Sửa: `size="full"` → `size="viewport"`; tách callout thành bản tóm tắt 1 dòng (mặc định) +
  bản đầy đủ (mở qua nút "Learn more"/"Show less", state cục bộ không persist).
- Viết test xác nhận hành vi thu gọn/mở rộng, xác nhận fail trên code cũ / pass trên code mới
  (`git stash`). Xác nhận trực quan qua Playwright (dark mode, cửa sổ 1860px): dialog giờ rộng
  ~1750px thay vì cố định ~1024px, callout gọn 1 dòng.

## Initial Symptoms

Dialog Environments luôn hiện ở một kích thước cố định bất kể cửa sổ rộng hay hẹp, để lại nhiều
khoảng trống hai bên trên màn hình rộng; đoạn callout giải thích luôn chiếm 3 dòng ở đầu dialog,
đẩy danh sách environment/bảng biến xuống dưới mỗi lần mở, kể cả khi người dùng đã đọc rồi.

## Root Cause

1. `EnvironmentEditor.tsx` dùng `DialogContent size="full"` — nhưng trong `dialog.tsx`,
   `SIZE_CLASS.full = 'max-w-5xl'` (1024px), một giá trị TUYỆT ĐỐI, không theo `vw`. Tên "full"
   gây hiểu lầm là "chiếm hết cửa sổ" nhưng thực chất chỉ là bậc rộng nhất trong một thang các
   `max-w-*` cố định. Component đã có sẵn tier `viewport` (`max-w-[94vw]`, thực sự theo % cửa
   sổ) dành đúng cho trường hợp này, chỉ chưa được áp dụng.
2. Callout giải thích thứ tự ưu tiên (Collection env / Global env / Collection Variables) được
   viết như một đoạn văn ~480 ký tự, luôn render đầy đủ không điều kiện — không có cơ chế thu
   gọn, nên ở bất kỳ độ rộng dialog nào không đủ lớn, nó chiếm nhiều dòng.

## Impact

Người dùng mở dialog Environments trên cửa sổ rộng thấy dialog nhỏ hơn hẳn cửa sổ (lãng phí
không gian hiển thị danh sách environment/bảng biến), và ở bất kỳ độ rộng nào cũng phải cuộn
qua đoạn callout dài trước khi thấy nội dung thao tác chính — không mất chức năng, nhưng trải
nghiệm rườm rà mỗi lần mở, kể cả người dùng đã quen thuộc.

## How It Was Found/Reproduced

Đọc trực tiếp `EnvironmentEditor.tsx` và `dialog.tsx`; `dialog.tsx` đã tự ghi chú rõ đúng vấn đề
này ở tier `full` từ trước — chỉ cần đối chiếu với ảnh chụp thật của người dùng để xác nhận đây
đúng là nguyên nhân, không phải suy đoán.

## The Fix

- `EnvironmentEditor.tsx`: `DialogContent size="full"` → `size="viewport"` (`max-w-[94vw]`,
  thực sự co giãn theo cửa sổ).
- Callout giải thích: thêm state `explainerOpen` (mặc định `false`, không persist). Khi đóng,
  hiện bản tóm tắt 1 dòng ("Precedence: Collection env → Global env → Collection Variables. Use
  `{{name}}` in a request."); khi mở (nút "Learn more"), hiện đúng đoạn văn đầy đủ như cũ (nút
  đổi thành "Show less" để đóng lại). Dùng `Callout`'s `actions` slot có sẵn cho nút, không cần
  sửa component `Callout` dùng chung.

## Tests Added to Prevent Recurrence

`EnvironmentEditor.test.tsx` (mới) — render dialog thật (qua `useApiStore()` thật, không mock),
xác nhận: mặc định chỉ thấy dòng tóm tắt (không thấy câu "scoped to one..." của bản đầy đủ), bấm
"Learn more" thấy đúng đoạn văn đầy đủ, bấm "Show less" quay lại tóm tắt. Xác nhận fail trên code
cũ / pass trên code mới bằng `git stash`.

Không có test tự động cho phần đổi `size="viewport"` (thuần CSS/bố cục, không quan sát được qua
jsdom) — xác nhận bằng Playwright chụp ảnh thật ở chế độ tối, cửa sổ 1860px: dialog rộng ra đúng
theo cửa sổ (~1750px thay vì cố định ~1024px).

## Lessons / Prevention Recommendations

- Một tên size tier nghe có vẻ tự giải thích (`full`) có thể vẫn là một giá trị TUYỆT ĐỐI chứ
  không phải "chiếm hết cửa sổ" — luôn đọc định nghĩa thật (`SIZE_CLASS`) trước khi tin vào tên
  gọi, đặc biệt khi component đã có sẵn một tier khác (`viewport`) đúng nghĩa hơn cho nhu cầu.
- Một đoạn callout giải thích "đọc một lần là đủ" (không phải cảnh báo cần thấy lại mỗi lần)
  nên thu gọn mặc định với một cách mở rộng khi cần, thay vì luôn hiện đầy đủ — đặc biệt trong
  một dialog/popup có nội dung thao tác chính bên dưới nó.
