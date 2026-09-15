# Rà soát toàn app — bug UI/UX và chức năng (08/2026)

Phạm vi: toàn bộ `src/` (≈60k dòng, 26 tool + shell), `src-tauri/` ở mức cấu
hình. Phương pháp: đọc mã theo lớp (shell → context → hook dùng chung →
component dùng chung → tool), cộng với quét mẫu lỗi trên toàn cây và đối chiếu
với các luật trong `docs/ai/CLAUDE.md` + `design/RULES.md`.

Nền trước khi sửa: `tsc --noEmit` sạch, 368/368 test xanh, `npm run build` chạy
được. Nghĩa là không có bug nào dưới đây bị công cụ hiện có bắt — tất cả đều
lọt qua typecheck và test.

---

## Đã sửa trong đợt này

### 1. Màn hình TRẮNG khi mở app nếu đã tắt Cron Generator — nghiêm trọng

`/` không phải một trang riêng: nó là route của Cron Generator
(`TOOL_ROUTES` trong `lib/toolRegistry.ts`). Mà Cron Generator tắt được như mọi
tool khác trong Settings, và `<Routes>` chỉ đăng ký route cho tool ĐANG BẬT,
lại không có route dự phòng nào.

Kịch bản: Settings → tắt Cron Generator → đóng app → mở lại. App khởi động ở
`/`, không route nào khớp, vùng nội dung trống trơn — trong khi header vẫn vẽ
tên "Cron Generator" (vì `activeTool` rơi về `allTools[0]`). Trông y như app
hỏng. Cùng cái bẫy đó áp cho mọi URL không khớp.

**Sửa:** thêm `<Route path="*">` chuyển hướng về tool đầu tiên đang bật theo
đúng thứ tự sidebar của người dùng, hoặc `/settings` nếu tắt sạch. Khoá lại
bằng `src/App.routing.test.tsx`.

### 2. `<select>` và `<input type="datetime-local">` gốc trong Container Logs

`docs/design/DESIGN-SYSTEM.md` cấm hẳn control gốc của trình duyệt vì chúng vẽ
khác nhau hoàn toàn giữa WKWebView (macOS), WebView2 (Windows) và WebKitGTK
(Linux) — riêng WebKitGTK còn không dựng nổi lịch cho `datetime-local`, để lại
một ô chữ trống người dùng phải tự gõ đúng định dạng. Repo đã có sẵn
`Select`/`DatePicker`/`TimePicker`/`DateTimePicker` viết ra đúng để thay chúng;
`container/LogsPanel.tsx` là chỗ DUY NHẤT trong app còn sót (đã kiểm tra toàn
cây: không còn `<select>` hay `datetime-local` nào khác).

**Sửa:** thay bằng `Select` + `DateTimePicker`, mốc thời gian đổi từ chuỗi sang
`epoch-ms | null` với nút xoá để quay về "không giới hạn". Ô tìm kiếm cũng
chuyển sang `Input` dùng chung.

### 3. Log bị MẤT trong lúc tạm dừng — Container Logs

`channel.onmessage` cũ: `if (!followRef.current) return;` — dòng log đến trong
lúc tạm dừng bị vứt thẳng. Nghĩa là đúng khoảng thời gian người dùng dừng lại
để ĐỌC chính là khoảng bị mất log vĩnh viễn, không dấu hiệu nào báo là đã hổng,
và socket vẫn chạy nên bấm Live lại cũng không kéo về được.

**Sửa:** đệm lại (cùng trần `MAX_LINES` để dừng lâu không phình bộ nhớ) và xả
ra khi tiếp tục; nút hiện `Paused · N held`.

### 4. TOTP hiển thị mã ĐÃ HẾT HẠN — tool 2FA

`setInterval(…, 1000)` làm mới mã bằng điều kiện `timeRemaining() === period`,
tức phải rơi trúng đúng một giây ranh giới. Nhưng webview bị hãm nhịp lúc ẩn
cửa sổ, máy ngủ dậy, hay chỉ trôi nhịp thông thường đều có thể nhảy cóc qua
giây đó — khi ấy điều kiện không bao giờ đúng và thẻ tiếp tục hiện một mã đã
hết hạn cho tới một chu kỳ sau ngẫu nhiên nào đó khớp lại. Người dùng chép mã
đó đi và bị từ chối, không hiểu vì sao.

**Sửa:** so sánh SỐ CỬA SỔ TOTP (`floor(now/period)` — đúng counter mà
`computeTOTP` dùng) thay vì rình giây ranh giới; bỏ lỡ bao nhiêu nhịp cũng vẫn
phát hiện được.

### 5. `ConfirmDialog` nuốt lỗi — mọi thao tác phá huỷ trong app

`onConfirm` ném lỗi thì `handleConfirm` không bắt: hộp thoại đứng nguyên, nút
quay về trạng thái bấm được, người dùng không có cách nào biết thao tác đã hỏng
(lời hứa bị từ chối chỉ hiện ở console như unhandled rejection). Đây là hộp
thoại dùng chung cho xoá queue / xoá key Redis / xoá volume / ngắt kết nối —
hỏng vì mất mạng là kịch bản thường ngày.

**Sửa:** bắt lỗi, hiện `Callout` trong hộp thoại, nút đổi thành "Retry"; lỗi cũ
được xoá khi đóng.

### 6. `Tooltip` không dùng được bằng bàn phím, và tràn viewport

Comment trong `App.tsx` nói lý do bỏ tooltip tự chế là "không xử lý được bàn
phím hay tràn viewport" — nhưng bản `Tooltip` dùng chung thay thế nó cũng không
làm cả hai việc đó: chỉ nghe `mouseenter`/`mouseleave`, và đặt `position: fixed`
thẳng theo rect của trigger, không kẹp gì.

Hệ quả thực tế: ở sidebar THU GỌN, tooltip là thứ DUY NHẤT nói mỗi icon là tool
gì — với người dùng bàn phím / trình đọc màn hình, đó là một cột icon không
nhãn. Và mục nav cuối (gần đáy) hay trigger sát mép phải thì bong bóng bị cắt.

**Sửa:** thêm `onFocus`/`onBlur` (hiện ngay, không chờ `delay`) + Escape để
đóng, và kẹp toạ độ trong viewport theo từng `side`. Khoá bằng
`src/components/ui/tooltip.test.tsx`.

### 7. Công tắc trong Settings không có tên cho trình đọc màn hình

`Toggle` là `role="switch"` với `aria-checked` nhưng không có nội dung chữ nào
bên trong và không nối với nhãn hiển thị ở hàng bên cạnh → trình đọc màn hình
đọc ra một "switch" trống trơn, không biết đang bật/tắt cái gì. Áp cho toàn bộ
danh sách bật/tắt tool và công tắc auto-update.

**Sửa:** `label` thành prop BẮT BUỘC, đổ vào `aria-label` + `title`; thêm hai
khoá i18n `settings.tools.enableAria` / `disableAria`.

### 8. Secret 2FA hợp lệ bị từ chối

`base32Decode` cắt padding `=` TRƯỚC rồi mới bỏ khoảng trắng. Secret dán từ
trang cấu hình của dịch vụ thường có dạng `"JBSW Y3DP EHPK 3PXP"` và đôi khi
kèm cả `=` lẫn khoảng trắng thừa ở cuối — khi đó `/=+$/` không khớp vì còn dấu
cách chắn phía sau, `=` sót lại, và hàm ném `Invalid character: "="` cho một
secret hoàn toàn hợp lệ.

**Sửa:** đảo thứ tự (bỏ khoảng trắng trước). Khoá bằng `src/lib/otpauth.test.ts`.

### 9. Ba file nguồn chứa byte NUL thật → git/grep coi là nhị phân

`apiclient/cookies.ts`, `rabbit/consumerStore.ts`, `rabbit/QueueListView.tsx`
nhúng ký tự NUL nguyên byte làm dấu phân tách khoá thay vì viết escape
`\u0000`. Hệ quả: `git diff` báo `Binary files differ`, `grep`/`ripgrep` bỏ qua
nội dung, và mọi review trên ba file này mù hoàn toàn (`QueueListView.tsx`
riêng nó đã 373 dòng).

**Sửa:** thay bằng escape `\u0000`. Không đổi hành vi; ba file trở lại dạng văn
bản.

---

## Ghi nhận, CHƯA sửa

Xếp theo mức đáng làm. Không đưa vào đợt này vì mỗi mục đều đụng nhiều hơn một
chỗ hoặc cần quyết định thiết kế.

### A. `useRabbitData` khoá cache bằng `loader.toString()`

`cacheKey = ${loader.toString()}|${JSON.stringify(deps)}` — dựa vào MÃ NGUỒN của
arrow function inline để phân biệt call site. Trong bản build đã minify, hai
view khác nhau hoàn toàn có thể rút gọn thành cùng một chuỗi (`()=>a.b(c.id)`)
với cùng `deps` (`[conn.id, refreshKey]` là bộ deps rất phổ biến ở đây) — đúng
kịch bản "hand one view another's data" mà chính comment trong file cảnh báo,
chỉ khác là cơ chế phòng vệ không đủ mạnh ở production. Nên đổi sang một khoá
tường minh do call site truyền vào.

### B. Không xoá cache khi ngắt kết nối

Cùng file: `cache` là Map ở tầng module, không có đường vô hiệu hoá khi người
dùng ngắt/kết nối lại broker. Sau khi reconnect, view có thể phục vụ dữ liệu
của phiên trước cho tới khi bấm refresh tay.

### C. `lazy()` hỏng vĩnh viễn sau khi app tự cập nhật

`React.lazy` nhớ luôn promise bị từ chối. Nếu chunk của tool tải hỏng (hay gặp
nhất: bản build mới đã thay tên file băm trong lúc app đang mở), nút "Try again"
của `ErrorBoundary` không cứu được — mount lại vẫn nhận đúng promise hỏng cũ.
Cần một `key` để tạo lại lazy component, hoặc mời người dùng khởi động lại.

### D. Ô nhập số không xoá trắng được

Mẫu `parseInt(e.target.value) || 1` xuất hiện ở `UuidGenerator`, `RandomGenerator`,
`PasswordHash`, `FakeDataGenerator`. Xoá hết nội dung ô là giá trị nhảy về 1
ngay giữa lúc gõ, nên muốn đổi 5 → 20 phải gõ theo thứ tự khác thường. Cách làm
đúng là giữ chuỗi thô ở state và chỉ chuẩn hoá lúc blur/submit.
`FakeDataGenerator` còn không chặn trần trên cho `count`.

### E. `ToolPanes` chia đôi cứng, không kéo được

Mẫu layout A (input/output) khoá tỉ lệ 50/50 (hoặc 1/3). Với output dài — JSON
đã format, kết quả regex — nửa dưới lúc nào cũng chật trong khi nửa trên trống.
Repo đã có sẵn `ui/split-pane.tsx` nhưng các tool này không dùng.

### F. `CountdownRing` (2FA) dùng mã màu hex cứng

`'#ef4444'` / `'#f59e0b'` / `'#10b981'` viết thẳng trong file. `guard.test.ts`
không bắt được vì nó chỉ quét CLASS Tailwind, không quét hex. Nên dùng token
`bad`/`warn`/`ok` — cùng ba trạng thái đó đã có sẵn trong hệ màu.

### G. Chỉ shell được dịch, 24 tool vẫn tiếng Anh

7/185 file dùng `useLocale`. Đây là quyết định CÓ CHỦ Ý và có ghi rõ trong
`lib/i18n.ts` (dịch dần theo từng tool ở giai đoạn G4), nhưng với người dùng
chọn tiếng Việt thì hiện tại vẫn là một app song ngữ dở dang: sidebar tiếng
Việt, nội dung tool tiếng Anh. Đáng đưa vào lộ trình rõ ràng hơn là để lặng.

### H. Vài chỗ nhỏ

- `formatRFC3339InTz` (`DateTimeTool`) trả hậu tố `Z` cho MỌI múi giờ lệch 0 —
  `Europe/London` mùa đông ra `…Z` thay vì `…+00:00`.
- `hexToRgb` (`ColorPicker`) trả về đen cho hex sai định dạng, không báo lỗi.
- `morseEncode` (`EncodeHashEncrypt`) bỏ im lặng mọi ký tự không có trong bảng
  Morse — không có cảnh báo là output đã mất chữ.
- `resetToDefaults` (`FeatureContext`) chỉ đặt lại danh sách bật/tắt, không đặt
  lại thứ tự sidebar lẫn danh sách yêu thích.
- `LocaleContext` tạo mới object `value` mỗi lần render → mọi consumer render
  theo, không cần thiết.

---

## Không phải bug (đã kiểm tra, sạch)

- Vòng đời timer/listener/worker: 66 `addEventListener` khớp đủ 66
  `removeEventListener`; mọi `setInterval`/`setTimeout` đều có dọn dẹp; worker
  (`regex`, `deduplicate`, `checksum`) đều `terminate()` và có watchdog chống
  ReDoS. `createObjectURL` đều có `revokeObjectURL` đi kèm.
- Khoá `usePersistentState`: 0 trùng lặp trên toàn app.
- Hệ màu: 0 màu Tailwind thô còn lại ngoài comment (khớp `design/baseline.json`).
- Không còn `window.alert`/`confirm`/`prompt` hay `navigator.platform` nào.
- Luồng auto-update: có chống hạ cấp phiên bản, watchdog chống treo tải, huỷ
  được, tự thử lại khi có mạng — không thấy lỗ hổng.
