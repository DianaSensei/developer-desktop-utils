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

### 3 · Lớp tương thích WebView cũ — đã đo lại, rủi ro **thấp hơn nhiều** so với DBX

DBX dò khả năng CSS lúc khởi động (`lib/ui/legacyWebView.ts`: `oklch`, `color-mix`,
`:has()`, `100dvh`, `min()`, cú pháp media query dạng khoảng) và gắn
`html.dbx-legacy-webview` trước khi app mount. Hơn **1.000 dòng** CSS dự phòng treo vào
class đó, phần lớn là viết tay lại các utility breakpoint của Tailwind.

Nguyên nhân chung: **Tailwind v4 nhắm Safari 16.4+**, còn Tauri trên Linux chạy WebKitGTK
của bản phân phối — trên Ubuntu 22.04 là dòng 2.36 (ngang Safari 15.4). Câu hỏi đúng
không phải "Tailwind v4 sinh ra gì" mà **"cái gì thật sự nằm trong file CSS đã build"**.
Đo trên `dist/assets/*.css` của chính repo này:

| Thứ WebView cũ hay vỡ | Trong bundle | Vì sao |
|---|---|---|
| Media query dạng khoảng `(width >= 40rem)` | **0** — toàn bộ là `(min-width: 40rem)` | `vite.config.ts` đặt `build.target = 'safari14'`, esbuild hạ cú pháp xuống |
| `oklch()`, `:has()`, `@container`, `100dvh` | **0** | Hệ token đi bằng `hsl()`; `src/` không dùng ba thứ kia |
| `color-mix()` | 316 lần, **nhưng** mỗi lần đều nằm trong `@supports (color: color-mix(...))` và có dòng thường đứng trước | Tailwind v4 tự sinh cặp fallback |
| `@property` | 74 lần, kèm khối fallback `@layer properties { @supports … { *, ::before, ::after { --tw-*: initial } } }` | Tailwind v4 tự sinh |
| `@layer theme/base/utilities` | **có** — và đây là ngưỡng thật sự | Không hỗ trợ cascade layer thì **toàn bộ** khối bị bỏ qua → app hiện trần trụi, không lỗi |

Nên rủi ro thu về **một dòng duy nhất**: WebView phải hiểu `@layer`, tức **WebKitGTK ≥ 2.36**
(Safari 15.4, 3/2022). Đó đúng bằng bản Ubuntu 22.04 phát hành kèm, và Tauri 2 vốn đã yêu
cầu `webkit2gtk-4.1` — nên nền thấp nhất đang tuyên bố hỗ trợ *nhiều khả năng* vừa đủ qua.

Kết luận khác hẳn DBX, và lý do rất cụ thể: DBX phải dựng 1.000 dòng dự phòng vì nó **dùng
thật** `oklch`, `:has()`, `color-mix` không bọc `@supports` trong CSS viết tay của nó.
DevTool không dùng ba thứ đó — **kỷ luật token bằng `hsl()` đã trả công ở đúng chỗ này.**

Còn lại hai việc nhỏ, không phải lớp tương thích:

- **Chưa ai mở app trên Ubuntu 22.04 thật.** Bảng trên nói CSS *hợp lệ cú pháp*, không nói
  giao diện *nhìn đúng*. Một lần chạy thử là đủ kết luận.
- **Dev server không có lưới an toàn đó.** `build.target` chỉ áp lúc build; `npm run dev`
  phục vụ CSS thô. Nếu có ngày lỗi chỉ xuất hiện khi dev trên Linux mà bản build thì không,
  đây là chỗ nhìn đầu tiên.

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

## Đợt 2 · Chẩn đoán "mong manh, phẳng, rẻ tiền"

Phản hồi của người dùng sau đợt 1, nguyên văn: *"toàn bộ app giống như một khung rất
mong manh, rất cẩu thả, rẻ tiền, các button trông như nút flat, không có chiều sâu,
không có cảm giác."*

Phương pháp: build tĩnh rồi **chụp màn hình app thật** bằng Chromium (không mở cổng —
Playwright phục vụ file từ đĩa qua `page.route`), đối chiếu từng vùng với mã của DBX.
Kết luận quan trọng nhất đến từ việc nhìn ảnh, không phải từ việc đọc code.

### Điều đầu tiên phải nói: DBX **cũng** phẳng

Trước khi sửa bất cứ thứ gì, phải bác một giả định sai. Nút của DBX không có gradient,
không có bóng đổ — `buttonVariants` của nó chỉ là `bg-primary text-primary-foreground`
+ `transition-colors`. Đếm trên toàn bộ `components/`:

| | DevTool (trước) | DBX |
|---|---|---|
| `shadow-*` | ~110 | ~430 (riêng `shadow-sm` 151) |
| `border` | 975 | **5 132** |
| `active:` | ~15 | ~43, **cộng với `active:` trên mọi variant của nút** |

Tỷ lệ border/shadow nói hết: **ngôn ngữ độ sâu của DBX là ĐƯỜNG VIỀN, không phải bóng
đổ.** Thêm gradient và quầng sáng vào DevTool sẽ đi ngược đúng cái làm DBX trông chắc
chắn — và đi ngược luôn `RULES.md`. Cái DevTool thiếu không phải hiệu ứng, mà là **ranh
giới và thứ bậc bề mặt**.

### Năm nguyên nhân, xếp theo mức độ

**1 · Kính mờ phủ lên một thứ không có gì phía sau.** `.sidebar-chrome` và
`.header-chrome` dùng `glass-chrome` = nền ở **86% độ đục** + `backdrop-blur(26px)
saturate(185%)`. Nhưng `.env-bg` (nền gradient) **chỉ dùng ở trang mẫu, không dùng trong
app** — chrome nằm thẳng trên `--bg` phẳng. Nên 26px blur mỗi khung hình chỉ để trộn
`--chrome` với `--bg` ra một tông lưng chừng, và `saturate(185%)` kéo lệch sắc mọi thứ
cuộn qua bên dưới. Trong suốt mà không có gì để nhìn xuyên qua thì chỉ còn lại đúng một
hiệu ứng: **mất độ đặc**. Đó là nghĩa đen của "mong manh".

**2 · Viền mảnh tới mức biến mất.** Chrome dùng `border-line/70` — `--line` (88%) ở 70%
độ đục ra ≈ 91.6%. Và `Input`/`Textarea` dùng **`border-sunk`**: `--sunk` là một tông
NỀN (97%), dùng làm màu viền thì ô nhập **không có mép nào cả**. DBX dùng `--input`
(≈90%) ở độ đục đầy cho đúng việc này.

**3 · Thang tông bốn bậc nằm gọn trong 4%.** `bg 96 · sunk 97 · chrome 98.5 · card 100`
— ba bậc trên cách nhau 1–1.5%, dưới ngưỡng mắt phân biệt trên màn thường. Cả cửa sổ
đọc ra một mảng trắng xám duy nhất.

**4 · Thứ tự tông bị ĐẢO.** Vùng nội dung nằm trên `--bg` xám, còn thanh công cụ thì
trắng. Mô hình IDE (và của DBX: `--dbx-content` trắng, `--dbx-chrome` xám) thì ngược
lại: **mặt làm việc luôn sáng nhất màn hình**, mọi thứ điều khiển bao quanh tối hơn một
bậc. Sai thứ tự này thì mắt không tìm ra chỗ bắt đầu làm việc.

**5 · Nút chỉ có bóng NGOÀI.** `shadow-soft` đặt một bóng dưới nút — nó nói *"vật này
nổi"*, không nói *"vật này bấm được"*. Mặt trên vẫn là mảng màu phẳng tuyệt đối. Và
`active:scale` một mình không cứu được, vì thu nhỏ **không đổi cách ánh sáng rơi**.

### Đã sửa

| Sửa | Ở đâu |
|---|---|
| Chrome thành bề mặt ĐẶC, viền đầy độ đục. Kính mờ chỉ còn ở bề mặt BAY (dialog, menu, tooltip) — chỗ thật sự có nội dung phía sau | `src/design-system/tokens.css` |
| Thang tông giãn ra 5%, thứ tự mang nghĩa cố định: `card 100` (làm việc) › `chrome 97` (điều khiển) › `bg 95` (nền/rãnh) › `bg-2 91` (chỗ lõm) | `tokens.css` |
| `--line-strong` (79%) cho khung panel và đường chia vùng chính; `--line` (88%) lùi về đúng việc của nó là kẻ giữa các hàng | `tokens.css` |
| `Input`/`Textarea`: viền `--line` thay `--sunk`, nền `--card`, hover `--line-strong` | `ui/input.tsx`, `ui/textarea.tsx` |
| `--sh-btn` = `--sh-sm` + **hai đường 1px trong mép**: sáng trên, tối dưới. Không phải gradient — là chỗ ánh sáng rơi vào và chỗ khuất của một vật có bề dày | `tokens.css`, `ui/button.tsx` |
| `--sh-btn-press`: lúc nhấn mép sáng TẮT, bóng đảo vào trong — nút lún xuống thật | `ui/button.tsx` |
| `ToolPane` đặt nền `--card`; `PaneHeader` thành dải `--chrome` đặc với nhãn `eyebrow` | `ui/tool-layout.tsx` |

### Chưa sửa — việc của đợt sau

- **Bốn dải chrome chồng nhau ở đỉnh cửa sổ**, mỗi dải một chiều cao và một tông gần
  giống nhau (titlebar 68px · tab strip 46px · tab chế độ 54px · hàng tuỳ chọn 56px).
  Gộp còn hai là việc chạm `App.tsx` + từng tool, nên tách riêng.
- **Ba hình dạng cho cùng một trạng thái "đang chọn"** trong 200px chiều dọc: viên thuốc
  bo tròn hoàn toàn ở titlebar, `rounded-md` ở tab, `rounded-sm` ở toggle.
- **API Client tự dựng layout riêng**, không đi qua `ToolPane` — nên chưa hưởng phần
  đóng khung ở trên.
- **Hai mật độ trong cùng một cửa sổ**: sidebar 58px/hàng cạnh nội dung dày đặc.

---

## Ba câu rút gọn

1. **Hệ token chỉ chặt đúng tới ranh giới bạn viết ra.** `theme.extend` bỏ sót `DEFAULT`,
   và 151 giá trị cứng nằm im ở đó cho tới ngày cần đổi. Đi tìm các utility trần.
2. **Token phải mang tên của *nghĩa*, không phải tên của *chỗ đứng trong bảng*.**
   `--cat-3` là số thứ tự; `--step-hmac` là nghĩa. Chỉ cái sau chỉnh riêng được.
3. **Độ đặc đến từ RANH GIỚI, không từ hiệu ứng.** Viền đủ đậm, thang tông đủ giãn,
   mặt làm việc sáng nhất màn hình — DBX chắc chắn nhờ ba thứ đó, không nhờ bóng đổ hay
   gradient. Trong suốt mà không có gì phía sau thì chỉ còn lại mỗi việc làm mất độ đặc.
4. **Nền tảng cũ nhất bạn tuyên bố hỗ trợ là một cam kết CSS**, không chỉ một dòng trong
   README — và cam kết đó phải **đo trên file đã build**, không suy từ phiên bản Tailwind.
   Đo rồi mới thấy rủi ro nằm ở `@layer` chứ không ở media query, và nhỏ hơn nhiều so với
   dự đoán ban đầu (mục 3).
