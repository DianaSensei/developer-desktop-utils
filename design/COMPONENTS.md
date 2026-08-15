# Component — spec

Mỗi mục: **cấu trúc → biến thể → khi nào dùng**. Xem bản chạy được tại
`design/preview/index.html`.

---

## 1 · Nút

Bốn biến thể. Vòng thiết kế thứ ba chỉ có ba biến thể đầu, và đó là lý do giao diện
bị đánh giá là tẻ nhạt: chỉ còn hai thái cực — **chói** (đặc) hoặc **vô hình** (ghost).

| Biến thể | Hình thức | Dùng cho |
|---|---|---|
| `solid` | nền accent đặc, chữ trắng | **Một** hành động chính mỗi màn |
| `tint` | nền `--acc-tint`, chữ `--acc-ink` | Hành động phụ có trọng lượng — **mảnh còn thiếu** |
| `outline` | viền `--line`, nền trong suốt | Hành động ngang hàng nhau |
| `ghost` | không viền, hiện nền khi rê | Trong toolbar dày đặc |

**Phím tắt nội tuyến**: đặt trong nút, ngăn bằng một vạch mảnh
(`border-left: 1px solid` với alpha thấp), không phải dấu ngoặc.

**Cấm**: hover-lift, glow, gradient. Rê chuột chỉ đổi nền/viền.

Chiều cao: `--h`. Chỉ hành động chính của trang mới dùng `--h-lg`.

---

## 2 · Ô nhập

```
┌─────────────────────────────────────────────┐
│ [máng] │ nội dung gõ                 [chỉ số] │
└─────────────────────────────────────────────┘
  [chip] [chip]        ← phần dư xuống đây
```

- **Máng định dạng** (trái): nhãn kiểu dữ liệu — `JSON`, `cron`, `hex`. Nền `--sunk`,
  ngăn bằng viền phải.
- **Chỉ số** (phải): **một** con số — số ký tự, số dòng, hoặc thời gian.
- **Quy tắc tối đa hai phụ kiện.** Mọi thứ khác xuống chip bên dưới.

Không có quy tắc này, ô nhập của DevTool sẽ mọc dần cho tới khi chỗ gõ chữ còn 40%.

---

## 3 · Ba bậc trạng thái

### Chip — `StatusChip`
Chấm tròn + nhãn, đặt ở **thanh tiêu đề panel**. Ba tông: `ok` / `warn` / `bad`
(+ `info`). Để liếc là thấy.

### Thông báo viền — `OutlineNotice`
**Chỉ viền màu, không nền.** Bậc nhẹ nhất — dùng cho việc đang chờ xử lý, không khẩn.

> Ví dụ: *"Đang chờ · 2 consumer chưa đóng khi thoát tool lần trước"* + nút "Đóng hết"

### Dải nhuộm — `ExplainBand`
Nền `-tint`, viền `-edge`, **nằm trong thân panel**. Chỉ hiện khi có gì đáng nói.
Kèm chip ví dụ để sửa được ngay.

**Cả ba nằm trong panel** → chuyển hợp lệ ↔ lỗi không làm layout nhảy.
Đây là lý do không dùng thẻ cảnh báo rời.

Cùng component phải dùng được để **dạy** (tông `ok`) chứ không chỉ **báo lỗi** (`bad`).

---

## 4 · Dòng tham số — công thức bốn tầng

Học từ Sony Color Lab. Mỗi dòng có đúng bốn thành phần, theo thứ tự:

```
Poll interval  ?        500ms      [mặc định]     Bao lâu client hỏi broker một lần
└─ nhãn + help          └─ giá trị  └─ tag        └─ câu giải thích
   (fg thường)            canh phải,   phân loại      (fg-mute, 1 dòng)
                          có trọng     (tối đa 2
                          lượng          loại/danh sách)
```

- **Giá trị canh phải**, chữ đơn cách, `tabular-nums` → cột thẳng hàng.
- **Tag phân loại**: `mặc định` / `đã đổi` / `bắt buộc`. **Tối đa hai loại** trong một
  danh sách — ba loại trở lên thì tag hết phân loại được gì.
- **Câu giải thích** luôn hiện, không giấu sau tooltip. `?` chỉ dành cho phần sâu hơn.

---

## 5 · Dòng cấu hình — một hình dạng, năm loại điều khiển

Học từ màn hình *Cài đặt tài khoản* của MoMo. Hình dạng dòng **cố định**
(icon · tiêu đề · mô tả); phần bên phải đổi theo việc dòng đó làm:

| Điều khiển | Dùng khi |
|---|---|
| `chevron ›` | Mở màn/panel khác |
| `toggle` | Bật/tắt tại chỗ — **luôn xanh lá khi bật, không theo accent** |
| `chip trạng thái` | Chỉ đọc, không bấm được |
| `nút viền nhỏ` | Hành động một lần (`Nhập lại`, `Cập nhật`) |
| `chip đổ xuống` | Chọn một giá trị gọn |

Năm loại, **không loại nào cần component mới**. Đây là pattern chính cho trang Settings
và bảng cấu hình của mọi tool.

---

## 6 · Bảng

Mật độ thường: dùng công thức bốn tầng ở trên.

Mật độ cao (Kafka / RabbitMQ): thêm **dòng phụ** dưới nhãn, **thanh tỉ lệ** nền mảnh
cho giá trị so sánh được, và **chip trạng thái** ở cột cuối.

- Số luôn canh phải, `tabular-nums`
- Ngăn dòng bằng `--line-soft`, không phải `--line` (nhẹ hơn, đỡ thành lưới)
- Bảng rộng phải cuộn trong khung riêng — **body không bao giờ cuộn ngang**

---

## 7 · Panel & lồng tầng

```
Panel  (--r-lg, shadow: --sh)          ← TẦNG NỔI DUY NHẤT
 ├─ thanh tiêu đề: tên + StatusChip
 ├─ ExplainBand   (--r-md, --*-tint)   ← không bóng
 └─ nhóm trong    (--r-sm, viền --line)← không bóng
```

**Chỉ một tầng được đổ bóng.** Lồng nhóm thì được — hai bóng thì không.

> Quy tắc này thay cho "không thẻ lồng trong thẻ" ở vòng 3, vốn quá cứng.
> MoMo lồng liên tục và đọc vẫn rất rõ, vì tầng trong chỉ có viền mảnh.

Bán kính trong = ngoài − đệm.

---

## Component cần dựng mới

Chưa có trong `src/components/ui/`:

| File | Nội dung |
|---|---|
| `status-chip.tsx` | Chip trạng thái, 4 tông |
| `explain-band.tsx` | Dải nhuộm trong thân panel + chip ví dụ |
| `outline-notice.tsx` | Thông báo chỉ viền |
| `param-row.tsx` | Dòng bốn tầng |
| `setting-row.tsx` | Dòng cấu hình, năm loại điều khiển |
| `keycap.tsx` | Phím tắt |
| `field-gutter.tsx` | Máng định dạng cho ô nhập |

Component cần thêm biến thể: `button.tsx` (thêm `tint` + `sc`).
