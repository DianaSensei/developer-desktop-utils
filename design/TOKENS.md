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
Sáu tone có sẵn: azure (mặc định), petrol, forest, iris, oxblood, amber.

Đổi lúc chạy:
```js
document.documentElement.dataset.accent = 'petrol';
// hoặc chỉnh trực tiếp ba kênh:
document.documentElement.style.setProperty('--a-h', '190');
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

Nếu trạng thái dẫn xuất từ accent thì đổi tone sang oxblood → thẻ "hợp lệ" hoá đỏ.
Khả năng đổi tone và tính nhất quán ngữ nghĩa xung đột nhau; hệ này chọn giữ ngữ nghĩa.

Bản tối không phải bản sáng đảo ngược — mỗi tông được chọn lại cho nền tối, nhưng
**giữ đúng hue nghĩa** (ok vẫn xanh lá, bad vẫn đỏ).

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
