# Audit UI/UX & chức năng — vòng 2, chạy trên bản build thật (2026-10-13)

Tiếp nối [ui-ux-audit-2026-10.md](ui-ux-audit-2026-10.md) và
[plugin-audit-2026-10.md](plugin-audit-2026-10.md). Hai đợt trước là **audit tĩnh** và để
lại một mục "Cần kiểm trên app". Đợt này **render app thật** để kiểm đúng những thứ đó, rồi
đọc code ở chỗ ảnh chụp hoặc số đo báo bất thường.

## Cách làm

| Hạng mục | Cách đo |
|---|---|
| Render | `npm run build` → Chromium headless (Playwright). File trong `dist/` được phục vụ bằng **chặn request**, không mở port, không mở cửa sổ. |
| Chrome desktop | Giả lập `__TAURI_INTERNALS__` (store, clipboard, window, mock server) + user-agent macOS/Windows để `isTauri`/`IS_MAC` đúng → render titlebar macOS (overlay) và Windows/Linux (custom chrome) như app thật. |
| Ma trận | 22 tool + Settings × EN/VI × sáng/tối × 800×600 (min của `tauri.conf.json`) / 1024×700 / 1200×800 (mặc định). |
| Accessibility | axe-core 4.10 (WCAG 2.0/2.1 A+AA + best-practice) trên mọi màn hình, cả hai theme. |
| Bàn phím | Lần vết thứ tự Tab, focus có hiện không, xung đột phím tắt. |
| Luồng | Lần đầu mở app (onboarding → guide), trạng thái lỗi của từng tool, ⌘K, workspace nhiều tab. |
| Hiệu năng | Dán 2,5 MB (⌘V) vào từng tool, đo long task trên main thread. |

**Giới hạn:** IPC Tauri là stub, nên không kiểm được: hộp thoại Open/Save của OS, sidecar,
mock server chạy thật, khác biệt engine WKWebView/WebKitGTK/WebView2 (font, scrollbar,
IME). Những mục đó ở cuối file.

## Tóm tắt

Nền móng vẫn tốt: các luật cơ học của RULES.md sạch, mỗi tool có trạng thái rỗng/lỗi,
Cron/Date-Time/Data Converter báo lỗi rõ ràng, ⌘K có preview, dark mode đồng đều. Vấn đề
nằm ở **ba chỗ hai đợt audit tĩnh không thấy được**:

1. **Workspace (đợt trước thêm vào) che mất một phần điều hướng cũ.** Có từ 2 tab trở lên là
   mất thanh chuyển tool trong nhóm. ⌘1–9 bị workspace và API Client tranh nhau. Tab tràn
   thì không có cách nào nhìn thấy.
2. **Cửa sổ hẹp (800–1023px) nằm trong khoảng cho phép nhưng chưa ai thiết kế cho nó.**
   Sidebar thành drawer đè lên đèn giao thông macOS, có một nút ✕ "ma" trên titlebar, Lucky
   Wheel vỡ bố cục, toolbar API Client bị cắt chữ.
3. **Những lần đầu dùng.** Onboarding bấm Enter là Skip. Guide "Có gì mới ở …" (tiếng Việt
   cứng) tự bật ở **mọi** tool lần đầu mở. JSON lenient báo "Valid JSON" cho JSON không hợp
   lệ.

| # | Mức | Vấn đề | Khía cạnh |
|---|---|---|---|
| 1 | P1 | Có ≥ 2 tab workspace là mất thanh chuyển tool trong nhóm (Text Counter, Data Converter, JWT, QR…) | Điều hướng |
| 2 | P1 | ⌘/Ctrl+1–9 trong API Client chuyển sang tool khác thay vì chuyển request tab | Bàn phím |
| 3 | P1 | Dải tab workspace tràn mà không có dấu hiệu, không cuộn được bằng chuột | Điều hướng |
| 4 | P1 | Cửa sổ 800–1023px: sidebar thành drawer, trên macOS đè đèn giao thông, nút ✕ "ma" | Responsive |
| 5 | P1 | Lucky Wheel < 1024px: bánh xe đè danh sách, nút Spin ra khỏi màn hình | Responsive |
| 6 | P1 | JSON Formatter báo "Valid JSON" cho input không hợp lệ (dấu phẩy thừa, key không ngoặc kép) | Chức năng |
| 7 | P1 | Lần đầu mở: Enter = Skip onboarding; guide tự bật ở cả 22 tool, tiêu đề tiếng Việt cứng | Onboarding · i18n |
| 8 | P1 | Khoá HMAC và khoá AES lưu dạng rõ trong `app-settings.json` | Dữ liệu |
| 9 | P2 | ⌘V "dán nhanh" không có tác dụng khi focus đang ở ô output read-only | Bàn phím |
| 10 | P2 | Chuột phải bị chặn cả trong ô nhập (mất Cut/Copy/Paste/Spellcheck) | Thói quen dùng |
| 11 | P2 | Tương phản: 129 chỗ `text-fg-mute/NN` — gợi ý, gutter, placeholder dưới AA ở cả hai theme | A11y |
| 12 | P2 | Nhãn truy cập: 15 nút/Select không tên, 6 editor CodeMirror không nhãn, nút lồng trong link/tab | A11y |
| 13 | P2 | Phải nhấn ~40 lần Tab mới tới nội dung tool; không có skip link | Bàn phím |
| 14 | P2 | Thông báo lỗi thô của engine (`atob`, "Failed to fetch", lỗi thư viện JWT) | Phản hồi lỗi |
| 15 | P2 | Base64 không nhận base64url / thiếu padding / tiền tố `data:` | Chức năng |
| 16 | P2 | Text Counter đứng ~1,9s, JSON ~0,75s khi dán 2,5 MB, không có chỉ báo | Hiệu năng |
| 17 | P2 | Windows: vùng resize đè lên mép trên của nút Close/Maximize | Chrome |
| 18 | P2 | Onboarding: chọn nhóm = đánh dấu sao mọi tool trong nhóm; bỏ chọn không tắt gì | Onboarding |
| 19 | P2 | ⌘K đọc clipboard mỗi lần mở mà không có tuỳ chọn tắt | Minh bạch |
| 20 | P2 | Nút nguy hiểm không cần xác nhận: Settings → Reset / Disable all / Reset config | An toàn thao tác |
| 21 | P2 | ErrorBoundary: chỉ có tiếng Anh, "Try again" lặp lỗi nếu state lưu bị hỏng | Phục hồi |
| 22 | P2 | "Pick from Screen" hiện trên macOS/Linux, nơi nó không bao giờ chạy được | Chức năng |
| 23 | P3 | Lặt vặt: copy, i18n sót, nhãn ngược trên bánh xe, ⌘F bị chặn… (xem cuối) | — |

---

## P1

### 1. Có ≥ 2 tab workspace là mất thanh chuyển tool trong nhóm

**Thấy được:** mở Text Transformer khi workspace mới có 1 tab → titlebar hiện
`Text Transformer | Text Counter | Deduplicate`. Mở thêm một tool bất kỳ → thanh đó biến mất,
thay bằng dải tab workspace. Từ lúc đó Text Counter và Deduplicate **không còn lối vào nào
nhìn thấy được**. Bấm nhóm "Text" ở sidebar chỉ mở tool đầu tiên của nhóm. Còn lại tìm kiếm,
⌘K, hoặc phải biết trước tên tool.

**Nguyên nhân:** `ToolIdentity` (nơi duy nhất vẽ tab trong nhóm) chỉ được truyền làm
`fallback` của `WorkspaceBar`, và fallback chỉ render khi `tabs.length < 2 && workspaces.length < 2`
(`src/components/WorkspaceBar.tsx:52`, `src/App.tsx:798-801`, `:918-921`).

Ảnh hưởng 7 nhóm / 16 tool: JSON & Data, Text, Format, Time, Generate, Encode & Hash.

**Đề xuất:** tách hai khái niệm. Workspace = "tôi đang mở những gì", nhóm = "tool này có anh
em nào". Giữ tab trong nhóm ở **đầu thân tool** (một dải `Segmented` nhỏ dưới titlebar), hoặc
cho sidebar mở nhóm ra (accordion) thay vì nhảy vào tool đầu tiên.

### 2. ⌘/Ctrl+1–9 trong API Client chuyển sang tool khác

**Tái hiện (đã chạy):** mở JSON rồi API Client (2 tab workspace) → chọn request → Ctrl+1 →
URL đổi `/api-client` → `/json`.

**Nguyên nhân:** hai listener `keydown` trên `window` cùng xử lý phím số:
`WorkspaceContext.tsx:183` (tab workspace) và `apiclient/ApiClient.tsx:347` (request tab).
Cả hai cùng `preventDefault`, không bên nào kiểm `e.defaultPrevented`, nên cả hai cùng chạy.
`docs/ai/CLAUDE.md` và guide của API Client đều ghi ⌘1…9 = request tab.

**Đề xuất:** đặt một quy tắc ưu tiên. Tool đang focus thắng: API Client gọi
`e.stopImmediatePropagation()` (listener của nó phải đăng ký ở capture phase), hoặc workspace
bỏ qua khi `e.defaultPrevented`. Thêm test cho mọi phím trùng (⌘W, ⌘F, Ctrl+Tab cũng đang chia
nhau theo quy ước ngầm).

### 3. Dải tab workspace tràn mà không ai biết

**Thấy được:** ở 1200px chỉ ~6 tab hiện ra, tab thứ 7 bị cắt giữa chữ ("Mock Ser"). Ở 800px
chỉ còn 2 tab. `MAX_TABS = 12` (`src/lib/workspaces.ts:29`).

**Nguyên nhân:** `no-scrollbar overflow-x-auto` (`WorkspaceBar.tsx:82`): không thanh cuộn,
không fade, không nút ‹ ›. Chuột lăn dọc không cuộn ngang được (Windows/Linux có chuột thường
là bế tắc). Tab bị đẩy ra ngoài chỉ tới được bằng ⌘1–9 hoặc ←/→ sau khi đã focus vào dải tab.
Thêm nữa, khi vượt 12 tab, tab cũ nhất bị loại **mà không báo gì**.

**Đề xuất:** fade ở mép + nút "▾ N tab nữa" mở danh sách đầy đủ (kiểu VS Code/Chrome), đổi
wheel dọc thành cuộn ngang, toast nhẹ khi một tab bị loại.

> Bản web (`npm run dev`) còn nặng hơn: header không có `min-w-0`, nên dải tab đẩy nút `?` và
> `#tool-header-actions` ra khỏi màn hình, và `scrollIntoView` của tab đang chọn cuộn ngang
> chính `<main overflow-hidden>` khoảng 800px. Kết quả là nội dung tool bị giấu sau sidebar
> (đo được `main.scrollLeft = 807`). App desktop không bị vì titlebar có `min-w-0`.

### 4. Cửa sổ 800–1023px: drawer đè đèn giao thông, nút ✕ "ma"

`minWidth: 800` (`src-tauri/tauri.conf.json`) nhưng sidebar chuyển sang drawer dưới
breakpoint `lg` = 1024px. Chia đôi màn hình 1920px (960px) là rơi đúng vào khoảng này.

- **Sidebar biến mất**, nút Collapse cũng ẩn (`hidden lg:flex`). Muốn đổi tool phải bấm ☰.
- **macOS:** nút ✕ "Close menu" **luôn hiện** ở góc phải titlebar, kể cả khi drawer đang đóng
  (`App.tsx:838`, chỉ có `lg:hidden`). Dấu ✕ ở góc cửa sổ trông như nút đóng app, mà bấm thì
  không có gì xảy ra.
- **macOS:** drawer là `fixed top-0 h-full` (`App.tsx:497`) nên phủ lên cả titlebar. Đèn giao
  thông (`trafficLightPosition` 12,20) nằm đè lên ô "Search tools…" của drawer.
- Windows: drawer cũng phủ titlebar, che logo và nút ☰ đã mở nó.

**Đề xuất:** (a) đổi ngưỡng drawer xuống dưới 800 (thực tế là bỏ, vì không thể nhỏ hơn) và
dùng chế độ **sidebar thu gọn 56px** cho 800–1023px; hoặc (b) nếu giữ drawer thì cho nó bắt
đầu dưới titlebar (`top-[38px]`) và bỏ nút ✕ trên titlebar (đã có backdrop + Esc).

### 5. Lucky Wheel < 1024px: vỡ bố cục

**Thấy được (800×600):** bánh xe đè lên bảng "Lịch sử quay" và ô lựa chọn (chỉ còn thấy 2
dòng). Nút **Spin bị đẩy ra khỏi màn hình**, tức không dùng được chức năng chính.

**Nguyên nhân:** `grid h-full grid-cols-1 … overflow-hidden lg:grid-cols-2`
(`LuckyWheel.tsx:323`). Xếp chồng một cột nhưng vẫn khoá chiều cao và ẩn phần tràn, trong khi
canvas có kích thước tối thiểu.

**Đề xuất:** dưới `lg`, cho cột cuộn (`overflow-y-auto`) hoặc đặt bánh xe lên trên và thu nhỏ
theo chiều cao còn lại. Cũng nên đổi breakpoint viewport sang **container query** — xem ý
xuyên suốt ở cuối.

### 6. JSON Formatter báo "Valid JSON" cho JSON không hợp lệ

**Tái hiện (đã chạy):** gõ `{"name": "Ada", "tags": ["x",], age: 3}` → thanh trạng thái hiện
dấu tích xanh **"Valid JSON"** (`JsonFormatter.tsx:679`).

Parser lenient (`parseLenient`, dòng 39+) chấp nhận dấu phẩy thừa, key không ngoặc kép,
comment, nháy đơn. Đó là tính năng tốt, nhưng **kiểm tra JSON có hợp lệ không** là một trong
những lý do phổ biến nhất để mở JSON formatter. Người dùng thấy dấu tích xanh, dán vào
`package.json` hoặc gửi cho API, rồi nhận lỗi.

**Đề xuất:** parse thêm bằng `JSON.parse` thật. Nếu strict lỗi mà lenient qua thì hiện chip
`warn` "Đã sửa 2 chỗ không chuẩn (dấu phẩy thừa, key không ngoặc kép)", kèm nút "Xuất JSON
chuẩn". Chỉ hiện "Valid JSON" khi strict qua.

### 7. Lần đầu mở app

Chạy với store rỗng (cài mới):

- **Focus ban đầu ở "Skip"** (`OnboardingFlow.tsx:99`, nút ghost đứng trước trong DOM), nên
  phản xạ bấm Enter là **bỏ qua onboarding**. Đã chạy: Enter → dialog đóng.
- **Guide tự bật ở mọi tool lần đầu mở.** Cài mới thì map "đã xem" rỗng
  (`useToolGuideTracking.ts:25-30`), nên Cron, API Client, Mock Server, Time Tracker… mở lần
  nào cũng bật modal (đã xác nhận với 4 tool liên tiếp). Đó là 22 lần bị cắt ngang.
- **Tiêu đề viết cứng, lẫn ngôn ngữ:** `isWhatsNew ? \`Có gì mới ở ${label}\` : \`Using ${label}\``
  (`ToolGuideModal.tsx:22`). App đang ở tiếng Anh vẫn hiện "Có gì mới ở Cron Generator". Người
  vừa cài thì cũng không có gì "mới". Nội dung guide (`toolGuides.tsx`) **chỉ có tiếng Anh**
  (0 chuỗi `vi:`).
- **Trang đích là Cron Generator** (route `/`), trong khi mục đầu tiên của sidebar là Time
  Tracker. Ấn tượng đầu tiên là một tool hẹp.
- Màn hình chào nhắc "Kafka/RabbitMQ", nhưng các tool đó không còn được đóng gói (đã chuyển
  sang plugin cài thêm).

**Đề xuất:** focus mặc định vào nút chính. Với lần đầu: thay modal bằng **gợi ý không chặn**
(một dải nhỏ "Mới dùng? Xem cách dùng (?)", tự ẩn), chỉ dùng modal cho "có gì mới" khi
*nâng cấp*. Đưa tiêu đề vào `i18n.ts`. Cho `/` trỏ về tool đầu tiên trong sidebar. Sửa câu
chào.

### 8. Khoá HMAC và khoá AES lưu dạng rõ

`EncodeHashEncrypt.tsx:540` (`hash:hmacKey`) và `:547` (`hash:key`) dùng `usePluginState`,
tức ghi thẳng vào `app-settings.json`. `docs/ai/CLAUDE.md` ghi: *"Never put a credential in
`sdk.storage`"*, và JWT/2FA/API Client đều đã chuyển sang vault (`secrets.ts` `MIGRATIONS`).
Đây là kỳ vọng ngầm của người dùng: ô nhập khoá trông giống ô mật khẩu ở các tool khác.

**Đề xuất:** `useSecretState` + thêm hai dòng vào `MIGRATIONS`. Hoặc không lưu khoá luôn, kèm
tuỳ chọn "Nhớ khoá".

---

## P2

### 9. ⌘V dán nhanh không chạy khi focus ở ô output

`useQuickPaste` bỏ qua mọi `TEXTAREA` (`useQuickPaste.ts:30-34`), **kể cả `readOnly`**. Luồng
hay gặp: bấm vào output để bôi đen/copy, rồi ⌘V để thử input khác → không có gì xảy ra.
Đã chạy ở Text Transformer và Base64: dán khi không focus vào đâu thì vào input, dán khi focus
ở output read-only thì input vẫn rỗng. Sửa: coi `readOnly`/`aria-readonly` là không sửa được.

### 10. Chuột phải bị chặn ở mọi nơi, kể cả ô nhập

`useDesktopChrome.ts:17` chặn `contextmenu` toàn cục, không loại trừ input/textarea/CodeMirror.
Mất Cut/Copy/Paste, gợi ý chính tả, "Look Up" (macOS). Người quen dán bằng chuột phải không
dán được. Sửa: chỉ chặn khi `!isEditable(target)` (hàm đã có sẵn trong file), hoặc dựng một
menu Cắt/Chép/Dán bằng `ui/context-menu.tsx`.

### 11. Tương phản dưới AA ở cả sáng và tối

axe báo `color-contrast` ở 12 màn hình (sáng) / 9 màn hình (tối). Những chỗ tiêu biểu:

| Chỗ | Tỉ lệ sáng | Tỉ lệ tối | Nguồn |
|---|---|---|---|
| Gợi ý "Press ⌘V to paste" ở đầu pane | 2.88 | 3.39 | `text-fg-mute/70` |
| Số dòng (gutter) CodeMirror | 2.01 | 2.61 | `code-theme.ts` |
| Placeholder CodeMirror | 2.94 | 4.13 | `.cm-placeholder` |
| Keycap trong nút chính ("Ctrl+B") | 3.01 | 3.22 | `opacity-60` trên `bg-acc` |
| Chip bật/tắt đang chọn (acc trên acc/10) | 4.33 | — | `ToggleChip`, tab con Network |
| Badge GET (Mock Server) | 3.15 | — | `--method-get` trên nền nhuộm 16% |
| Chuỗi JSON màu cam (syntax) | 2.89 | — | theme CodeMirror |
| "/ 8h" (Time Tracker), mô tả JWT | 2.82 | 3.91 | `text-fg-mute/70` |

Gốc rễ chung: **129 chỗ `text-fg-mute/NN`**: chữ đã "mờ" lại bị giảm thêm độ mờ. Đề xuất một
token `--fg-faint` đạt đúng 4.5:1 trên `--chrome` và `--card`, và guard cấm `text-fg-mute/[0-9]`
cho chữ (icon trang trí thì vẫn được).

### 12. Nhãn truy cập

- `button-name` (critical, 15 chỗ): trigger `Select` của Radix không có nhãn (Base64, Data
  Converter ×3, JSON ×2, SQL, Unix time ×2, Text Transformer…), một số nút icon.
- `aria-input-field-name` (6): editor CodeMirror của Data Converter, Diff, JSON, Markdown,
  Mock Server, SQL. Có thể truyền `EditorView.contentAttributes.of({ 'aria-label': … })` qua
  `code-editor-base.tsx`.
- `label` (4): textarea Deduplicate, ô "Count" của Generator, 2 ô của Mock Server.
- `nested-interactive`: tab workspace là `div[role=tab]` có `<button>` ✕ bên trong; mục
  sidebar là `<a>` có `<button>` ⭐ bên trong (HTML không hợp lệ).
- `landmark-unique`: hai `<nav>` không tên (sidebar + nav trong Settings/Time Tracker).

### 13. Bàn phím: ~40 lần Tab mới tới tool

Lần vết ở Text Transformer (titlebar Windows): tab nhóm → `?` → 3 nút cửa sổ → ô tìm →
**mỗi mục sidebar 2 điểm dừng** (link + nút ⭐) → … Phải hơn 40 lần Tab mới vào tới input.
Tab nhóm (`ToolIdentity`) mỗi tab là một điểm dừng, chứ không dùng roving tabindex như dải
workspace. Đề xuất: skip link "Tới nội dung tool" + phím tắt focus vùng tool; cho ⭐ dùng
`tabIndex=-1` (vẫn bật/tắt được qua chuột phải hoặc phím tắt); roving tabindex cho tab nhóm.
Nút cửa sổ Windows có `focus-visible:ring-0`, nên focus vào đó không thấy gì.

### 14. Thông báo lỗi thô

| Tool | Hiện tại | Nên nói |
|---|---|---|
| Base64 → Decode | `Error: Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.` | "Không phải Base64 hợp lệ — ký tự `!` ở vị trí 9" |
| JWT | `Invalid Token or Protected Header formatting` | "JWT cần 3 phần ngăn bởi dấu chấm — đang có 2" |
| Network / API Client (bản web) | `Failed to fetch` | Phân biệt DNS / timeout / TLS / bị chặn, kèm gợi ý |
| Regex | Lỗi hiện ở **đáy** pane test, cách ô pattern ~300px; ô pattern không đổi viền | Viền `bad` trên ô pattern + dòng lỗi ngay dưới |

Đợt trước cố ý giữ tiếng Anh cho chẩn đoán của engine (vì MCP và test). Hướng tách: giữ chuỗi
gốc cho MCP, còn UI bọc một câu dễ hiểu ở trên và để chuỗi gốc trong phần "Chi tiết".

### 15. Base64 quá khắt khe

`base64Decode` = `atob(input.replace(/\s+/g, ''))` (`EncodeHashEncrypt.tsx:57`). Không nhận
**base64url** (`-` `_`, dùng trong JWT/OAuth), không tự bù **padding** (`SGVsbG8` lỗi), không
bỏ tiền tố `data:…;base64,`. Đây là ba dạng hay gặp nhất khi dán từ chỗ khác vào.

### 16. Main thread đứng khi dán dữ liệu lớn

Dán 2,5 MB JSON bằng ⌘V (long task, ms):

| Tool | Long task dài nhất | Tổng |
|---|---|---|
| Text Counter | **1 819** | 2 004 |
| JSON Formatter | 766 | 1 715 |
| Data Converter | 424 | 1 527 |

Không có chỉ báo đang xử lý. `TextCounter.tsx:30` dùng `useDeferredValue`, nhưng phép đếm vẫn
chạy đồng bộ trong `useMemo`, nên chỉ lùi thời điểm đứng chứ không bỏ được nó. Theo luật
">16ms thì ra worker" trong `docs/ai/CLAUDE.md`, nên chuyển sang worker (đã có mẫu
`checksum.worker.ts`), hoặc ít nhất hiện spinner trên pane khi input > ~200 KB.

### 17. Windows: vùng resize đè nút Close/Maximize

`ResizeHandles` (`App.tsx:87-110`) là `fixed z-[200]`: dải North dày 6px và góc NE 12×12
**nằm trên** nút cửa sổ cao 38px. Bấm vào mép trên hoặc góc trên-phải của nút ✕ (đúng chỗ
Fitts's law khuyến khích khi cửa sổ maximize) sẽ kéo resize thay vì đóng. Các vùng này cũng
không tắt khi đang maximize. Sửa: bỏ góc NE / dải North ở phần nút cửa sổ, và ẩn handle khi
`isMaximized`.

### 18. Onboarding: chọn nhóm = đánh dấu sao, bỏ chọn không làm gì

`applySelection` (`OnboardingFlow.tsx:58-67`) bật **và đánh dấu sao** mọi tool trong nhóm đã
chọn. Chọn hết 7 nhóm thì cả 22 tool đều có sao, và mục "Favorites" mất nghĩa (nhãn nhóm
còn tự ẩn khi `favoriteCount === navEntries.length`). Mở lại từ Settings: nhóm đang bật được
tích sẵn, nhưng **bỏ tích không tắt tool nào**, tức checkbox nói dối. Nhãn nhóm
(`lib/onboardingToolGroups.ts`) chỉ có tiếng Anh, và cách chia nhóm khác với nhóm ở sidebar
(`lib/toolGroups.ts`), thành hai hệ phân loại cho cùng một bộ tool.

### 19. ⌘K đọc clipboard mỗi lần mở

`CommandPalette.tsx:75` đọc clipboard **mỗi lần** mở để gợi ý tool. Mục đích tốt, nhưng
clipboard thường chứa mật khẩu/token, và "Minh bạch" trong `docs/ai/CLAUDE.md` yêu cầu người
dùng biết app đang làm gì. Đề xuất: một switch trong Settings ("Gợi ý tool từ clipboard"),
cùng một dòng nhỏ trong ⌘K khi gợi ý đến từ clipboard (đã có chip; thiếu chỗ tắt). Placeholder
"Type a tool or command" cũng hứa nhiều hơn thực tế: chưa có lệnh nào (đổi theme, ngôn ngữ, mở
Settings, Reset), lệnh workspace chỉ hiện khi gõ đúng "workspace".

### 20. Thao tác nguy hiểm không cần xác nhận

Settings → Tools: **Disable all** và **Reset** (`Settings.tsx:615`). Settings → Configuration:
**Reset** (`:1110`). Một cú bấm, không xác nhận, không undo. Nhãn "Reset" cũng mơ hồ: nó reset
bật/tắt nhưng **không** reset thứ tự kéo-thả. Ba nút này còn là `<button>` tự vẽ thay vì
`Button` của kit. Đề xuất: `ConfirmDialog` (đã có) hoặc toast "Đã reset · Hoàn tác".

Liên quan: Settings **không có xuất/nhập toàn bộ dữ liệu** (collection API, workspace, cấu
hình). Chuyển máy là mất hết, trừ những tool có export riêng.

### 21. ErrorBoundary không phục hồi được

`ErrorBoundary.tsx`: chuỗi tiếng Anh cứng. Nút "Try again" render lại **với cùng state đã
lưu**: nếu tool crash vì input đã lưu (`usePluginState`), lỗi sẽ lặp mãi, và lối thoát duy
nhất là xoá toàn bộ dữ liệu app. Đề xuất: thêm "Xoá dữ liệu của tool này" (xoá namespace
`devtool:<pluginId>:*`) và "Sao chép chi tiết lỗi".

### 22. "Pick from Screen" chỉ chạy được trên Windows

`ColorPicker.tsx:114,530`: nút luôn hiện, và trên macOS (WKWebView) / Linux (WebKitGTK), nơi
không có `EyeDropper`, bấm vào chỉ để đọc thông báo lỗi. Nên ẩn đi, hoặc disable kèm tooltip
giải thích.

---

## P3 — lặt vặt

- **Lucky Wheel:** `"Auto-spin draws up to {n} distinct winner(s)."` viết cứng tiếng Anh
  (`LuckyWheel.tsx:480`). Nhãn ở nửa trái bánh xe bị **lộn ngược** ("Salad", "Burger"): nên
  lật 180° các nhãn có góc trong khoảng 90°–270°.
- **Theme:** một nút xoay vòng Light → Dark → System, không biết bấm nữa sẽ ra gì. Header
  web hiện icon *đích* (☀ khi đang tối), còn sidebar hiện icon *hiện tại*: hai cách hiểu.
  `Segmented` 3 lựa chọn (đã có ở Settings) rõ hơn.
- **Sidebar:** Settings đang chọn dùng `bg-acc/10 text-acc`, còn tool đang chọn dùng
  `bg-acc-tint text-acc-ink`: hai kiểu "đang chọn" trong cùng một cột.
- **⌘F bị chặn toàn cục** (`useDesktopChrome.ts`): không tìm được trong preview Markdown,
  guide, kết quả Network. Chỉ những tool tự làm ô tìm kiếm là có.
- **Mỗi lần chuyển tool** có animation `slide-in-from-bottom` với `duration-slow`.
  taste-skill §6 đặt ngưỡng ~200ms cho chuyển trạng thái; chuyển tool là thao tác lặp liên
  tục, nên dùng fade `duration-base` là đủ.
- **Generator** cần bấm "Generate" mới có kết quả đầu tiên (màn hình trống "Configure options
  above and click Generate"); có thể sinh sẵn một lần khi mở.
- **Time Tracker:** nút Bắt đầu bị khoá cho tới khi gõ tên công việc. Clockify/Toggl cho bắt
  đầu trước, đặt tên sau.
- **2FA:** nút "Dán" dùng `navigator.clipboard.readText()` trực tiếp (`TwoFactorAuth.tsx:683`)
  thay vì `sdk.clipboard`. Trên WKWebView, cách này có thể bật bong bóng xin quyền "Paste"
  mà `useQuickPaste` cố tránh.
- **Mock Server:** lỗi `mock_update_rules` khi server đang chạy bị nuốt
  (`useMockServer.ts:42`). Hiện Rust chỉ lỗi ở bước deserialize nên hiếm gặp, nhưng nếu xảy
  ra thì server phục vụ rule cũ mà UI không báo gì.
- **VI:** tên tool, mô tả tool (tooltip sidebar, preview ⌘K) và nội dung guide vẫn là tiếng
  Anh. Mock Server còn "New stub", "Templates:", "Log request".
- Hai cột ở Mock Server < 1024px: thanh server xuống dòng ("Ẩn log" lẻ một dòng); toolbar
  API Client ở 800px cắt bộ chọn môi trường thành "Kh…" và icon lịch sử bị cắt ở mép phải.

---

## Ý xuyên suốt

1. **Breakpoint theo viewport, không theo vùng tool.** Sidebar chiếm 224px, nên ở `lg`
   (1024px) vùng tool chỉ còn ~800px. Các tool hai cột (Lucky Wheel, Mock Server, Markdown,
   API Client) quyết định bố cục theo con số sai. Tailwind 4 có container query (`@container`
   + `@lg:`); bọc vùng route trong `@container` là đủ để mọi tool dùng được.
2. **Phím tắt toàn cục không có trọng tài.** 14 listener `keydown` trên `window`, ưu tiên
   do thứ tự mount quyết định. Nên có một registry nhỏ: tool đăng ký phím, shell nhường khi
   tool đang active đã nhận phím đó. Settings → Phím tắt sinh từ chính registry đó, nên không
   lệch được.
3. **Guard cho những gì đợt này tìm thấy:** chạy axe trong vitest/jsdom cho mỗi tool (không
   bắt được contrast, nhưng bắt được `button-name`/`label`/`nested-interactive`); guard cấm
   `text-fg-mute/[0-9]` trên chữ; test "≥ 2 tab vẫn có lối vào mọi tool trong nhóm".

## Đã kiểm, ổn

Trạng thái rỗng có hướng dẫn ở mọi tool · Cron báo lỗi từng trường + tóm tắt · Date/Time báo
lỗi parse kèm ví dụ · Data Converter báo vị trí lỗi · Mock Server ở bản web nói rõ "chỉ chạy
trên desktop" · ⌘K có preview, trạng thái không có kết quả, tìm được tool đã tắt · Guide (?)
đầy đủ, đóng bằng Esc · Dark mode đồng đều, không có màu thô · Không tràn chữ VI ở 800px trừ
các chỗ đã nêu · `prefers-reduced-motion` được xử lý toàn cục · Không lỗi console nào khi
render cả 23 màn hình.

## Cần kiểm trên app thật

- Đèn giao thông macOS đè drawer (#4): xác nhận bằng mắt trên WKWebView.
- Hộp Open/Save của OS, kéo-thả file từ Finder/Explorer (Image↔Base64, Checksum, QR).
- IME tiếng Việt (Telex/VNI) trong CodeMirror và ô tìm ⌘K: gõ dấu không bị nuốt ký tự,
  Enter khi đang ghép chữ không chọn nhầm kết quả.
- Scrollbar và font trên WebKitGTK (Linux) và WebView2 (Windows) ở dark mode.
- Mock server và sidecar chạy thật: thông báo khi port bị chiếm, khi bind thất bại.
