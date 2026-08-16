# Token — tham chiếu

Nguồn sự thật: **`design/tokens.css`**. File này giải thích *vì sao*, không lặp lại giá trị.

---

## Kiến trúc accent — ba kênh rời

Đây là quyết định kỹ thuật quan trọng nhất của hệ.

```css
--a-h: 218;   /* hue        */
--a-s: 76%;   /* saturation */
--a-l: 48%;   /* lightness  */
```

Mọi biến thể accent **tính ra** từ ba số này, không mã hex nào viết cứng:

| Token | Công thức | Dùng cho |
|---|---|---|
| `--acc` | `hsl(h s l)` | nền nút đặc, viền active, con trượt |
| `--acc-hi` | `l + 7%` | trạng thái hover của nút đặc |
| `--acc-tint` | `s − 8%`, `l → 95%` | nền nút nhuộm, nền dòng được chọn |
| `--acc-tint-2` | `s − 12%`, `l → 90%` | hover của nền nhuộm |
| `--acc-ink` | `s + 6%`, `l → 34%` | chữ trên nền nhuộm (đủ tương phản) |
| `--acc-edge` | `h 44% 84%` | viền của phần tử nhuộm |
| `--acc-ring` | `hsl(h s l / .22)` | vòng focus |

**Thêm một tone = thêm ba con số.** Xem khối `[data-accent="…"]` cuối `tokens.css`.
Bốn tone có sẵn: azure (mặc định), teal, iris, amber.

> **G3 từng có sáu tone** (thêm `petrol`/`moss`/`oxblood`), nhưng cả ba đều phải hạ
> `--a-l` khá sâu để qua ngưỡng tương phản AA (xem mục tiếp theo) — kết quả là ba
> tone tối, xỉn, khó ưa hơn hẳn ba tone còn lại. Đã gộp lại thành một tone `teal`
> duy nhất (h196 s65% l32%) đạt tương phản 6.04:1 (light) / 8.54:1 (dark) mà vẫn
> sống động, cộng với azure/iris/amber — bốn tone đều đo được ≥4.94:1.

> ⚠️ **Tone mới phải đo khoảng cách tới `--ok` và `--bad`.** Vì màu trạng thái cố
> định, accent không được lấn vào chỗ của chúng. Hai tone đầu tiên của G1 đều vướng
> lỗi này và chỉ lộ ra khi đo bằng trình duyệt thật:
>
> | Tone bản đầu | Khoảng cách RGB | Hậu quả |
> |---|---|---|
> | `oxblood` h2 s58 l42 | **10** tới `--bad` | nút chính trông y hệt báo lỗi |
> | `forest` h152 s52 l32 | **18** tới `--ok` | accent trông y hệt chip "hợp lệ" |
>
> Ngưỡng tối thiểu là **45**, được canh tự động trong `designKit.test.ts` — thêm
> tone mới mà quá gần thì test đỏ ngay. `teal` h196 đo được 58 đơn vị tới `--ok`
> và 184 tới `--bad`, dư biên thoải mái.

Đổi lúc chạy:
```js
document.documentElement.dataset.accent = 'teal';
// hoặc chỉnh trực tiếp ba kênh:
document.documentElement.style.setProperty('--a-h', '196');
```

---

## Vì sao xám ngả sắc accent

Nền, viền, chữ mờ, và **cả bóng** đều mang một phần sắc accent:

```css
--bg:   hsl(var(--a-h) 22% 96%);   /* không phải hsl(0 0% 96%) */
--line: hsl(var(--a-h) 22% 88%);
--sh:   0 8px 20px -12px hsl(var(--a-h) 30% 20% / .22);   /* bóng ngả sắc, không đen thuần */
```

Xám trung tính + một điểm nhấn màu là cấu hình làm giao diện trông rẻ: màu nhấn nổi
lên như dán vào. Khi xám mang cùng hue, toàn bộ trang trông như **một vật liệu** thay vì
một tấm xám có sticker màu.

Hệ quả tiện lợi: đổi `--a-h` là *cả trang* đổi theo, kể cả bóng đổ.

---

## Vì sao màu trạng thái tách riêng

`--ok` / `--warn` / `--bad` / `--info`, mỗi cái ba biến thể (`base` / `-tint` / `-edge`),
**là mã hex cố định**, không dẫn xuất từ accent. Đây là chủ ý, không phải thiếu sót.

Nếu trạng thái dẫn xuất từ accent thì đổi sang một tone ngả đỏ (như `oxblood` ở G3,
trước khi bị gộp — xem mục Accent) sẽ khiến thẻ "hợp lệ" hoá đỏ theo.
Khả năng đổi tone và tính nhất quán ngữ nghĩa xung đột nhau; hệ này chọn giữ ngữ nghĩa.

Bản tối không phải bản sáng đảo ngược — mỗi tông được chọn lại cho nền tối, nhưng
**giữ đúng hue nghĩa** (ok vẫn xanh lá, bad vẫn đỏ).

---

## Bảng màu phân loại — `--cat-1..5`

Hệ thứ ba, tách khỏi cả accent lẫn trạng thái. Dùng khi cần phân biệt các mục
**cùng loại** cạnh nhau mà danh tính không mang nghĩa tốt-xấu:

| Dùng ở | Vì sao cần màu |
|---|---|
| Regex Tester — highlight match | Hai match **liền kề** cùng màu thì không thấy ranh giới |
| Pipeline — loại bước (nguồn/ký/băm/mã hoá) | Quét nhanh một pipeline dài theo nhóm chức năng |

Đây là **lần duy nhất màu được phép xoay vòng**. Ngoài hai chỗ trên, muốn dùng
thì phải trả lời được: *nếu tất cả cùng một màu thì mất thông tin gì?* Không trả
lời được nghĩa là màu đang trang trí — dùng trọng lượng chữ và khoảng cách.

Năm hue cố ý **không có đỏ và không có xanh lá đúng hue `--ok`/`--bad`**: một dải
highlight xanh lá nằm cạnh chip "lỗi" đỏ sẽ đọc như trạng thái chứ không phải
phân loại.

Hai dạng, như mọi màu khác trong kit:
- `--cat-N-c` — kênh, cho nền có alpha: `bg-[hsl(var(--cat-1-c)/0.30)]`
- `--cat-N` — bọc sẵn, khi không cần alpha: `text-[var(--cat-3)]`

---

## Màu quy ước ngành — cú pháp và HTTP method

Hệ thứ tư, sống trong `src/design-system/tokens.css` (không phải kit) vì nó gắn
với **miền của app này**, không phải với ngôn ngữ thiết kế:

| Nhóm token | Dùng ở |
|---|---|
| `--sql-*`, `--js-*` | Tô sáng cú pháp trong editor |
| `--json-key`, `--json-null` | Cây JSON — phần SQL không có khái niệm tương đương |
| `--method-get/post/put/patch/delete` | Nhãn HTTP method khắp API Client |
| `--live` | "Đang ghi / đang chạy": đồng hồ Time Tracker, vạch giờ hiện tại, chấm live |

**`--live` tồn tại để đỏ không mất nghĩa.** Nút ghi đỏ là quy ước ở mọi phần mềm,
nhưng nếu nó dùng chung `--bad` thì một đồng hồ đang chạy và một lỗi thật sẽ cùng
màu — và đỏ thôi báo hiệu "có gì đó sai". `--live` ngả cam hơn `--bad` để phân
biệt được khi đứng gần nhau. `StatusDot tone="recording"` cũng dùng nó.

Điểm chung: đây là **kiến thức người dùng mang sẵn tới**, không phải lựa chọn
thẩm mỹ. Postman, Insomnia và Bruno đều tô xanh-GET / đỏ-DELETE; đổi đi là bắt
người dùng học lại thứ họ đã biết. Cũng như keyword SQL xanh dương ở mọi editor.

**`--method-*` là ngoại lệ duy nhất được phép trùng hue với `--ok`/`--bad`.**
Chấp nhận được vì method nằm ở cột trái mỗi request còn status code nằm ở panel
kết quả — chúng không đứng cạnh nhau trên cùng một dòng để bị đọc nhầm thành một
tín hiệu. Đừng nới ngoại lệ này ra chỗ khác.

---

## Thang bo góc — vì sao rời nhau

Thang cũ của repo:
```css
--radius: 1rem;
lg: var(--radius)          → 16px
md: calc(var(--radius)-2px) → 14px
sm: calc(var(--radius)-4px) → 12px
```
Ba bậc cách nhau 2px — mắt không phân biệt được, nên ba bậc mà chỉ có tác dụng như một.

Thang mới cách nhau đủ xa để mỗi bậc mang một nghĩa:

| Token | px | Dùng cho |
|---|---|---|
| `--r-xs` | 6 | chip, keycap, nút nhỏ |
| `--r-sm` | 10 | input, nút, ô nhỏ trong thẻ |
| `--r-md` | 14 | thẻ thường, dải nhuộm |
| `--r-lg` | 18 | panel, khung tool |
| `--r-xl` | 24 | modal, sheet |
| `--r-full` | 999 | pill, avatar |

**Quy tắc lồng góc**: bán kính trong = bán kính ngoài − đệm.
Panel `--r-lg` (18px) đệm 4px → ô trong dùng 14px (`--r-md`).

---

## Chiều cao control

Chỉ hai: `--h` = 34px, `--h-lg` = 40px.

Repo hiện trộn ba (`h-7` ×91, `h-8` ×192, `h-9` ×71) nên mọi hàng control đều lệch
nhau vài pixel — đây là một trong những nguyên nhân chính khiến giao diện trông thô.

---

## Mặt chữ

| | Chọn | Vì sao |
|---|---|---|
| Sans | **Be Vietnam Pro** | Thiết kế cho tiếng Việt: dấu chồng hai tầng (`ế`, `ộ`, `ữ`) không đè lên chữ, `đ` đúng hình. |
| Mono | **IBM Plex Mono** | Phân biệt rõ `0/O`, `1/l/I`, `rn/m`. Có `tabular-nums`. |

> ⚠️ `fontFamily.mono` **chưa từng được khai báo** trong preset Tailwind của repo,
> dù `font-mono` được dùng **356 lần** → rơi về Courier New trên Windows và Linux.
> Đây là một trong những lỗi nền tảng đáng sửa nhất.

Bốn bài kiểm tra bắt buộc trước khi khoá font (xem mục Typography trong trang mẫu):
1. Dấu chồng hai tầng — `ế ộ ữ ẩ ỡ`
2. Dấu chạm chữ hoa — `ĐẦY ĐỦ TIẾNG VIỆT`
3. Ký tự dễ nhầm — `0O 1lI rn/m ;:`
4. Số tabular — cột số phải thẳng hàng khi giá trị đổi

---

## Chuyển động

Một nhịp duy nhất: `--dur-fast` 150ms · `--dur-base` 220ms · `--dur-slow` 340ms,
với `--ease-out-soft` cho hầu hết và `--ease-spring` cho phần tử bật ra.

**Rê chuột đổi nền/viền — không đổi vị trí.** Không hover-lift, không glow.
`prefers-reduced-motion` được tôn trọng ngay trong `tokens.css`.

---

## Ánh xạ sang Tailwind

`design/tailwind-preset.cjs` biến token thành utility. Quy ước tên:

| Token CSS | Utility |
|---|---|
| `--acc` | `bg-acc` `text-acc` `border-acc` |
| `--acc-tint` | `bg-acc-tint` |
| `--ok` `--ok-tint` `--ok-edge` | `text-ok` `bg-ok-tint` `border-ok-edge` |
| `--r-md` | `rounded-md` |
| `--h` | `h-ctl` |
| `--sh` | `shadow-soft` |

Trong app, **luôn dùng utility**, không viết `var(--acc)` rải rác trong TSX.
`var()` chỉ dùng khi giá trị phải tính lúc chạy.
