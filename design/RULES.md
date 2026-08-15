# Luật thiết kế — DevTool

> Đây là file có thẩm quyền cao nhất trong `design/`. Khi tài liệu khác mâu thuẫn với
> file này, file này đúng. Mọi PR chạm UI phải qua được danh sách dưới đây.

Ba dòng đầu mục "Được phép" là những thứ **đã từng bị cấm nhầm** trong các vòng thiết kế
trước. Chúng nằm ở đây để không ai cấm lại lần nữa.

---

## Được phép

| Được phép | Ràng buộc |
|---|---|
| **Gradient** | Chỉ ở nền môi trường (`.env-bg`). Không bao giờ trên nút, không bao giờ sau chữ cần đọc. |
| **Bo góc + màu trên nút** | Ràng buộc duy nhất là màu phải theo nghĩa (xem "Màu theo nghĩa" bên dưới). |
| **Bo góc lớn cho thẻ** (14–24px) | Bán kính trong = bán kính ngoài − đệm. Góc lồng sai lệch nhìn ra ngay. |
| **Lồng nhóm trong thẻ** | Chỉ **một tầng được đổ bóng**. Tầng trong dùng viền mảnh (`--line`), không bóng. |
| **Một hình dạng dòng, nhiều loại điều khiển** | Icon · tiêu đề · mô tả cố định; bên phải đổi theo việc: chevron / toggle / chip / nút viền nhỏ / chip đổ xuống. |
| **Chữ đơn cách cho số liệu** | Số phải là `tabular-nums` để cột thẳng hàng. |
| **Icon nhiều màu** | Chỉ khi mỗi màu mang một nghĩa. Mặc định DevTool là icon đơn sắc vì mật độ cao. |

## Không bao giờ

| Không bao giờ | Vì sao |
|---|---|
| **Accent mang nghĩa trạng thái** | Phá vỡ khả năng đổi tone. Đổi accent sang đỏ thì thẻ "thành công" hoá đỏ. |
| **Hai tầng cùng đổ bóng** | Mắt không biết tầng nào nổi hơn. Lồng thì được — hai bóng thì không. |
| **Quá hai tag phân loại trong một danh sách** | Ba tag trở lên thì tag hết phân loại được gì. |
| **Emoji thay icon** | Render khác nhau trên ba nền tảng Tauri, không chỉnh được nét và màu. |
| **Nhấc phần tử khi rê chuột** (`hover:-translate-y-*`) | Rê chuột đổi nền/viền, không đổi vị trí. Layout không được nhảy. |
| **Màu Tailwind thô** (`text-green-500`, `bg-red-50`…) | Không theo được theme, không đổi được tone. Dùng token. **Ngưỡng hiện tại: 0** — thêm một cái là guard đỏ. |
| **Chữ dưới 11px** | Không đọc được ở HiDPI. Từ 379 xuống còn 30, đang dọn tiếp. |
| **Thẻ cảnh báo rời cho trạng thái thường trực** | Layout nhảy khi chuyển hợp lệ ↔ lỗi. Dùng chip + dải nhuộm trong panel. |
| **Hai hệ shadow song song** | Chỉ `--sh-sm` / `--sh` / `--sh-lg`. |
| **Nhiều hơn hai chiều cao control** | Chỉ `--h` (34px) và `--h-lg` (40px). |
| **Tooltip tự chế bằng `group-hover:block`** | Dùng component `Tooltip`. Bản tự chế không xử lý được bàn phím và tràn viewport. |

---

## Màu theo nghĩa

Hai hệ màu **không được trộn**:

**Hệ accent** — `--acc*`. Nghĩa: *"cái này tương tác được"* hoặc *"cái này đang được chọn"*.
Đổi được tự do. Không bao giờ mang nghĩa tốt/xấu.

**Hệ trạng thái** — `--ok` / `--warn` / `--bad` / `--info`, mỗi cái có `-tint` (nền) và
`-edge` (viền). Nghĩa cố định, **không đổi khi swap tone**.

Phép thử: đổi accent sang đỏ tía. Nếu có thứ gì đổi màu mà nó đang nói về *kết quả*
chứ không phải về *tương tác*, thì chỗ đó sai.

**Hệ quả ít ai nghĩ tới: accent cũng không được _trông giống_ màu trạng thái.**
Tách hai hệ về mặt token là chưa đủ — nếu tone accent rơi vào đúng vùng màu của
`--ok` hay `--bad` thì người dùng vẫn nhầm, dù code hoàn toàn đúng. Mọi tone mới
phải cách `--ok` và `--bad` tối thiểu **45 đơn vị RGB**; `designKit.test.ts` canh
tự động. Xem bảng hai tone đã vướng lỗi này trong `TOKENS.md`.

Lỗi thật đã tìm thấy trong repo — `CronGenerator.tsx:723`:
```
border-primary/25 bg-accent/45   ← --accent CHÍNH LÀ primary azure
  └─ chứa icon text-green-500
```
Thẻ báo "cron hợp lệ" tô xanh dương, icon bên trong xanh lá. Hai hệ trộn vào nhau.

---

## Ba bậc trạng thái — chọn đúng bậc

| Bậc | Dùng khi | Component |
|---|---|---|
| **Chip** | Liếc là thấy, không cần giải thích | `StatusChip` ở thanh tiêu đề panel |
| **Thông báo viền** | Việc đang chờ xử lý, không khẩn | `OutlineNotice` — chỉ viền, không nền |
| **Dải nhuộm** | Cần giải thích và cho ví dụ sửa được | `ExplainBand` trong thân panel |

Cả ba **nằm trong panel**, nên chuyển hợp lệ ↔ lỗi không làm layout nhảy.

Cùng một component phải dùng được để **dạy** (tông `ok`) chứ không chỉ để **báo lỗi**
(tông `bad`) — một thứ để học, không phải hai.

---

## Ô nhập — quy tắc chống tràn

**Trong ô tối đa hai phụ kiện**: một máng định dạng bên trái, một chỉ số bên phải.
Mọi thứ khác xuống chip bên dưới ô.

Không có quy tắc này thì ô nhập của DevTool sẽ mọc dần: nhãn định dạng, đếm ký tự,
nút copy, nút xoá, chỉ báo hợp lệ — cho tới khi chỗ gõ chữ còn 40%.

---

## Song ngữ — phép thử layout

Tiếng Việt dài hơn tiếng Anh khoảng **25%**. Mọi component phải chịu được cả hai
mà không tràn, không cắt chữ, không nhảy layout.

Chuyển VI/EN trên trang mẫu (`design/preview/index.html`) là cách kiểm tra nhanh nhất.
Nếu component mới làm vỡ ở một trong hai ngôn ngữ, nó chưa xong.

Dấu tiếng Việt chồng hai tầng (`ế`, `ộ`, `ữ`) cần chiều cao dòng đủ — đừng siết
`leading` dưới 1.4 cho chữ có dấu.

---

## Checklist trước khi mở PR

- [ ] Không có màu Tailwind thô mới — `rg 'text-(red|green|blue|amber|emerald)-[0-9]'`
- [ ] Không có `text-[Npx]` với N < 11
- [ ] Không có `hover:-translate-y`
- [ ] Đổi tone → mọi chip trạng thái giữ nguyên màu
- [ ] Đổi VI/EN → không component nào tràn
- [ ] Sáng/tối cân nhau — không phải bản tối chỉ là bản sáng đảo ngược
- [ ] Chỉ một tầng đổ bóng trong mỗi thẻ
- [ ] Control mới dùng `--h` hoặc `--h-lg`, không dùng số khác
