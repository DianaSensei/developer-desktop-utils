# Name/Value table — cột Resolved và mật độ khi có nhiều dòng

## Phương án đã chọn

`KeyValueEditor` (query params, headers, urlencoded body, environment variables) nhận ba thay
đổi, tất cả nhắm vào cùng một tình huống: một bảng **nhiều dòng**, nhiều dòng dùng `{{var}}`.

**1. Cột `Resolved`.** Trước đây muốn biết `{{userId}}` đang là bao nhiêu thì phải rê chuột vào
đúng token đó và đọc tooltip — ổn với một biến, vô dụng với bảng hai mươi dòng. Nay có thêm một
cột chỉ-đọc hiển thị giá trị sau khi thay thế, tính bằng `previewVars` (`vars.ts`, thuần + có
test):

- Dòng không chứa token → ô trống (không lặp lại nguyên văn giá trị ở cột bên cạnh).
- Dòng có token và giải được hết → chuỗi đã thay thế, `font-mono text-fg-mute`, `title` giữ bản
  đầy đủ khi bị cắt.
- Dòng có token **không** giải được → chữ đỏ `{{token}} undefined` kèm `title` giải thích rằng
  token đó sẽ được gửi đi nguyên văn. Đây mới là trường hợp đáng hét lên: request thật sự bay đi
  với chuỗi `{{userId}}` trong đó.

Cột chỉ xuất hiện khi bảng có ít nhất một token (và có `vars`), quyết định dựa trên **toàn bộ**
dòng chứ không phải dòng đang hiển thị — lọc xuống còn dòng không token không được phép rút cột
ra khỏi bảng ngay dưới tay người đang gõ.

**2. Lọc trong bảng.** Từ `FILTER_THRESHOLD = 8` dòng trở lên, bảng tự mọc ô search + số đếm
`khớp/tổng`. AND với `filterQuery` mà cha truyền vào (ô search của Environment editor), không
thay thế nó. Như `filterQuery` sẵn có, lọc chỉ ảnh hưởng *cái được vẽ ra*: `onChange` luôn nhận
đủ mọi dòng, nên sửa khi đang lọc không thể âm thầm làm mất dòng đang bị ẩn.

**3. Kẻ sọc (zebra) + hover mạnh hơn.** Dòng chẵn/lẻ so le nền `bg-bg-2/20`, hover nâng từ
`/20` lên `/40`. Đây đúng là cặp giá trị `DataTable` đang dùng (`Tbody zebra` + `Tr interactive`),
không phải giá trị mới.

Bên cạnh đó, **bulk edit** đổi từ `min-h-[180px]` cố định của `CodeSurface` sang
`flex-1 min-h-[34vh]` trong một cột flex `h-full`, và có thêm một dòng nhắc cú pháp
(`key: value` mỗi dòng, `//` để tắt một dòng). Pane params rộng ra `max-w-5xl` (từ `3xl`) để ba
cột chữ có chỗ thở.

## Lý do

- **Vì sao là cột chứ không phải mở rộng tooltip.** Tooltip trả lời được "biến này là gì" cho
  *một* token tại *một* thời điểm. Câu hỏi thật khi nhìn một bảng params là "cái nào sẽ gửi đi
  sai" — đó là câu hỏi so sánh, và so sánh cần mọi giá trị hiện diện cùng lúc trên cùng một cột.
- **Vì sao cột ẩn khi không có token.** Bảng headers điển hình toàn giá trị nguyên văn; một cột
  rỗng cố định ở đó là đúng loại "khoảng trống trang trí" mà checklist UI của repo cấm. Nó xuất
  hiện đúng khoảnh khắc trở nên hữu ích (token đầu tiên được gõ).
- **Vì sao bí mật không cần xử lý riêng.** Map `vars` mà UI nhận (`varMap` trong `ApiClient.tsx`)
  đã thay Vault và biến `secret` bằng `••••••••` từ nguồn. Cột này đọc đúng map đó, nên không có
  đường nào để một giá trị bí mật thật lọt ra — nó chỉ có thể lặp lại cái mặt nạ. Ranh giới Vault
  vẫn nguyên vẹn, không cần thêm luật mới.
- **Vì sao hover phải mạnh lên khi thêm zebra.** Hover cũ (`/20`) trùng đúng bằng sọc — hover một
  dòng có sọc sẽ không đổi gì cả, tức là mất phản hồi tương tác. Lấy luôn cặp `/20` + `/40` của
  `DataTable` thay vì tự chọn một mức opacity thứ ba.
- **Vì sao ngưỡng 8 dòng.** Dưới mức đó liếc mắt nhanh hơn gõ chữ để lọc; trên mức đó bảng bắt
  đầu dài hơn một màn hình trong pane request hẹp.

## Rủi ro / follow-up đã biết

- **Cột xuất hiện/biến mất gây dịch layout một lần** khi token đầu tiên được gõ (hoặc token cuối
  bị xoá). Đã cân nhắc luôn hiện cột khi có `vars` để tránh hẳn, nhưng đổi lại là một cột rỗng
  thường trực ở mọi bảng headers — chọn dịch một lần.
- **`PathParamsEditor` (RequestPanel.tsx) vẫn là bảng 4 cột viết tay** khớp grid cũ của
  `KeyValueEditor` để cột Value thẳng hàng giữa các bảng. Khi bảng Query có cột Resolved còn nó
  thì không, hai bảng không còn thẳng hàng. Chấp nhận được (mỗi bảng có header riêng), nhưng nếu
  sau này thấy chướng thì hướng xử lý là cho nó dùng chung `ResolvedValue`.
- **`MultipartEditor` (form-data) chưa có cột này** vì nó chưa nhận `vars` chút nào — thêm sẽ là
  một thay đổi riêng, không chỉ là thêm cột.
- Ô lọc của bảng là **state cục bộ**, không được nhớ: đóng/mở lại request là mất bộ lọc. Đúng ý
  đồ (bộ lọc là thao tác nhất thời), nhưng nếu ai đó muốn nó dính thì đó là chỗ sửa.
