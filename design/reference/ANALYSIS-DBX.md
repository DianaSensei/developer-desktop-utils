# Nguồn 4 · DBX — phân tích và đối chiếu

> Đây là đợt tham khảo thứ tư, tiếp sau ba nguồn trong [`ANALYSIS.md`](ANALYSIS.md)
> (Sony Color Lab · Larme · MoMo). Khác ba nguồn kia — đọc từ ảnh chụp — nguồn này
> đọc thẳng **mã nguồn**: [`github.com/t8y2/dbx`](https://github.com/t8y2/dbx) @ v0.6.11.

## Vì sao nguồn này đáng đọc

DBX là **cùng loại bài toán với DevTool, ở quy mô lớn hơn**: Tauri 2 + WebView, quản lý
90+ loại cơ sở dữ liệu, mật độ cao, người dùng là lập trình viên, đa ngôn ngữ (7 locale),
chạy trên cả ba nền tảng. Ba nguồn trước cho *thẩm mỹ*; nguồn này cho **kỹ thuật hệ
thiết kế đã chịu tải thật**: hơn 2.900 dòng CSS token/theme và 5.000 file.

Điểm khác biệt nền tảng phải nói trước, vì nó quyết định chỗ nào lấy được chỗ nào không:

| | DevTool | DBX |
|---|---|---|
| Kiến trúc màu | Accent = **ba con số** (`--a-h/-s/-l`), mọi thứ suy ra bằng `hsl()` | Theme = **bảng màu đầy đủ** ghi tay, 14 preset × sáng/tối |
| Đổi tone | 4 tone, đổi 3 biến | 14 palette + bộ màu tự chọn, mỗi cái ~30 biến |
| Trạng thái | Hệ riêng, cố định | Hệ riêng, cố định (`--success/--warning/--info` ngoài theme) |
| Thang bo góc | 5 bậc cố định | 8 biến, **người dùng chọn** `none / small / large` |
| Mật độ | `text-xs` + `--h` 34px | `text-xs` + `h-7/h-8` (28/32px), có `text-[10px]` |

Hai bên **hội tụ ở luật gốc**: màu thương hiệu và màu trạng thái là hai hệ tách rời.
DBX đi tới đó từ hướng ngược lại (ghi tay từng palette) và vẫn giữ `--success/--warning/
--info` nằm ngoài mọi khối `html.theme-*`. Ba nguồn độc lập (MoMo, DBX, và chính DevTool)
cùng kết luận một điều — luật này coi như đã được kiểm chứng, không cần bàn lại.

---

## Đã lấy

### 1 · ⭐ Kiểu bo góc là lựa chọn của người dùng, không phải của người thiết kế

DBX cho chọn `data-corner-style="none|small|large"` ngay trong Settings, và đó là một
trong số rất ít tuỳ chọn giao diện mà người dùng thật sự đụng tới. Lý do nó đáng có
trong **app công cụ** nói riêng: bo góc là thứ gu chia rẽ mạnh nhất giữa hai nhóm người
dùng cùng ngồi trong một cửa sổ — người quen IDE (VS Code, JetBrains: 2–4px) thấy thang
14–24px "mềm quá, giống app điện thoại"; người quen app hiện đại thấy thang 2–4px "thô".
Không có lựa chọn đúng cho cả hai, nên đừng chọn hộ.

Hệ token của DevTool làm việc này **rẻ hơn DBX**: thang `--r-*` đã tập trung một chỗ, nên
preset chỉ là ba dòng, đúng cơ chế của `[data-accent]` đã có sẵn.

→ Đã làm: `[data-corner="sharp|default|round"]` trong `tokens.css`,
`src/lib/cornerPreference.ts`, một hàng trong Settings, một nút trên trang mẫu.

### 2 · ⭐ Utility "trần" của Tailwind là lỗ thủng của hệ token

Phát hiện quan trọng nhất của đợt này, và nó lộ ra **chỉ vì** định làm mục 1.

DBX ghi đè hẳn `.rounded { border-radius: var(--dbx-radius-default) }` trong CSS thường.
Nhìn thì thừa — tại sao không khai báo trong theme Tailwind? Lý do là `borderRadius` của
DevTool nằm trong `theme.extend`: các bậc **có tên** (`rounded-sm/md/lg`) bị ghi đè, còn
`DEFAULT` thì không, nên `rounded` trần vẫn trả `0.25rem` **cứng**. Repo có **151 chỗ**
dùng `rounded` trần — tức 151 chỗ đứng ngoài hệ token mà không ai thấy, vì 4px trông hợp
lý ở mọi nơi. Chúng chỉ lộ ra khi có preset bo góc: đổi sang "Vuông" thì 151 chỗ đó ở lại
4px, lệch với hàng xóm.

Bài học tổng quát hơn preset bo góc: **`extend` chỉ phủ những khoá bạn viết ra.** Mọi
utility trần của Tailwind (`rounded`, `shadow`, `border`) là một giá trị cứng lọt qua hệ
token, và nó im lặng cho tới ngày token đó cần đổi.

→ Đã làm: `--r-default` (4px, bằng đúng 0.25rem — không chỗ nào đổi hình),
`borderRadius.DEFAULT` trỏ vào nó, thêm rule `hardcodedRadius` vào `guard.test.ts` để
`rounded-[Npx]` mới không lẻn vào, và dọn chỗ duy nhất đang vi phạm (`SelectionBar.tsx`).

---

## Đã đọc, chưa lấy — kèm lý do

### 3 · Lớp tương thích WebView cũ — **cần quyết định, không phải gu**

DBX dò khả năng CSS lúc khởi động (`lib/ui/legacyWebView.ts`: `oklch`, `color-mix`,
`:has()`, `100dvh`, `min()`, cú pháp media query dạng khoảng) và gắn
`html.dbx-legacy-webview` trước khi app mount. Hơn **1.000 dòng** CSS dự phòng treo vào
class đó, phần lớn là **viết tay lại các utility breakpoint của Tailwind**.

Không ai bỏ 1.000 dòng vào chỗ này vì thích. Nguyên nhân: **Tailwind v4 nhắm Safari 16.4+**,
còn Tauri trên Linux chạy WebKitGTK của bản phân phối. WebKitGTK trên Ubuntu 22.04 (nền
mà DevTool tuyên bố hỗ trợ trong `docs/ai/CLAUDE.md`) ở khoảng Safari 15 — **không parse
được** cú pháp `@media (width >= 40rem)` mà Tailwind v4 sinh ra. Khi đó **toàn bộ utility
responsive chết lặng**: không lỗi, không cảnh báo, chỉ là layout sai ở đúng nền tảng ít
người ngồi test nhất.

DevTool dùng Tailwind **v4.3** và tuyên bố hỗ trợ Ubuntu 22.04+ → cùng vùng rủi ro.
Điểm nhẹ hơn DBX: `src/` hiện **không dùng** `:has()`, `color-mix()` hay `oklch` (đã
kiểm: 0 chỗ), vì hệ token đi bằng `hsl()` — nên rủi ro thu về **một** thứ: cú pháp media
query dạng khoảng, tức các bổ ngữ `sm:` / `lg:`.

Chưa làm vì đây là quyết định cần người xác nhận, không phải việc dọn dẹp:
**(a)** dựng một nền Ubuntu 22.04 thật, mở app, xem có vỡ không — chưa đo thì chưa biết
nó là bug thật hay chỉ là rủi ro trên giấy; **(b)** nếu vỡ: hoặc hạ tuyên bố hỗ trợ
xuống Ubuntu 24.04, hoặc thêm lớp dự phòng như DBX. Xin xác nhận trước khi đi tiếp.

### 4 · `.dbx-control-chrome` — một class cho toàn bộ viền/nền/hover/focus của control

DBX gom chrome của mọi control (input, select trigger, nút viền) vào một class, viết
trong `@layer components` và bọc `:where()` để **specificity bằng 0** — nhờ vậy mọi
utility Tailwind ở chỗ gọi vẫn đè lên được, và chuỗi `:not(.border-0):not([aria-invalid
="true"]):not(:disabled)` chừa đúng các trạng thái ngoại lệ ra. Kèm một ghi chú đắt giá:
*không đặt `box-shadow` ở đây — nó sẽ xoá vòng focus/invalid.*

Ý tưởng tốt, nhưng DevTool đã có `<Input>` / `<Button>` / `<Select>` làm đúng việc đó ở
tầng component. Lấy class này về mà không gỡ bỏ gì thì thành **hệ thứ hai song song** —
đúng thứ mà `RULES.md` cấm với shadow. Chỉ lấy **kỹ thuật** `:where()` khi nào cần viết
một mặc định toàn cục mới, không lấy class.

### 5 · Màu ngữ nghĩa cho dữ liệu — ⚠️ chỗ này DevTool đang dùng sai token

DBX đặt tên màu theo **nghĩa**: `--data-grid-type-string-fg`, `--data-grid-type-temporal-fg`…
Vì tên gắn với nghĩa, nó chỉnh lại được cho từng bề mặt — tooltip trên nền popover tối
dùng bậc 400 thay vì 300 của lưới dữ liệu, chỉ bằng một khối ghi đè.

Đối chiếu lại DevTool thì thấy một vấn đề có sẵn: `--cat-1…5` được tài liệu hoá là **bảng
xoay vòng** ("phân biệt các mục cùng loại cạnh nhau mà thứ tự/danh tính không mang nghĩa"),
nhưng đang được dùng như **bảng ngữ nghĩa**:

- `PipelineTab.tsx` — `--cat-3` = bước HMAC, `--cat-2` = Hash, `--cat-5` = Encode/Decode
- `RequestLog.tsx` — `--cat-3` = mã trạng thái 3xx
- `ResponsePanel.tsx` — `--cat-1` = TTFB, `--cat-2` = Download (dùng đúng: hai dải cạnh nhau)

Hai chỗ đầu gán **nghĩa cố định** cho một ô trong bảng xoay vòng. Hệ quả không phải lỗi
hiển thị hôm nay mà là **bẫy cho mai sau**: đổi `--cat-3` cho dễ đọc trong Regex Tester
thì màu của bước HMAC và của mã 3xx đổi theo, không ai nối được hai việc đó với nhau.

Cách sửa (theo DBX): khai báo token **mang tên nghĩa** rồi trỏ vào hue có sẵn —
`--step-hmac: var(--cat-3)`. Đổi màu xoay vòng không còn kéo theo nghĩa, và nghĩa nào cần
tinh chỉnh riêng thì chỉnh được một mình nó.

Chưa làm vì phải điểm hết các chỗ dùng và đặt tên cho từng nghĩa — một đợt riêng, không
nên trộn vào đợt này. Đã ghi rule vào `RULES.md` để chỗ mới không tăng thêm.

### 6 · Bộ màu người dùng tự chọn — không hợp kiến trúc

DBX cho nhập **5 màu** (background/foreground/primary/border/sidebar) rồi **suy ra 26
biến còn lại** bằng `mixHex()`, chọn chữ trắng hay đen theo **tỷ số tương phản WCAG**
(`readableTextOn()`). Kỹ thuật đẹp, và phần "đo tương phản rồi mới chọn chữ" đúng tinh
thần ngưỡng AA mà `tokens.css` của DevTool đã ghi cho bốn tone.

Nhưng nó **giải bài toán mà kiến trúc DevTool không có**: DBX phải suy ra vì theme của nó
là bảng màu ghi tay; DevTool suy ra sẵn bằng `hsl()` từ ba kênh. Mở cho người dùng nhập
màu tự do sẽ **phá luật khoảng cách 45 đơn vị RGB với `--ok`/`--bad`** mà
`designKit.test.ts` đang canh — người dùng chọn accent đỏ thì chip "lỗi" lẫn vào nền, và
không có chỗ nào chặn được. Bốn tone đã đo là **có chủ đích**, không phải thiếu tính năng.

### 7 · 14 palette đặt tên theo IDE (vscode, idea, xcode, jetbrains, cursor, claude)

Hấp dẫn, và là lý do nhiều người thích DBX. Nhưng mỗi palette là ~30 biến ghi tay ×
sáng/tối — DevTool đổi tone bằng **ba con số** chính là để **không** phải nuôi 28 khối
như vậy. Muốn có, phải bỏ kiến trúc ba kênh. Đây là ranh giới của hệ hiện tại, ghi lại
để lần sau không phải suy luận lại: **DevTool đổi tone rẻ, đổi cả bảng màu đắt; DBX ngược lại.**

### 8 · `html.disable-transitions` khi đổi theme

DBX tắt mọi transition trong đúng một frame lúc đổi theme (thêm class → ép reflow →
`requestAnimationFrame` gỡ ra), để không có làn sóng màu quét qua màn hình.

DevTool cố ý làm **ngược lại**: `useThemeSync.ts` *thêm* `theme-transition` 260ms để cú
chuyển sáng/tối mượt, và tôn trọng `prefers-reduced-motion`. Đây là hai quyết định khác
nhau, không phải một thiếu sót — giữ nguyên bản của DevTool.

---

## Ba câu rút gọn

1. **Hệ token chỉ chặt đúng tới ranh giới bạn viết ra.** `theme.extend` bỏ sót `DEFAULT`,
   và 151 giá trị cứng nằm im ở đó cho tới ngày cần đổi. Đi tìm các utility trần.
2. **Token phải mang tên của *nghĩa*, không phải tên của *chỗ đứng trong bảng*.**
   `--cat-3` là số thứ tự; `--step-hmac` là nghĩa. Chỉ cái sau chỉnh riêng được.
3. **Nền tảng cũ nhất bạn tuyên bố hỗ trợ là một cam kết CSS**, không chỉ một dòng trong
   README. Tailwind v4 + WebKitGTK cũ hỏng **im lặng** — mục 3 ở trên cần một lần đo thật.
