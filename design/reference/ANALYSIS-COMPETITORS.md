# Nguồn 6 · Hoppscotch / Insomnia / Thunder Client / Requestly — 4 ảnh

> Người dùng gửi ảnh chụp thật cho 3/4 tool (Hoppscotch, Insomnia, Thunder Client). Requestly chỉ có
> ảnh trang tính năng marketing (feature grid), không phải ảnh giao diện app thật — mọi nhận xét về
> Requestly dưới đây bị giới hạn ở đó, không suy diễn thêm về UI thật của nó.
>
> Phạm vi đợt này (đã chốt qua checkpoint với người dùng): **API Client chuyển sang dùng chung
> `ToolPane`/`PaneHeader`** — bề mặt đầu tiên trong danh sách các vấn đề đã chẩn đoán nhưng chưa sửa ở
> `ANALYSIS-DBX.md` ("Đợt 2 chưa sửa"). Thuần styling/layout, không đổi mô hình dữ liệu. Ảnh 4 nguồn
> này dùng làm tham khảo cho riêng lớp toolbar/header/chrome, không phải viết lại toàn bộ cây
> sidebar hay bảng dữ liệu (những phần đó đã có kết luận riêng ở ANALYSIS-DBX.md/ANALYSIS-POSTMAN.md).

## Hoppscotch

- Rất phẳng: viền 1px mảnh, gần như không đổ bóng, bo góc `rounded-md` vừa phải.
- Thanh trên cùng: logo + dropdown, ô tìm kiếm toàn cục canh giữa, cụm nút bên phải dùng MÀU CÓ Ý
  NGHĨA (nút "Save" xanh lá = hành động tích cực/đồng bộ, nút "Login" tím = hành động chính) — không
  phải toàn bộ cụm cùng một tông.
- Dưới đó: dải tab request ngang (method màu chữ + tên + chấm nhỏ = chưa lưu), nút "+", dropdown môi
  trường, icon mắt (preview biến).
- Breadcrumb (Collection > Folder > Request) NGAY TRÊN thanh method+URL — một dòng riêng, không gộp
  chung với tab hay URL bar.
- Dải sub-tab (Parameters/Body/Headers/Authorization/Pre-request Script/Post-request Script) có một
  link "Variables" neo phải, tách biệt khỏi các tab chính bằng khoảng trắng, không phải một tab thêm.

## Insomnia

- Thanh trên cùng nặng về vai trò TỔ CHỨC (Personal Workspace dropdown, Invite, Enterprise Plan,
  avatar) hơn là thao tác request — khác hẳn Hoppscotch/DevTool đặt Send/method ngay hàng đầu.
  Không áp dụng cho DevTool (app một người dùng cục bộ, không có khái niệm invite/plan).
   - Trang chủ (chưa mở request nào) là dạng THẺ (card) trực quan cho collection/environment — icon
   loại + tên đậm + "X giờ/ngày trước" — khác hẳn cách trình bày dạng cây file phẳng. Không thuộc
   phạm vi đợt này (đợt này chỉ động vào toolbar/header, không đổi cách hiển thị cây/empty-state).
- Badge method là NỀN MÀU ĐẶC (pill), không phải chữ màu trên nền trong suốt — tương phản mạnh hơn
  cách hiện tại của DevTool (chữ màu, nền trong suốt) và của Thunder Client (cũng chữ màu).

## Thunder Client

- Mật độ cao nhất trong 4 nguồn, viền chia vùng ở khắp nơi (giữa mọi khối, không chỉ quanh card).
- Chỉ MỘT màu nhấn duy nhất (vàng hổ phách) cho mọi hành động chính ("New Request", "Send") — không
  pha trộn nhiều màu accent như Hoppscotch.
- Tab con (Headers, Response, Results...) đã có sẵn badge SỐ ĐẾM dạng superscript nhỏ cạnh tên tab
  (`Headers⁴`) — đúng mẫu DevTool vừa làm cho RequestPanel (Params/Tests) đợt trước, xác nhận hướng
  đã chọn khớp với một API client thật khác, không phải tự nghĩ ra.
- Không có khái niệm "chưa lưu" (giống DevTool — autosave), khớp kết luận đã ghi ở
  `ANALYSIS-POSTMAN.md`.

## Requestly (chỉ có ảnh trang tính năng, KHÔNG phải ảnh app thật)

Ảnh là một lưới 4 cột giới thiệu tính năng (marketing site): nhãn nhóm viết hoa, tracking rộng, màu
xám mờ ("BUILD & ORGANIZE", "TEST & AUTOMATE", "GOVERN & SECURE", "MORE TOOLS"), mỗi mục: icon +
tiêu đề đậm + mô tả mờ một dòng. Đây là mẫu trình bày TÍNH NĂNG, không phải chrome/toolbar của app
thật — không dùng làm căn cứ cho việc redesign toolbar/header đợt này. Nếu sau này cần tham khảo
UI thật của Requestly, cần xin ảnh chụp app thật riêng.

## Tổng hợp cho phạm vi đợt này (ToolPane/PaneHeader)

Ba điểm rút ra thật sự liên quan tới toolbar/header/chrome (không phải sidebar hay bảng dữ liệu):

1. **Breadcrumb tách dòng riêng, không gộp vào thanh URL** (Hoppscotch) — đáng cân nhắc nếu
   `PaneHeader` cần chỗ cho ngữ cảnh collection/folder của request đang mở.
2. **Cụm nút bên phải toolbar dùng màu theo Ý NGHĨA hành động, không đồng loạt một tông** (Hoppscotch)
   — nhất quán với nguyên tắc RULES.md hiện tại (accent tách khỏi state color), không phải điều mới.
3. **Một màu nhấn duy nhất, viền chia vùng rõ ràng** (Thunder Client) — khớp hướng "độ đặc đến từ
   ranh giới" đã rút ra từ DBX trước đó, thêm một điểm xác nhận độc lập.

Không có điểm nào trong 4 nguồn gợi ý MỞ RỘNG hiệu ứng kính mờ (glass) ra toolbar/chrome — cả 4 đều
phẳng, viền mảnh, không blur. Việc người dùng nhắc "độ sâu/3D/đổ bóng/hoạt ảnh kiểu Apple" là một
trục riêng (chuyển động + phân lớp qua shadow/viền), độc lập với 4 nguồn ảnh này — solution-architect
cần đề xuất cụ thể cho trục đó riêng, đối chiếu với nguyên tắc "border-driven depth, không
shadow/gradient" hiện có trong RULES.md.
