# Audit UI/UX — App shell, 22 tool, Plugin SDK (2026-10)

Audit chi tiết từng plugin: [plugin-audit-2026-10.md](plugin-audit-2026-10.md).

Phạm vi: shell (titlebar, sidebar, ⌘K, header), 22 plugin compile-time trong `src/plugins/`,
bề mặt UI mà Plugin SDK đưa cho plugin cài ngoài. Đối chiếu với `design/RULES.md`,
`docs/ai/CLAUDE.md` (convention tool) và `.claude/skills/taste-skill`.

**Cách làm:** audit tĩnh trên mã nguồn (grep có hệ thống + đọc code), chưa chạy app thật —
mọi mục dưới đây đều có file:dòng để kiểm lại. Những gì cần mắt người trên app thật (tương
phản thực tế sáng/tối, cảm giác chuyển động, tràn chữ VI/EN) để ở mục "Cần kiểm trên app".

## Tóm tắt

Nền móng **tốt hơn mức trung bình**: các luật cơ học của RULES.md đều sạch (0 màu Tailwind
thô, 0 `rounded-[…]`, 0 chữ < 11px, 0 `hover:-translate-y`, 0 `<select>`/`alert`/`confirm`
native) — nhờ `guard.test.ts`. Vấn đề nằm ở tầng **trải nghiệm xuyên tool** và **SDK**:
tính năng điều hướng giữa các tool bị hỏng trên desktop, convention bàn phím áp dụng không
đều, nửa app chưa song ngữ, và plugin cài ngoài không có bộ UI kit để dùng.

| # | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| 1 | P0 | Dải "Open tools" không bao giờ hiện trên app desktop | ✅ Sửa — thay bằng Workspace |
| 2 | P0 | Không có cách giữ bộ tool đang làm qua các lần mở app | ✅ Workspace lưu bền |
| 3 | P1 | Plugin SDK không đưa UI kit cho plugin cài ngoài | ✅ `__DEVTOOL_VENDOR__.ui` (SDK 1.1.0) |
| 4 | P1 | Undo/redo (⌘Z) thiếu ở một số tool nhập text | ✅ JSON, Markdown, Lucky Wheel (xem ghi chú) |
| 5 | P1 | 0/22 tool song ngữ — giao diện VI lẫn EN | ✅ 22/22 + kit (xem plugin-audit) |
| 6 | P2 | Nút icon không có tên truy cập | ✅ |
| 7 | P2 | Hai bản JSX song song cho header (titlebar vs web) | ✅ `ToolIdentity` |
| 8 | P2 | Cỡ chữ ngoài thang (`12px`, `12.5px`, `13px`) | ✅ token `text-dense` + guard |
| 9 | P2 | `shadow-soft` trên pill accent đặc (RULES: `shadow-btn`) | ✅ |
| 10 | P2 | Bố cục tool trôi khỏi Pattern A/B | ⏳ Chưa — chuyển dần khi đụng từng tool |
| 11 | P2 | Trạng thái rỗng (empty state) hiếm | ◐ Thêm ở 2FA, Network; các tool khác dùng placeholder có hướng dẫn |

---

## P0 — Điều hướng giữa các tool

### 1. "Open tools" chết trên desktop  ✅ đã sửa

`OpenToolsStrip` chỉ được render trong khối `{!showMergedTitlebar && …}` của `App.tsx`.
`showMergedTitlebar = showMacOverlayChrome || showCustomChrome` — tức **luôn true trên Tauri**
(macOS và Windows/Linux). Tính năng chỉ chạy trong `npm run dev` trên trình duyệt; test
pass vì test render component trực tiếp, không qua chrome thật.

### 2. Không có "bộ việc" lưu bền  ✅ đã làm

Đây chính là yêu cầu "working space". Chi tiết thiết kế:
[`docs/decisions/ui/workspaces.md`](../decisions/ui/workspaces.md). Tóm tắt:

- Mọi tool đã mở vào tab của workspace đang dùng, lưu qua các lần mở app.
- Tối đa 9 workspace có tên (VD "Debug backend", "Hằng ngày"), mỗi cái nhớ tool mở lần cuối.
- ⌘1–9 nhảy tab · ⌘⇧[ ] tab trước/sau · ⌘⌥1–9 đổi workspace · ⌘K liệt kê workspace.
- Đóng (×, chuột giữa, chuột phải), kéo-thả sắp xếp, ←/→ trong dãy tab.
- Phím tắt đã khai báo trong Settings → Phím tắt.

---

## P1

### 3. Plugin SDK: plugin cài ngoài không có UI kit

`window.__DEVTOOL_VENDOR__` (`src/main.tsx:52`) chỉ đưa `react`, `react-dom`, `jsxRuntime` và
các hook `platform.*`. **Không có** `Button`, `Input`, `Select`, `Segmented`, `EmptyState`,
`ToolToolbar/ToolPanes`, `CopyButton`, `useLocale`, `ToolHeaderActions`, `useQuickPaste`,
`useInputHistory`. Hệ quả:

- Mỗi plugin (Redis/RabbitMQ/Kafka/Container trong `developer-desktop-miniapp`) phải tự chép
  hoặc tự dựng lại component → trôi khỏi design system theo thời gian, nhân đôi Radix trong
  bundle.
- Docs `05-external-install.md` đã phải dành cả một mục cho việc class Tailwind không có rule
  (safelist + `plugin-utilities.css`) — triệu chứng của cùng gốc rễ: plugin không dùng chung
  component với app chủ.
- Convention UX bắt buộc (⌘V quick paste, ⌘Z undo, live dot) không áp được cho plugin ngoài.

**Đã làm** (`src/platform/vendorUi.ts`, nạp lười trong `installer.ts` để không kéo CodeMirror vào entry; docs ở `05-external-install.md`). Đề xuất gốc: thêm `__DEVTOOL_VENDOR__.ui` = re-export `@/design-system` (đã có sẵn một bề mặt
duy nhất) + `hooks` (`useQuickPaste`, `useInputHistory`, `useImagePaste`) + `useLocale` +
`ToolHeaderActions`; ghi phiên bản vào `SDK_VERSION` (minor bump) để plugin khai báo
`sdk: '^1.x'`. Plugin dùng component của app chủ thì class luôn có rule — bỏ được phần lớn
gánh nặng safelist.

### 4. Undo/redo không đều

`docs/ai/CLAUDE.md` yêu cầu `useInputHistory` trên mọi tool text. Hiện có ở: Cron, Data
Converter, Encode/Hash, QR, Regex, Text Counter, Text Transform, JWT. **Thiếu** ở: JSON
Formatter, SQL Formatter, Text Diff, Markdown, Array Deduplicator, Date/Time, Image↔Base64,
Network Tools, Color Picker, Lucky Wheel… Người dùng học được ⌘Z ở tool A rồi bấm ở tool B
không có gì xảy ra — tệ hơn là không có ở đâu cả.

**Đã làm:** thêm `useInputHistory` cho JSON, Markdown, Lucky Wheel. Đọc kỹ thì danh sách
"thiếu" ban đầu phóng đại: Deduplicate tự cài undo riêng (textarea uncontrolled); SQL và Diff
là CodeMirror — có undo riêng trong editor; Network/Date-Time/Checksum chỉ có `<input>` một
dòng — undo native của trình duyệt áp dụng (hook cũng cố ý bỏ qua `<input>`).

### 5. Song ngữ mới tới shell

`src/lib/i18n.ts` ghi rõ G3 chỉ dịch shell, tool dịch ở G4. Kiểm lại kỹ: **không tool nào** gọi
`useLocale` (0/22) — JSON, Regex, SQL, Diff, Markdown, Network, Encode/Hash, JWT… đều hardcode tiếng Anh (`label="Input"`,
`placeholder="Find by key, value, or path…"`, `>No differences<`). Người dùng chọn VI thấy
sidebar/⌘K tiếng Việt nhưng nội dung tool tiếng Anh. Không phải lỗi — là nợ đã lên kế hoạch;
nên ưu tiên các tool hay dùng nhất (JSON, API Client, Encode, JWT) trước.

---

## P2

### 6. Nút icon thiếu tên truy cập
Ví dụ `clockify/Timesheet.tsx:50,56` (‹ › đổi tuần), `clockify/CalendarView.tsx:227,233`,
`clockify/TimeTracker.tsx:870`, `apiclient/EnvironmentEditor.tsx:304`,
`apiclient/GenerateCodeDialog.tsx:102`, `App.tsx` (nút menu mobile trong header web) — không
`aria-label`, không `title`. Screen reader đọc "button". Sửa: thêm `aria-label` (và `title`
cho tooltip).

### 7. Header viết hai lần
Khối tab nhóm (`activeGroupTabs`) + nhãn tool được viết lại gần nguyên văn ở titlebar
(`App.tsx` ~dòng 880) và header web (~dòng 1130), chỉ khác kích thước. Đã có comment cảnh báo
"tránh lặp ~70 dòng JSX dễ trôi lệch" nhưng khối này vẫn lặp. Đề xuất tách
`<ToolIdentity size="titlebar|header" />`.

### 8. Cỡ chữ ngoài thang
Thang chuẩn: `text-xs` / `text-[11px]` / `text-sm`. Ngoài thang: `text-[13px]` (8 chỗ),
`text-[12px]` (3), `text-[12.5px]` (2), `text-[11.5px]` (1) — ở `CommandPalette`, `Settings`,
`McpSetupDialog`, `outline-notice`, `explain-band`, `param-row`, `setting-row`,
`RequestQuickOpen`. Hoặc đưa `13px` vào thang thành token, hoặc quy về `text-sm`/`text-xs`.

### 9. `shadow-soft` trên pill accent đặc
`App.tsx:899,1155` (tab nhóm đang chọn) và `ui/segmented.tsx:134` dùng
`bg-acc … shadow-soft`; RULES.md checklist yêu cầu nút đặc dùng `shadow-btn`.

### 10. Bố cục trôi khỏi Pattern A/B
Chỉ 9/22 plugin dùng `tool-layout` (`ToolToolbar`/`ToolPanes`/`ToolPane`); phần còn lại tự dựng toolbar/pane. Hệ quả nhìn
thấy được: chiều cao toolbar, padding pane và vị trí nút Copy khác nhau giữa các tool. Nên
chuyển dần trong cùng đợt G4 (đụng file nào thì chuyển luôn).

### 11. Empty state hiếm
`EmptyState` chỉ được dùng ở 4 file trong `tools/`. Các tool output-rỗng phần lớn hiện ô
trống. taste-skill §4: trạng thái rỗng phải nói bước tiếp theo ("Dán JSON hoặc ⌘V để bắt đầu").

---

## Đã kiểm, sạch

Màu Tailwind thô · bo góc cứng · chữ < 11px · hover-lift · viền dùng tông nền · `<select>`
/`alert`/`confirm` native · scrollbar inline — đều 0 vi phạm (chỉ còn trong comment).

## Cần kiểm trên app (không làm được bằng đọc code)

1. Thanh workspace trên titlebar macOS: không đè đèn giao thông, kéo cửa sổ vẫn được ở vùng
   trống, bấm tab không kéo cửa sổ.
2. Windows/Linux custom chrome: 8+ tab tràn ngang cuộn mượt, không đẩy nút caption.
3. Tương phản AA của tab không chọn (`text-fg-mute`) trên `bg-chrome` ở cả sáng/tối.
4. Đổi VI ↔ EN với tên workspace dài — không tràn (đã cắt `max-w-[9rem] truncate`).
