# Phân tích tham khảo → pattern

Ghi lại **vì sao** hệ này thành ra như vậy, để lần sau không phải suy luận lại từ đầu.
Ba nguồn, 15 ảnh, ba đợt.

---

## Nguồn 1 · Sony Color Lab (web, công cụ chuyên dụng)

Công cụ hiệu chỉnh màu — cùng loại bài toán với DevTool: **nhiều tham số, mật độ cao,
người dùng là chuyên gia**.

**Rút ra:**

1. **Công thức dòng bốn tầng** — nhãn + `?` · giá trị canh phải có trọng lượng ·
   tag phân loại · câu giải thích. Câu giải thích **luôn hiện**, không giấu sau tooltip.
   Đây là thứ DevTool thiếu nhất: 24 tool đầy tham số mà không giải thích gì.

2. **Tag phân loại tối đa hai loại.** Sony chỉ dùng `default` / `modified`. Ba loại
   trở lên thì tag hết phân loại được gì.

3. **Giá trị có trọng lượng thị giác riêng** — số đậm hơn nhãn, canh phải, `tabular-nums`.
   Người dùng quét cột số, không quét cột chữ.

4. **Bảng mật độ cao vẫn thở được** nhờ ngăn dòng bằng đường cực nhạt thay vì lưới đầy đủ.

---

## Nguồn 2 · Larme (tạp chí, in ấn)

Không phải giao diện — chọn có chủ ý, để lấy phần **mặt chữ và nhịp**.

**Rút ra:**

1. **Tương phản cỡ chữ mạnh** — tiêu đề rất lớn cạnh chữ nhỏ, ít bậc trung gian.
   Giao diện tẻ nhạt thường vì mọi thứ cùng cỡ.

2. **Chữ đơn cách viết hoa, giãn chữ rộng** làm nhãn phân mục (`eyebrow`) — thứ này
   chuyển sang giao diện rất tốt và gần như miễn phí.

3. **Khoảng trắng là cấu trúc**, không phải chỗ trống thừa.

**Không lấy**: bảng màu, serif, layout tạp chí. Ép in ấn vào công cụ dày đặc là sai.

---

## Nguồn 3 · MoMo (ứng dụng ví, Việt Nam) — 15 ảnh, 3 đợt

Nguồn quan trọng nhất, vì đây là **giao diện tiếng Việt thật, mật độ thật, người dùng thật**.

### Đợt 1–2

1. **Bài học lớn nhất — màu thương hiệu và màu trạng thái là hai hệ.**
   MoMo hồng đậm khắp nơi, nhưng toggle bật là **xanh lá**, cảnh báo là **cam**,
   lỗi là **đỏ**. Màu thương hiệu không bao giờ mang nghĩa trạng thái.
   → Đây là gốc của kiến trúc accent ba kênh: đổi tone được *vì* trạng thái nằm ngoài hệ đó.

2. **Tiêu đề mục nằm ngoài thẻ**, thẻ trắng bo góc lớn chứa nội dung. Nhóm rõ mà không cần viền.

3. **Chip trạng thái nhuộm nhạt** (`Đã kích hoạt` xanh lá nhạt) — nhẹ hơn badge đặc nhiều.

4. **Chữ tiếng Việt cần chỗ thở** — MoMo dùng `leading` rộng, vì dấu chồng hai tầng
   (`ế`, `ộ`, `ữ`) cần chiều cao.

### Đợt 3 (5 ảnh cuối)

5. **⭐ Một hình dạng dòng, năm loại điều khiển** — màn *Cài đặt tài khoản*.
   Icon · tiêu đề · mô tả cố định; bên phải là chevron / toggle / chip trạng thái /
   nút viền nhỏ / chip đổ xuống, tuỳ việc. Năm loại, không loại nào cần component mới.
   → Pattern chính cho Settings và mọi bảng cấu hình tool. Vòng 3 thiếu hẳn thứ này.

6. **⭐ Sửa lại quy tắc lồng thẻ.** Vòng 3 cấm "thẻ lồng trong thẻ". MoMo lồng liên tục
   (hộp `Ví MoMo` / `Túi Thần Tài` / `Timo` trong thẻ trắng) và đọc rất rõ.
   Quy tắc đúng nói về **độ nổi**, không phải số tầng: chỉ một tầng được đổ bóng,
   tầng trong dùng viền mảnh.

7. **Thông báo chỉ viền** (`Chia/Trả tiền · Đang chờ`, viền cam, không nền) — bậc thứ ba
   của hệ trạng thái, nằm giữa chip và dải nhuộm.

8. **Số liệu chính có trọng lượng thật** — `542.814đ` rất lớn và đậm, nhãn nhỏ bên cạnh.

9. **"Xem thêm" viền đứt nét** — affordance mở rộng rõ ràng là phụ.

10. **Cuộn ngang với thẻ ló một nửa** báo hiệu còn nội dung — tốt hơn thanh cuộn.

**Không lấy**: icon nhiều màu. Hợp với app tiêu dùng, nhưng DevTool có 24 tool và
mật độ cao hơn nhiều — icon nhiều màu sẽ thành nhiễu. DevTool dùng icon đơn sắc.

---

## Ba điều đã cấm nhầm ở vòng 3

Ghi lại để không ai cấm lại:

| Vòng 3 cấm | Thực tế |
|---|---|
| Gradient | Được — ở **nền môi trường**. Chỉ cấm trên nút và sau chữ đọc được. |
| Bo góc + màu trên nút | Được. Ràng buộc duy nhất là màu theo nghĩa. |
| Bo góc lớn cho thẻ | Được, 14–24px. Miễn là bán kính trong = ngoài − đệm. |
| Thẻ lồng trong thẻ | Được. Chỉ cấm **hai tầng cùng đổ bóng**. |

Bài học chung: quy tắc tốt nói về **cơ chế** (một tầng nổi, màu theo nghĩa), quy tắc
tồi nói về **hình thức** (không gradient, không lồng). Quy tắc hình thức chặn luôn cả
cách dùng đúng và làm giao diện tẻ nhạt.

---

## Vấn đề chưa giải quyết

**Mặt chữ chưa được kiểm chứng thật.** Trang mẫu chạy bằng font hệ thống vì môi trường
Artifact chặn font từ CDN. Đề xuất **Be Vietnam Pro + IBM Plex Mono** dựa trên lý lẽ,
chưa dựa trên quan sát. Phải dựng specimen thật trong app ở giai đoạn G1 và duyệt
trước khi khoá — bốn bài kiểm tra ở `TOKENS.md`.
