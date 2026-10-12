# Audit 22 built-in plugin (2026-10)

Bổ sung cho [ui-ux-audit-2026-10.md](ui-ux-audit-2026-10.md) (shell + SDK). Mỗi plugin được
quét bằng cùng một bộ chỉ số (convention bàn phím, i18n, trạng thái rỗng/lỗi/đang tải, timer
và listener có dọn hay không, worker, nút icon có tên, xác nhận thao tác phá huỷ), rồi đọc
code ở những chỗ chỉ số báo bất thường. **Audit tĩnh** — chưa chạy app thật; mục nào cần
xác minh trên app được ghi rõ.

## Lỗi nghiêm trọng — đã sửa

| Plugin | Lỗi | Bằng chứng | Sửa |
|---|---|---|---|
| **2FA** | Xoá tài khoản chỉ một cú bấm, không xác nhận, không undo. Mất secret TOTP = có thể bị khoá khỏi tài khoản thật. | `TwoFactorAuth.tsx` `handleDelete` lọc thẳng khỏi danh sách | `ConfirmDialog` nêu rõ tài khoản và hậu quả |
| **2FA** | Export (đường sao lưu duy nhất) dùng `<a download>` — trong webview Tauri thẻ này không ghi ra file; chính `lib/fileio.ts` rẽ nhánh `isTauri` vì lý do đó. | `exportAccounts()` | Đi qua `saveTextFile` (hộp Save của OS); thêm quyền `files:write`; lỗi hiện ra thay vì im lặng |
| **Markdown** | Preview **không có style**: dùng class `prose` nhưng app không cài `@tailwindcss/typography` — CSS build ra có 0 rule `.prose`. Heading cùng cỡ chữ thân, list mất dấu đầu dòng, code block không nền. | `grep -c '\.prose' dist/assets/*.css` → 0 | Component dùng chung `ui/markdown-view.tsx`, style bằng token |
| **Markdown** | Bấm link trong preview **điều hướng cả cửa sổ app** sang trang web đó; không có nút Back (⌘[ / Backspace bị chặn trong `useDesktopChrome`). CSP không chặn điều hướng top-level. | `<ReactMarkdown>` không override `a` | Link đi qua `sdk.openExternal` (quyền `open-url`) |
| **Markdown** | Từ khoá tìm kiếm có "gfm" nhưng không bật GFM — bảng, task list, gạch ngang không render. Ảnh remote bị CSP chặn → icon ảnh vỡ. | không có `remark-gfm` | Thêm `remark-gfm`; ảnh remote thành chip "mở ở trình duyệt" |
| **Time Tracker** (Meeting Notes) | Cùng hai lỗi Markdown ở trên. | `MeetingNotes.tsx` | Dùng `MarkdownView` |
| **Text Transformer** | camelCase/snake_case chạy trên cả khối văn bản → danh sách định danh mỗi dòng một cái bị gộp thành MỘT (`user_id⏎first_name` → `userIdFirstName`). | `splitWords` tách cả `\n` | Chuyển theo từng dòng, giữ dòng trống |
| **Text Transformer** | Từ khoá hứa "kebab", "title case" nhưng không có — tìm "kebab" trong ⌘K dẫn tới tool không làm được việc đó. | `MODE_OPTIONS` | Thêm PascalCase, CONSTANT_CASE, kebab-case, Title Case |
| **Color Picker** | Tải palette PNG dùng `<a download>` — cùng lỗi với export 2FA. | `downloadPalette()` | `saveBinaryFile`; thêm quyền `files:write` |

Test mới: `markdown-view.test.tsx`, `TextTransformer.cases.test.ts`.

## Theo từng plugin

Ký hiệu: ✅ ổn · ⚠️ nên sửa · 🔧 đã sửa trong đợt này.

| Plugin | Đánh giá | Ghi chú |
|---|---|---|
| **2FA** | 🔧 | Xem bảng trên. Còn lại: tự viết `EmptyState` cục bộ trùng tên component của kit. |
| **API Client** | ✅ | Trưởng thành nhất: 7 empty state, 3 xác nhận phá huỷ, worker, 73 chỗ báo lỗi/trạng thái. ⚠️ 233 chuỗi tiếng Anh cứng — nhiều nhất app. |
| **Encode·Hash·Encrypt** | ✅ | Hash/bcrypt/argon2 chạy trong worker. ⚠️ `PipelineTab` tự viết `CopyBtn` thay `CopyButton`; không có empty state. |
| **Color Picker** | 🔧 | Xem bảng trên. ⚠️ 0 `aria-label`. |
| **Cron Generator** | ⚠️ | Có mô tả bằng lời cho biểu thức, nhưng **không có danh sách "N lần chạy tiếp theo"** — tính năng người dùng cần nhất để chắc biểu thức đúng (crontab.guru). |
| **Data Converter** | ✅ | Debounce 180ms, lỗi bằng `ExplainBand`. ⚠️ Nút bật/tắt "Pretty XML" tự vẽ (`<button>` + `rounded-lg`) thay vì `Switch`/`Segmented`. |
| **Deduplicate** | ✅ | Worker + textarea không kiểm soát cho dữ liệu lớn. Tự cài undo riêng (trùng `useInputHistory`, nhưng có lý do: textarea uncontrolled). |
| **Diff** | ✅ | CodeMirror Merge, có nhảy chunk. |
| **Generator** | ✅ | Random dùng `lib/secureRandom` (crypto), không `Math.random`. |
| **JSON Formatter** | ⚠️ 🔧 | 🔧 thêm ⌘Z. ⚠️ **Cây không ảo hoá**: mỗi dòng JSON là một DOM node có `onMouseEnter` — file vài chục nghìn dòng sẽ ì. ⚠️ Cây không dùng được bằng bàn phím (div + onClick, không `role="tree"`). ⚠️ Tìm kiếm tô sáng nhưng không có số kết quả / nhảy tới kết quả kế. |
| **JWT Debugger** | ✅ | Cảnh báo rõ "Unsigned token", "Decoded, not verified". |
| **Lucky Wheel** | ⚠️ 🔧 | 🔧 thêm ⌘Z. ⚠️ Bốc thăm dùng `Math.random` — với công dụng "raffle" công khai nên dùng `crypto.getRandomValues` (đã có `secureRandom`). |
| **Markdown** | 🔧 | Xem bảng trên. 🔧 thêm ⌘Z. ⚠️ Hai cột cố định `grid-cols-2`, không xếp chồng khi cửa sổ hẹp. |
| **Mock Server** | ✅ | Có empty state cho stub/log/matcher. ⚠️ 45 chuỗi cứng. |
| **Network Tools** | ✅ ⚠️ | Mọi lời gọi mạng ra ngoài đều do người dùng bấm (đúng luật minh bạch). ⚠️ Tự viết lại `CopyBtn`, `Pill`, `Empty`, `SearchInput` — kit đã có `CopyButton`, `Badge`, `EmptyState`, `SearchInput`. |
| **QR Code** | ✅ | Lưu file đúng nhánh Tauri. |
| **Regex Tester** | ✅ | Mẫu mực: worker + timeout chống regex thảm hoạ, preset, số match. |
| **SQL Formatter** | ⚠️ | Tự viết `ToggleChip`; không có empty state. |
| **Time Tracker** | 🔧 ⚠️ | 🔧 Meeting Notes (xem trên); 🔧 nút ‹ › đổi tuần/ngày có tên truy cập. ⚠️ Tự viết `Modal` và `Toggle` (7 chỗ dùng) thay `ModalShell`/`Switch` của kit. |
| **Text Counter** | ⚠️ | Cột nhập cố định `width: 40%`. "Reading time" làm tròn lên → 1 từ = "1 min". |
| **Text Transformer** | 🔧 ⚠️ | Xem bảng trên. ⚠️ Chọn một kiểu mỗi lần qua dropdown — với đổi kiểu chữ, hiện **tất cả kiểu cùng lúc** (mỗi dòng một nút Copy) nhanh hơn nhiều. |
| **Date / Time** | ✅ | Timer đồng hồ được dọn đúng. |

## Vấn đề xuyên suốt — trạng thái

| # | Vấn đề | Trạng thái |
|---|---|---|
| 1 | **i18n 0/22 plugin** | ✅ 22/22 dịch phần giao diện. Mỗi tool một `<Tool>.messages.ts` (hook `useMessages`); API Client dùng `apiclient/i18n.ts` (dịch cấp module — an toàn vì ngôn ngữ chỉ đổi trong Settings, lúc đó tool đã unmount). Kit (`ui.messages.ts`): ConfirmDialog, CopyButton, SearchInput, DatePicker (tên thứ/tháng qua `Intl`)… `toolMessages.test.ts` bắt bản dịch rỗng / lệch tham số. **Cố ý giữ tiếng Anh:** chẩn đoán của engine (lỗi parser JSON, lỗi Web Crypto của JWT, lỗi Punycode…) vì cùng chuỗi đi qua MCP tới AI agent và được test khoá nguyên văn; tên cột CSV xuất ra của Time Tracker (dữ liệu trao đổi). |
| 2 | Component kit bị viết lại cục bộ | ✅ Network (`Badge`/`EmptyState`/`SearchInput` của kit, kit `SearchInput` thêm prop `icon`), 2FA (`EmptyState`), Time Tracker `Toggle` → `Switch`, JWT `LabelledInput` → `Field`. Thêm `ToggleChip` vào kit và thay các nút bật/tắt tự vẽ ở 8 nơi (SQL, Data Converter, Text Transformer, Encode Pipeline, Hash, Random Generator, Lucky Wheel, QR). `Modal` của Time Tracker vốn đã bọc `ModalShell` — giữ. |
| 3 | `<a download>` | ✅ Guard `anchorDownloadInPluginCode` (platform `guard.test.ts`, ngưỡng 0). |
| 4 | Bố cục cố định | ✅ Markdown xếp chồng khi hẹp; Text Counter `flex-col md:flex-row`; thời gian đọc "< 1 min". |

### Đã làm thêm sau đợt đầu

- **Cron (lỗi có từ trước):** chế độ Quartz báo chính biểu thức mặc định và mọi preset 6 trường
  là "Invalid expression" — code đòi đủ 7 trường dù năm là tuỳ chọn. Sửa + `CronGenerator.test.tsx`.
- **Workspace:** chuyển sang workspace rỗng giờ ghi tool đang mở làm tab; kéo-thả dùng vị trí
  trong danh sách đầy đủ (trước lệch khi workspace có tool đã tắt); ⌘K có lệnh "Workspace mới…".

- **JSON Formatter:** cây ảo hoá (chỉ vẽ phần nhìn thấy, ~50 dòng thay vì toàn bộ); bàn phím theo mẫu ARIA tree (↑↓ → ← Enter Home End, `role="tree"/"treeitem"`); tìm kiếm có số kết quả `k/n` và nhảy ↵ / ⇧↵.
- **Cron Generator:** danh sách 5 lần chạy tiếp theo (`lib/cronNext.ts`, hỗ trợ `L`, `xL`, `x#k`; `W` báo "không xem trước được").
- **Lucky Wheel:** bốc thăm bằng `crypto` (`randomBelow`).
- **Text Transformer:** chế độ "All cases at once".
- **Xoá không xác nhận** (thêm 3 chỗ ngoài 2FA): stub của Mock Server (`ConfirmDialog`), meeting note và bản ghi giờ trong Calendar (bấm hai lần). `ConfirmButton` của Time Tracker giờ nói rõ "Bấm lần nữa để xác nhận".
- **Tooltip tự chế:** `InfoTip` của Date/Time → `Tooltip` của kit; guard `handRolledTooltip` mở rộng bắt cả `group-hover/<tên>:block`. Cột "Scope" của Network → `Tooltip` thay `title`.
- **Cỡ chữ:** token `text-dense` (13px) cho bậc chữ thân trong panel dày; mọi `text-[12/12.5/13px]` đã quy về thang; guard `offScaleText` (ngưỡng 0).
- **Code chết:** xoá `UuidGenerator.tsx` (không file nào import).

## Cần kiểm trên app

- Markdown preview sáng/tối, bảng dài cuộn ngang, link mở trình duyệt hệ thống.
- Export 2FA và tải palette Color Picker ra hộp Save của macOS/Windows.
- Hộp xác nhận xoá 2FA hiện đúng tên tài khoản.
- Chuyển Settings → Ngôn ngữ sang Tiếng Việt rồi mở lần lượt các tool: chữ không tràn ở toolbar hẹp (VI dài hơn EN ~20–30%), đặc biệt API Client (tab, header Runner) và Network (thanh tab con).
- Cây JSON với file vài chục MB: cuộn mượt, ↑↓ giữ dòng chọn trong tầm nhìn.
