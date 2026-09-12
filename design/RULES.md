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
| **Người dùng đổi kiểu bo góc** | Ba preset `[data-corner]` (Vuông / Mặc định / Tròn). Điều kiện: mọi bán kính đọc từ `--r-*`. |

## Không bao giờ

| Không bao giờ | Vì sao |
|---|---|
| **Accent mang nghĩa trạng thái** | Phá vỡ khả năng đổi tone. Đổi accent sang đỏ thì thẻ "thành công" hoá đỏ. |
| **Hai tầng cùng đổ bóng** | Mắt không biết tầng nào nổi hơn. Lồng thì được — hai bóng thì không. |
| **Quá hai tag phân loại trong một danh sách** | Ba tag trở lên thì tag hết phân loại được gì. |
| **Emoji thay icon** | Render khác nhau trên ba nền tảng Tauri, không chỉnh được nét và màu. |
| **Nhấc phần tử khi rê chuột** (`hover:-translate-y-*`) | Rê chuột đổi nền/viền, không đổi vị trí. Layout không được nhảy. |
| **Màu Tailwind thô** (`text-green-500`, `bg-red-50`…) | Không theo được theme, không đổi được tone. Dùng token. **Ngưỡng hiện tại: 0** — thêm một cái là guard đỏ. |
| **Chữ dưới 11px** | Không đọc được ở HiDPI. **Ngưỡng hiện tại: 0.** |
| **Thẻ cảnh báo rời cho trạng thái thường trực** | Layout nhảy khi chuyển hợp lệ ↔ lỗi. Dùng chip + dải nhuộm trong panel. |
| **Hai hệ shadow song song** | Chỉ `--sh-sm` / `--sh` / `--sh-lg` (và `--sh-btn`, vốn dựng TỪ `--sh-sm`). |
| **Kính mờ khi không có gì phía sau** | `backdrop-filter` chỉ dùng cho bề mặt BAY (dialog, menu, tooltip). Dải chrome nằm trên nền phẳng thì trong suốt chỉ làm mất độ đặc — xem `reference/ANALYSIS-DBX.md` đợt 2. |
| **Tông NỀN dùng làm màu VIỀN** | `border-sunk` / `border-bg-2` — ô nhập không còn mép nào. Viền lấy từ `--line` / `--line-strong`. |
| **Nhiều hơn hai chiều cao control** | Chỉ `--h` (34px) và `--h-lg` (40px). |
| **Bo góc viết cứng** (`rounded-[12px]`) | Đứng ngoài preset `[data-corner]`: đổi kiểu bo góc thì chỗ đó ở lại, lệch với hàng xóm. **Ngưỡng hiện tại: 0.** |
| **`--cat-N` mang nghĩa cố định** | Đó là bảng XOAY VÒNG. Gán nghĩa cho nó thì đổi màu một chỗ sẽ kéo theo chỗ khác — xem "Màu phân loại" bên dưới. |
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

## Màu phân loại — `--cat-N` không mang nghĩa

`--cat-1…5` là bảng **xoay vòng**: dùng khi cần phân biệt các mục *cùng loại cạnh nhau*
mà thứ tự không mang nghĩa — các match liền nhau trong Regex Tester, hai dải trong biểu
đồ thời gian. Đúng chỗ: hai dải cạnh nhau phải khác màu, còn *dải nào màu nào* không quan
trọng.

Sai chỗ: gán `--cat-3` cho "bước HMAC" hay "mã trạng thái 3xx". Nghĩa thì cố định, còn ô
trong bảng xoay vòng thì không — đổi `--cat-3` cho dễ đọc ở Regex Tester sẽ đổi luôn màu
của HMAC và của 3xx, không ai nối được hai việc đó với nhau.

**Cần một màu mang nghĩa thì đặt token mang tên nghĩa**, rồi trỏ vào hue có sẵn:

```css
--step-hmac: var(--cat-3);   /* nghĩa có tên riêng, chỉnh được một mình nó */
```

(Học từ DBX: `--data-grid-type-string-fg` chứ không phải `--cat-3` — xem
`reference/ANALYSIS-DBX.md` mục 5.)

---

## Bo góc — thang phải đi qua token

Người dùng chọn được kiểu bo góc (`[data-corner]`: Vuông / Mặc định / Tròn), nên **mọi**
bán kính phải đọc từ thang `--r-*`:

| Dùng | Không dùng |
|---|---|
| `rounded-xs` … `rounded-xl`, `rounded-full` | `rounded-[12px]`, `rounded-[0.75rem]` |
| `rounded` trần (= `--r-default`, 4px — bậc nhỏ nhất: ô tick, keycap) | `rounded-2xl`, `rounded-3xl` (bậc gốc Tailwind, ngoài thang) |

Cạm bẫy đã vấp một lần: `borderRadius` khai trong `theme.extend` **không** phủ khoá
`DEFAULT`, nên `rounded` trần từng trả `0.25rem` cứng ở 151 chỗ — nằm ngoài hệ token mà
không ai thấy. Giờ `DEFAULT` trỏ vào `--r-default`. Nguyên tắc rút ra: **utility trần của
Tailwind là giá trị cứng cho tới khi được khai báo tường minh.**

---

## Thang tông — cái gì nằm trên bề mặt nào

Bốn bậc, thứ tự mang nghĩa **cố định**. Đây là mô hình IDE: mặt làm việc luôn sáng nhất
màn hình, mọi thứ điều khiển bao quanh tối hơn.

| Bậc | Sáng | Dùng cho |
|---|---|---|
| `--card` | 100% | **Mặt làm việc**: thân pane, thẻ, ô nhập, bảng dữ liệu |
| `--chrome` | 97% | **Thanh điều khiển**: toolbar, đầu pane, sidebar, tab bar |
| `--bg` | 95% | Nền app, rãnh giữa các panel |
| `--bg-2` | 91% | Chỗ **lõm**: máng segmented, vùng disabled |

Phép thử: cái gì người dùng **đọc hoặc gõ** thì nằm trên `--card`; cái gì người dùng
**bấm để điều khiển** thì nằm trên `--chrome`. Nội dung xám còn thanh công cụ trắng là
ngược — và đó là lý do app từng đọc ra "không biết bắt đầu ở đâu".

Hai bậc viền đi kèm: `--line` (88%) kẻ giữa các hàng trong một danh sách; `--line-strong`
(79%) đóng khung panel và chia vùng chính. Dùng `--line` để đóng khung cả một panel thì
panel đó không đứng vững.

---

## Độ sâu trên nút — hai mép, không phải gradient

Một mặt phẳng đặc không có mép đọc ra là **hình dán**, không phải nút bấm được.

```
--sh-btn = --sh-sm            ← bóng ngoài: "vật này nổi"
         + --edge-lite        ← 1px sáng ở mép TRONG trên
         + --edge-dark        ← 1px tối ở mép TRONG dưới
```

Hai mép đó không phải gradient (luật cấm gradient trên nút vẫn nguyên) — chúng là chỗ
ánh sáng rơi vào và chỗ khuất của một vật có bề dày.

Lúc nhấn: mép sáng **tắt**, bóng đảo vào trong (`--sh-btn-press`). `active:scale` một
mình không tạo được cảm giác bấm, vì thu nhỏ không đổi cách ánh sáng rơi.

Chỉ áp cho bề mặt **đặc** (`default`, `secondary`, `destructive`). Nút viền mặt là
`--card` trắng — mép sáng trên nền trắng chỉ làm dày đường viền một cách bẩn.

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
- [ ] Không có bán kính viết cứng — `rg 'rounded-\[' src/`
- [ ] Đổi `data-corner` sang `sharp` → không khối nào ở lại hình cũ
- [ ] Màu mang nghĩa cố định thì có token tên nghĩa, không dùng thẳng `--cat-N`
- [ ] Ô nhập / vùng đọc nằm trên `--card`; thanh điều khiển nằm trên `--chrome`
- [ ] Không có tông nền nào bị dùng làm màu viền — `rg 'border-(sunk|bg-2|chrome)'`
- [ ] Nút đặc mới dùng `shadow-btn` + `active:shadow-btn-press`, không phải `shadow-soft`
