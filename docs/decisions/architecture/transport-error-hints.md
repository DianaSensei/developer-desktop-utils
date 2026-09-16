# Transport-error hints (CORS/Origin, TLS certificate, redirect loop) + cURL import safety checks

## Phương án đã chọn

Tiếp nối phát hiện "CORS" (xem `experience-log.md` entry cùng ngày): thêm một họ heuristic nhỏ,
đều theo cùng một khuôn — nhận diện 1 loại lỗi transport hay bị hiểu nhầm, chỉ hiện gợi ý (không
tự sửa), và luôn tắt gợi ý khi cấu hình liên quan đã ở trạng thái người dùng chủ động chọn:

- **`looksLikeCorsRejection(response)`** (đã có) — response 4xx nhắc CORS/Origin.
- **`looksLikeCertError(error)`** — lỗi transport (không có response) nhắc `certificate`/`ssl`/
  `tls`/`self signed`/`unknown issuer`... → gợi ý tắt **SSL Certificate Verification** (setting
  mới, xem dưới), chỉ hiện khi setting đó **đang bật** (mặc định).
- **`looksLikeRedirectLoop(error)`** — lỗi transport khớp đúng câu chữ reqwest dùng khi vượt số
  redirect cho phép ("too many redirects") → gợi ý xem lại **Max Redirects**, chỉ hiện khi
  `followRedirects` đang bật.
- **`looksLikeCmdFormat(input)`** + **`hasSessionCredentials(req)`** (trong `curl.ts`) — khi
  Import cURL: cảnh báo dán nhầm định dạng Windows cmd.exe (parser chỉ hiểu bash/POSIX), và ghi
  chú khi lệnh cURL mang theo Cookie/Authorization/basic-auth (ảnh chụp phiên đăng nhập, có thể
  hết hạn).

Setting mới đi kèm: **`RequestSettings.verifyTls: boolean`** (mặc định `true`) — tắt đi để chấp
nhận chứng chỉ TLS tự ký/hết hạn/sai hostname, nối vào `danger: { acceptInvalidCerts,
acceptInvalidHostnames }` mà `@tauri-apps/plugin-http`'s `fetch` đã hỗ trợ sẵn (xác nhận từ
`node_modules/@tauri-apps/plugin-http/dist-js/index.d.ts`, không phải đoán). Đọc theo đúng quy
ước đã có của mọi field boolean khác trong `RequestSettings` (`!== false` ở nơi dùng, không cần
backfill trong `normalizeRequest` — field vắng mặt tự hiểu là "đang bật").

## Lý do

- **Vì sao là gợi ý (Callout), không phải tự động sửa**: cả 4 heuristic đều dựa trên so khớp chữ
  trong thông điệp lỗi — có thể sai (một API hợp lệ nào đó tình cờ nhắc "certificate" vì lý do
  khác). Tự động bật `verifyTls: false` hay tự chèn header thay người dùng sẽ âm thầm hạ thấp mức
  an toàn hoặc đoán sai giá trị cần điền — chỉ dừng ở mức "đây có thể là lý do, đây là cách sửa".
- **Vì sao gate theo "setting đang ở mặc định"**: nếu người dùng đã chủ động tắt verifyTls/bật
  followRedirects theo ý riêng rồi mà vẫn lỗi, gợi ý cũ sẽ sai bối cảnh (họ đã biết và đã thử) —
  tắt gợi ý trong trường hợp đó tránh lặp lại lời khuyên vô ích.
- **Vì sao `--mono`/font hay accent tone (từ các quyết định trước) không liên quan mà vẫn tham
  chiếu cùng file `experience-log.md`**: không phải trùng hợp — cả loạt phát hiện này (CORS, giờ
  thêm TLS/redirect/cURL) đều cùng một dạng bài học: *lỗi hiển thị bằng thuật ngữ quen thuộc
  (CORS, cmd, cookie) nhưng nguyên nhân thật nằm ở một tầng khác (server tự kiểm tra, khác định
  dạng shell, khác phiên đăng nhập)* — gộp chung 1 decision doc vì cùng một nguyên tắc thiết kế
  giải pháp, dù mỗi case kỹ thuật khác nhau.
- **Vì sao dùng `danger` của plugin-http thay vì tự cấu hình reqwest ở Rust**: plugin đã expose
  đúng field này qua JS (`DangerousSettings`), nối thẳng từ `RequestSettings` có sẵn — không cần
  thêm Tauri command mới, không tăng bề mặt IPC.
- **Vì sao cURL-import checks nằm trong `curl.ts` (hàm thuần), không phải ngay trong
  `ImportCurlDialog.tsx`**: cùng quy ước đã áp dụng cho `looksLikeCorsRejection` (nằm trong
  `ResponsePanel.tsx`, cùng file với nơi dùng) — nhưng ở đây `curl.ts` đã tồn tại sẵn là nơi chứa
  logic parse cURL thuần (không phụ thuộc React), nên hàm nhận diện mới đi kèm nó thay vì tách
  riêng, giữ 1 nguồn xử lý cURL duy nhất, dễ test độc lập (`curl.test.ts`).

## Rủi ro / follow-up đã biết

- Chuỗi lỗi TLS/redirect thực tế phụ thuộc build reqwest/rustls cụ thể của `tauri-plugin-http`
  — regex hiện dựa trên các cụm từ phổ biến nhất (`self signed`, `UnknownIssuer`, "too many
  redirects" — câu chữ reqwest dùng đúng nguyên văn), nhưng chưa chạy thử trên bản build thật để
  xác nhận 100%. Nếu người dùng báo gợi ý không hiện dù đúng là lỗi cert/redirect, cần bổ sung
  cụm từ mới vào `CERT_ERROR_PATTERN`/`REDIRECT_LOOP_PATTERN`.
- `looksLikeCmdFormat` chỉ dựa trên 1 tín hiệu (`^` cuối dòng) — không phát hiện được mọi biến
  thể cmd (ví dụ người dùng đã tự xoá `^` khi dán). Đây là đánh đổi có chủ đích: thà bỏ sót một
  số trường hợp còn hơn báo nhầm một lệnh bash hợp lệ.
- Không thêm `verifyTls` vào cấp collection/folder (giống headers/vars/script/auth đã có) — đây
  là setting rủi ro bảo mật, cố ý giữ per-request, không kế thừa ngầm định để tránh 1 request bật
  sai lan sang cả cây collection mà người dùng không để ý.
