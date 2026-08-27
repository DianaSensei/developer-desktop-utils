# Dialog size scale

## Phương án đã chọn

Thêm hai prop đóng (closed) vào `DialogContent` (`src/components/ui/dialog.tsx`) thay cho việc mỗi
dialog tự gõ `max-w-*`/`h-[NNvh]` riêng:

- `size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'` (mặc định `md`, đúng bằng `max-w-md` cũ —
  dialog nào không truyền `size` vẫn render y hệt trước khi có scale này).
- `scrollable?: boolean` — dành cho dialog phức hợp (có header/tab/footer riêng, không phải dạng
  "text căn giữa + nút" mặc định của Radix): chuyển từ `grid` sang `flex flex-col`, đặt
  `max-h-[85vh] overflow-hidden`, và reset `gap-4 p-6` mặc định thành `gap-0 p-0` (vì dialog dạng
  này tự vẽ border/padding cho từng phần, không dùng khoảng cách mặc định của Dialog).

Khảo sát trước khi sửa: 9 dialog phức hợp trong API Client dùng 5 giá trị `max-w-*` khác nhau
(2xl/3xl/4xl/5xl) không theo quy tắc chung, và chiều cao chia 3 nhóm — cố định theo vh
(`h-[70vh]`/`h-[80vh]`/`h-[82vh]`, mỗi dialog một con số tự chọn), `max-h` (chỉ 1 dialog), và
**không giới hạn chiều cao nào cả** (4 dialog: `EnvironmentEditor`, `VaultManager`,
`NodeSettingsDialog`, `ImportCurlDialog`) — nhóm cuối là bug thật: nội dung dài (nhiều secret
trong Vault, nhiều header trong NodeSettingsDialog) có thể đẩy dialog cao hơn viewport, mà
`DialogContent` không tự scroll — trên màn hình thấp (laptop nhỏ, cửa sổ đã thu nhỏ), phần nội
dung tràn ra sẽ không có cách nào cuộn tới.

## Lý do

- **Vì sao `max-h` chứ không phải `h` cố định**: `h-[82vh]` (RunnerDialog cũ) buộc dialog luôn cao
  82% viewport dù nội dung chỉ có vài dòng — khác hẳn tinh thần "gọn, không tốn không gian thừa"
  đang cần. `max-h-[85vh]` cho phép dialog co lại vừa đúng nội dung khi nội dung ngắn (ví dụ
  Runner chỉ chọn 2 request), và chỉ chạm mức trần khi nội dung thật sự dài — đúng cả hai chiều:
  không lãng phí không gian, không tràn màn hình.
- **Vì sao 85vh, không phải 70/80/82 như cũ**: không có lý do kỹ thuật nào để 3 con số đó khác
  nhau (chỉ là 3 người/3 lần khác nhau tự chọn) — chọn một mức duy nhất, đủ cao để hầu hết nội
  dung phức hợp không cần cuộn dialog nữa (chỉ cuộn bên trong từng pane), đủ thấp để luôn còn lề
  trên/dưới kể cả ở màn hình 720p.
- **Vì sao reset `gap-4 p-6` → `gap-0 p-0` gắn liền với `scrollable` thay vì để mặc định**: mọi
  dialog phức hợp hiện có đều đã tự vẽ `DialogHeader` với `border-b` + padding riêng — giữ
  `gap-4 p-6` mặc định của Dialog sẽ cộng dồn thành khoảng cách kép. Gắn 2 việc này vào cùng 1 cờ
  vì chúng luôn đi cùng nhau trong thực tế (chưa có dialog phức hợp nào cần `scrollable` mà lại
  muốn giữ padding mặc định).
- **Vì sao không tự động bọc `overflow-y-auto` cho pane bên trong**: mỗi dialog có layout khác
  nhau (một cột, hai cột chia trái/phải như `EnvironmentEditor`, nhiều tab như
  `NodeSettingsDialog`) — không có một điểm chèn `overflow-y-auto` chung nào đúng cho mọi trường
  hợp. `scrollable` chỉ đảm bảo *dialog* không tràn viewport; việc pane nào cuộn ra sao vẫn do
  từng dialog tự quyết, theo đúng pattern `min-h-0 flex-1 overflow-y-auto` đã dùng nhất quán ở
  `RunnerDialog`/`GenerateCodeDialog` từ trước.

## Rủi ro / follow-up đã biết

- Mới migrate 9 dialog của API Client sang scale này (`CookieManager`, `EnvironmentEditor`,
  `GenerateCodeDialog`, `ImportCurlDialog`, `ImportReviewDialog`, `NodeSettingsDialog`,
  `RunnerDialog`, `RuntimeVarsInspector`, `VaultManager`). Các dialog khác trong app (container
  tool, Kafka/RabbitMQ/Redis, onboarding, update...) vẫn dùng `max-w-*` viết tay như cũ — không
  sai (giá trị chúng chọn phần lớn đã hợp lý: `max-w-sm` cho confirm, `max-w-2xl` cho detail
  view), nhưng chưa được chuyển sang `size`/`scrollable` tường minh. Nên chuyển dần khi sửa các
  dialog đó vì lý do khác, không cần một đợt migrate riêng.
- `EnvironmentEditor`'s cột trái/phải trước đây cao cố định `h-[26rem]` (416px, không đổi theo
  viewport) — đổi thành `min-h-0 flex-1` để lấp đầy phần còn lại trong `max-h-[85vh]`. Trên màn
  hình rất cao, layout giờ cao hơn 416px một chút (tối đa tới 85vh) — chủ ý, tận dụng thêm không
  gian sẵn có thay vì cắt cứng ở 26rem.
