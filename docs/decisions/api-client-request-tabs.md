# API Client — request panel tab consolidation

## Phương án đã chọn

Gộp tab **Assert** (bảng assertion khai báo: Expr/Operator/Value) vào tab **Tests**, thay vì
xoá hẳn assertion khai báo hoặc gộp luôn vào **Script**. Tab **Tests** giờ hiển thị:

1. Bảng Assertions (component `AssertEditor`, không đổi logic) ở trên.
2. Editor script test (JS, `test()`/`expect()`) ở dưới — như cũ.

`RequestPanelTab` bớt còn 8 giá trị (`params | headers | body | auth | script | vars | tests
| settings`), không còn `'assert'`. `request.assertions` và `request.tests` vẫn là hai field
dữ liệu tách biệt, thứ tự chạy trong `engine.ts` (post-response vars → post-response script →
tests script → assertions) không đổi — đây thuần là gộp UI, không đụng execution.

Đồng thời bỏ khối "Resolved URL" (preview URL đã resolve {{var}}/path param) khỏi tab Params —
không đủ giá trị so với diện tích chiếm, và Send luôn cho thấy URL thật đã gửi.

### Follow-up: gộp tiếp tab Vars vào Script

Sau khi hoàn thành gộp Assert→Tests, tiếp tục gộp tab **Vars** (bảng khai báo Pre/Post Request
var) vào tab **Script**, xuống còn 7 tab (`params | headers | body | auth | script | tests |
settings`). Lý do khác với case Assert: Vars và Script không phải hai cách biểu diễn của cùng
một việc thuộc chung 1 giai đoạn kiểm tra (như Assert/Tests) — Vars khai báo và Script code đều
dùng để **set biến**, chạy đúng cùng giai đoạn (`engine.ts`: "pre-request vars → pre-request
script", "post-response vars → post-response script" — vars luôn chạy TRƯỚC script cùng giai
đoạn). Tách 2 tab cạnh nhau cho cùng một nhu cầu khiến user mới không biết nên dùng cái nào.

Cách gộp: mỗi khối Pre-request/Post-response trong tab Script giờ có thêm 1
`CollapsibleSection` "Vars" (component mới `VarsSection`) nằm giữa đoạn hint và ô script editor
— đúng thứ tự chạy thật. Mặc định **đóng** khi rỗng (`defaultOpen={filled > 0}`) để không tốn
chỗ cho trường hợp phổ biến (không dùng Vars khai báo, chỉ viết script) — chỉ hiện badge số
lượng khi đã có var. `VarsEditor` (component tab riêng cũ) bị xoá; `toKv`/`fromKv` giữ nguyên,
dùng trực tiếp trong `ScriptEditor`.

## Lý do

- User yêu cầu cụ thể: "gộp assert và test lại, hoặc merge chung với Script nếu có thể, work
  giống Postman" — Postman không có UI assertion khai báo riêng (chỉ có script-based
  `pm.test`), nhưng UI khai báo hiện có của app này giúp việc viết assertion đơn giản nhanh
  hơn code, không có lý do để xoá.
- Không gộp vào **Script**: tab Script giữ nguyên vai trò "pre-request + post-response mutate
  req/res, set biến" — một mối quan tâm khác với "kiểm tra kết quả response có đúng không".
  Gộp Assert+Tests vào chung Script sẽ biến 1 tab thành 3 việc khác nhau (mutate request,
  mutate response, verify response) — khó điều hướng hơn, không phải "giống Postman" (Postman
  Scripts tab dù gộp pre/post cũng chỉ là 1 loại việc: script chạy theo giai đoạn).
- Gộp Assert vào Tests hợp lý hơn vì cả hai đều thuộc giai đoạn post-response và cùng mục
  đích "assertion" — chỉ khác cách biểu diễn (khai báo vs code). Giữ nguyên `AssertEditor` và
  thứ tự chạy trong `engine.ts` để không đổi hành vi runner/CI hiện có (xem `engine.test.ts`,
  `runnerFlow.test.ts` — không sửa gì, vẫn pass).
- `panelTabs` (tab đang mở của mỗi request, `ApiClient.tsx`) là `useState` in-memory, không
  persist ra `localStorage` — nên bỏ `'assert'` khỏi type không cần migration.

## Rủi ro / follow-up

- Nếu sau này card muốn xem riêng "chỉ assertions" hoặc "chỉ script" tách bạch hơn (vd khi số
  lượng assertion rất lớn), có thể cân nhắc thêm sub-tab bên trong Tests thay vì tách lại
  thành 2 tab cấp cao nhất.
