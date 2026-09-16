# Corner style preference (Kiểu bo góc) + `rounded` trần vào hệ token

## Phương án đã chọn

Thêm preference thứ tư cùng khuôn với `accentPreference` / `fontPreference` /
`monoFontPreference`:

- `CornerStyle` = `sharp | default | round` (`src/lib/cornerPreference.ts`), áp bằng
  `document.documentElement.dataset.corner`, đọc bởi ba khối `[data-corner="…"]` mới trong
  `design/tokens.css`, lưu qua `storageGet/storageSet`, áp một lần lúc boot trong `main.tsx`
  ngay dưới `applyAccentToDocument`.
- Mỗi preset đặt lại **cả thang** `--r-default` → `--r-xl`. `--r-full` cố ý không nằm trong
  preset: pill vẫn là pill ở cả ba.
- UI: một `SettingRow` dùng `Segmented` trong Settings → Giao diện, ngay dưới hàng Tông màu
  (ba lựa chọn ngắn, so sánh trực tiếp — không cần `Select` như hàng mặt chữ).
- Trang mẫu `design/preview/index.html` có nút tương ứng, để kit không trôi lệch khỏi app.

Kèm theo, vì không có nó thì preset không có tác dụng thật:

- Token mới `--r-default: 4px`, và `borderRadius.DEFAULT` trong
  `design/tailwind-preset.cjs` trỏ vào nó.
- Rule guard mới `hardcodedRadius` (`src/design-system/guard.test.ts`), ngưỡng **0**; chỗ vi
  phạm duy nhất (`SelectionBar.tsx`, `rounded-[3px]`) đã dọn.

## Lý do

- **Vì sao cho người dùng chọn bo góc, chứ không chọn hộ**: đây là gu chia rẽ mạnh nhất giữa
  hai nhóm người dùng cùng ngồi trong một cửa sổ công cụ — người quen IDE (VS Code,
  JetBrains: 2–4px) đọc thang 14–24px là "mềm quá, giống app điện thoại"; người quen app hiện
  đại đọc thang 2–4px là "thô". Không có giá trị đúng cho cả hai. Tham khảo DBX
  (`design/reference/ANALYSIS-DBX.md`) — nó cho chọn `none/small/large` và đó là một trong số
  rất ít tuỳ chọn giao diện người dùng thật sự đụng tới.
- **Vì sao rẻ**: thang `--r-*` đã tập trung một chỗ từ vòng bốn, nên preset chỉ là ba dòng CSS
  — không component nào biết mình vừa bị đổi. DBX phải khai 8 biến × 3 preset vì thang của nó
  rải rác hơn.
- **Vì sao phải kéo `rounded` trần vào token**: `borderRadius` khai trong `theme.extend`
  **không phủ khoá `DEFAULT`**, nên `rounded` trần vẫn trả `0.25rem` cứng — và repo có **151
  chỗ** dùng nó. Không xử lý thì đổi sang "Vuông" sẽ để lại 151 chỗ ở 4px, lệch với hàng xóm,
  và triệu chứng ("một vài khối trông lạ") rất khó lần về nguyên nhân. Token mặc định đặt đúng
  4px = 0.25rem nên **không chỗ nào đổi hình** khi chưa đổi preset.
- **Vì sao thêm guard thay vì chỉ ghi luật**: preset bo góc là tính năng đầu tiên mà một bán
  kính viết cứng gây hậu quả *nhìn thấy được*. Luật trong `RULES.md` không tự chặn PR; rule
  đếm trong `guard.test.ts` thì có, và nó dùng đúng cơ chế ngưỡng-lùi-dần đã có sẵn.
- **Vì sao `--r-full` đứng ngoài**: bán kính đầy không phải một bậc trên thang mà là một *hình
  dạng* khác. Cho nó chạy theo preset thì ở "Vuông" mọi pill/avatar hoá hình chữ nhật — không
  ai muốn thế khi bấm "bo góc vuông hơn".

## Rủi ro / follow-up đã biết

- Ba preset là tập cố định, không phải thanh trượt. Cố ý: thang phải giữ **tỷ lệ giữa các bậc**
  (quy tắc "bán kính trong = ngoài − đệm"), một thanh trượt tự do sẽ phá quan hệ đó.
- Chưa nhìn tận mắt cả ba preset trên app thật ở cả sáng/tối — đã kiểm bằng test + build, còn
  duyệt mắt thì cần chạy `npm run tauri:dev` (agent không tự chạy app, theo `docs/ai/CLAUDE.md`).
  Trang mẫu `design/preview/index.html` mở trực tiếp bằng browser là cách xem nhanh nhất.
- Không có hiệu ứng chuyển khi đổi preset — đổi tức thời, như hàng mặt chữ. Chấp nhận được vì
  đây là hành động chủ động trong Settings.
