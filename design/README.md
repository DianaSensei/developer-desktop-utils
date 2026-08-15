# DevTool Design Kit

Hệ thiết kế của DevTool, tách riêng để dùng làm **material · guideline · sample · rule**
cho mọi thiết kế sau. Thư mục này **portable** — copy sang dự án khác là chạy.

```
design/
├── RULES.md              ★ Luật bắt buộc. Đọc trước tiên.
├── TOKENS.md               Tham chiếu token + vì sao
├── COMPONENTS.md           Spec 7 nhóm component
├── tokens.css            ★ NGUỒN SỰ THẬT — CSS thuần
├── tailwind-preset.cjs     Ánh xạ token → utility Tailwind
├── preview/index.html    ★ Trang mẫu SỐNG — mở trực tiếp bằng browser
└── reference/ANALYSIS.md   Vì sao hệ này thành ra như vậy
```

---

## Bắt đầu ở đâu

| Bạn muốn | Đọc |
|---|---|
| Dựng một màn hình mới | `RULES.md` → `COMPONENTS.md` |
| Sửa màu / bo góc / chiều cao | `tokens.css` (chỉ ở đây), rồi `TOKENS.md` để hiểu hệ quả |
| Review PR chạm UI | Checklist cuối `RULES.md` |
| Biết vì sao có quy tắc này | `reference/ANALYSIS.md` |
| Nhìn thấy tận mắt | mở `preview/index.html` |

---

## Trang mẫu

```bash
# không cần build, không cần server
xdg-open design/preview/index.html      # Linux
open design/preview/index.html          # macOS
```

Ba nút trên thanh đầu trang **chạy thật**, không phải ảnh chụp:

1. **6 tone** — đổi swatch, cả trang đổi theo kể cả xám nền, đường kẻ và bóng đổ.
   Nhưng **không chip trạng thái nào đổi màu**. Đó là phép thử của cả hệ.
2. **Sáng / Tối**
3. **VI / EN** — tiếng Việt dài hơn tiếng Anh ~25%; đây là bài kiểm tra layout.

---

## Vì sao trang mẫu không thể trôi lệch khỏi app

Cả hai đọc **chung một file**:

```
design/tokens.css   ← CSS thuần, không cú pháp Tailwind
    ├── design/preview/index.html   <link rel="stylesheet" href="../tokens.css">
    └── src/design-system/tokens.css   @import "../../design/tokens.css";
```

Đây là lý do `design/tokens.css` bị cấm dùng `@layer` và `@apply`: hai thứ đó bắt buộc
phải qua Tailwind, mà trang tĩnh thì không có Tailwind. Phần cần Tailwind nằm ở
`src/design-system/tokens.css`, sau dòng `@import`.

**Hệ quả:** sửa giá trị thì sửa ở `design/tokens.css`. Không sửa ở chỗ khác.

---

## Ba ý tưởng nền

**1 · Accent là ba con số, không phải một mã màu.**
`--a-h` / `--a-s` / `--a-l`. Mọi biến thể tính ra bằng `hsl()`. Thêm tone mới = thêm
ba số. Nền, viền, chữ mờ, **và cả bóng đổ** đều ngả sắc accent — nên đổi tone là cả
trang đổi, không phải chỉ mấy cái nút.

**2 · Trạng thái là hệ riêng, cố định.**
`--ok` / `--warn` / `--bad` / `--info` không dẫn xuất từ accent. Đây chính là điều kiện
để ý tưởng thứ nhất khả thi: nếu trạng thái đi theo accent thì đổi tone sang đỏ sẽ làm
thẻ "thành công" hoá đỏ. Học từ MoMo — hồng khắp nơi, nhưng toggle bật vẫn xanh lá.

**3 · Quy tắc nói về cơ chế, không nói về hình thức.**
"Chỉ một tầng được đổ bóng" là quy tắc tốt. "Không thẻ lồng trong thẻ" là quy tắc tồi —
nó chặn luôn cách dùng đúng và làm giao diện tẻ nhạt. Bốn quy tắc hình thức đã bị gỡ
trong quá trình làm; xem bảng cuối `reference/ANALYSIS.md`.

---

## Quan hệ với phần còn lại của repo

| Đường dẫn | Vai trò |
|---|---|
| `design/` | **Nguồn sự thật** — token, luật, spec, trang mẫu |
| `src/design-system/` | Lớp app: `@import` token của kit, thêm phần cần Tailwind |
| `src/components/ui/` | Hiện thực React của `COMPONENTS.md` |
| `docs/design/DESIGN-SYSTEM.md` | Ghi chú đặc thù app (utility layout, cross-platform) |

---

## Việc còn dở

**Mặt chữ chưa được kiểm chứng thật.** Trang mẫu chạy bằng font hệ thống. Đề xuất
**Be Vietnam Pro + IBM Plex Mono** dựa trên lý lẽ, chưa dựa trên quan sát. Phải dựng
specimen thật trong app và duyệt trước khi khoá — bốn bài kiểm tra ở `TOKENS.md`.
