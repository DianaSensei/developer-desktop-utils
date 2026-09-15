# UI font preference ("choose font from system")

## Phương án đã chọn

Thêm một preference mới `FontPreference` (`src/lib/fontPreference.ts`), y hệt khuôn của
`accentPreference.ts` (tone chủ đạo) đã có sẵn:

- 4 lựa chọn cố định: `default` (Be Vietnam Pro, mặc định hiện tại), `system` (mặt chữ UI của hệ
  điều hành — San Francisco/macOS, Segoe UI/Windows, Ubuntu·Cantarell/Linux GNOME), `serif`
  (`ui-serif`/Georgia), `classic` (Helvetica/Arial — sans hình học, khác dáng nhân văn bo tròn
  của Be Vietnam Pro).
- Áp dụng bằng `document.documentElement.dataset.font = pref`, đọc bởi 4 khối
  `[data-font="…"]` mới trong `design/tokens.css` — chỉ override `--sans`, không đụng `--mono`.
- Lưu qua `storageGet/storageSet` (Tauri store, giống mọi preference khác), áp một lần lúc boot
  trong `main.tsx` (cùng chỗ với `applyAccentToDocument`), trước khi React vẽ khung hình đầu
  tiên.
- UI: 1 hàng `SettingRow` mới trong Settings → Giao diện, ngay dưới hàng Tông màu, dùng `Select`
  (không dùng dạng "swatch tròn" như tone màu vì đây là text label, không phải màu để so trực
  quan).

## Lý do

- **Vì sao "chọn font từ hệ thống" lại là stack CSS generic, không phải liệt kê font thật cài
  trên máy**: Tauri chạy WebView riêng của từng OS (WebView2/WKWebView/WebKitGTK), không có API
  chung để liệt kê font hệ thống thật cả ba nền — muốn làm đúng phải viết command Rust riêng cho
  từng OS (macOS: Core Text; Windows: DirectWrite; Linux: fontconfig), tốn công gấp nhiều lần cho
  lợi ích không tương xứng với yêu cầu thực tế ("có vài lựa chọn khác nhau để đổi gu đọc"). Stack
  CSS generic (`system-ui`, `ui-serif`, tên font cụ thể làm fallback đầu) đã trỏ đúng vào font hệ
  thống thật — trình duyệt/WebView tự phân giải ra font cài sẵn tương ứng trên máy đó, không cần
  biết trước tên chính xác.
- **Vì sao không đổi `--mono` theo lựa chọn này**: đọc mã/số liệu (JSON, header, mã request) cần
  một chuẩn cố định để căn cột/đếm ký tự chính xác — đổi mono theo gu đọc chung sẽ phá vỡ mọi chỗ
  dựa vào `ch`/độ rộng ký tự cố định của monospace. Bruno/Postman/VS Code cũng tách hai khái niệm
  "font UI" và "font code" làm hai setting độc lập vì lý do này.
- **Vì sao mirror đúng khuôn `accentPreference.ts`**: đây là preference thứ hai cùng hình dạng
  (`data-*` attribute → khối CSS tương ứng trong `design/tokens.css` → áp một lần lúc boot) — dùng
  lại đúng khuôn thay vì phát minh cơ chế mới giữ cho `main.tsx`'s bootstrap sequence dễ đọc (hai
  dòng liền nhau, cùng dạng) và cho test (`fontPreference.test.ts`) đối chiếu tự động với
  `design/tokens.css` giống hệt `accentPreference.test.ts` đã làm cho tone.
- **Vì sao đặt trong `design/tokens.css`, không phải `src/design-system/tokens.css`**: file đó tự
  ghi rõ ngay đầu file — "Giá trị KHÔNG nằm ở đây. Nguồn sự thật là `design/tokens.css`... Muốn
  đổi màu, bo góc, chiều cao control → sửa `design/tokens.css`, không sửa đây" — và
  `src/design-system/tokens.css` đã `@import` thẳng file đó, nên sửa đúng chỗ nguồn.

## Rủi ro / follow-up đã biết

- Không có bước "làm mượt" khi đổi font lúc đang chạy (không giống theme sáng/tối vốn có khoảng
  chuyển CSS) — đổi tức thời. Chấp nhận được vì đây là hành động chủ động của người dùng trong
  Settings, không phải trạng thái đổi ngầm cần báo hiệu êm.
- 4 lựa chọn là một tập cố định chọn từ đầu, không mở rộng theo yêu cầu tương lai kiểu "tôi muốn
  đúng font X cài trên máy tôi" — nếu nhu cầu đó xuất hiện thật, hướng đi đúng là một Tauri
  command Rust liệt kê font hệ thống (xem lý do ở trên), không phải thêm generic stack thứ 5/6/7
  đoán mò tên font phổ biến.
