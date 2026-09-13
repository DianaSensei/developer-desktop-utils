# Postmortem: Sidebar drag/drop không bao giờ hoạt động trong app desktop thật - 2026-09-13

## Time Discovered

2026-09-13, người dùng báo ngắn gọn: "tôi vẫn không thể kéo thả request trong api tool" — SAU
KHI một fix khác cùng ngày (df02f84, "kéo thả request/folder không thể sắp xếp quanh một
folder") đã được commit và xác nhận (theo tôi tưởng) là đúng.

## Timeline of Events

- `workflow-router` phân loại bug-fix, ghi rõ đây là báo cáo "vẫn không hoạt động" sau một fix
  trước đó — cần điều tra lại từ đầu, không giả định fix cũ đã đúng.
- Tái hiện bằng **chuột thật** (không phải sự kiện giả lập) qua Playwright điều khiển system
  Chrome, drag thật giữa hai request — **thành công**, thứ tự đảo đúng.
- Điều này mâu thuẫn với báo cáo của người dùng → nghi ngờ: bug không nằm ở LOGIC (đã test đúng
  hai lần, cả jsdom lẫn browser thật), mà ở MÔI TRƯỜNG THẬT (app desktop) khác với môi trường
  test (browser tab thường).
- Grep toàn bộ mã nguồn tìm cơ chế drag-drop khác trong app: phát hiện `useTauriFileDrop.ts`
  (dùng ở ChecksumTool/QRCodeTool/ImageBase64Tool) với comment sẵn có: "Tauri intercepts native
  file drops before the webview, so the browser's HTML5 `ondrop` never receives them".
- Xác nhận `tauri.conf.json` không có `dragDropEnabled: false` → dùng mặc định Tauri v2
  (`true`), tức TÍNH NĂNG NÀY LUÔN BẬT, và theo đúng comment trên, nó chặn HTML5 DnD toàn trang.
- Checkpoint: trình bày nguyên nhân thật (khác hẳn root cause đã "fix" trước đó — fix cũ vẫn
  đúng LOGIC nhưng không bao giờ được CHẠY TỚI trong app thật) — người dùng chọn viết lại cơ chế
  kéo-thả bằng pointer events (không đụng vào `dragDropEnabled`, không ảnh hưởng 3 tool kia).
- Viết lại `Sidebar.tsx`: bỏ hoàn toàn `draggable`/`onDragStart`/`onDragOver`/`onDrop`, thay bằng
  `onPointerDown` + window-level `pointermove`/`pointerup`/`pointercancel`/`keydown` (Escape hủy),
  ngưỡng di chuyển 4px để phân biệt click thường, `document.elementFromPoint` + data attribute
  để hit-test hàng đang hover (thay cho dragover target).
- Viết lại toàn bộ 6 test trong `Sidebar.test.tsx` bằng pointer event thật (stub
  `document.elementFromPoint` vì jsdom không implement), xác nhận cả 6 fail trên code cũ / pass
  trên code mới (`git stash`).
- Xác nhận lại bằng chuột thật trên browser (Playwright) sau khi viết lại — vẫn đúng.
- Thử xác nhận trên app desktop thật (đã có sẵn tiến trình `tauri dev` chạy từ trước, HMR đã đẩy
  code mới vào) — màn hình đang khoá, không chụp được ảnh xác nhận trực quan; không tìm cách bỏ
  qua khoá màn hình theo đúng nguyên tắc đã giữ suốt phiên làm việc.

## Initial Symptoms

Kéo một request trong sidebar API Client để sắp xếp lại không có tác dụng gì trong app desktop
thật — mặc dù cùng thao tác, cùng code, được xác nhận HOẠT ĐỘNG ĐÚNG khi thử qua một tab trình
duyệt thường (Chrome hệ thống) chạy cùng Vite dev server.

## Root Cause

Sidebar's kéo-thả sắp xếp được xây trên native HTML5 Drag and Drop
(`draggable`/`dragstart`/`dragover`/`drop`). Ứng dụng desktop chạy trong Tauri webview, và cửa
sổ Tauri có tuỳ chọn `dragDropEnabled` (mặc định `true` ở Tauri v2) — bật để bắt sự kiện kéo
FILE từ hệ điều hành (Finder/Explorer) vào app, dùng bởi `useTauriFileDrop.ts` (ChecksumTool,
QRCodeTool, ImageBase64Tool). Khi bật, Tauri chặn TOÀN BỘ drag session ở cấp OS trước khi tới
được webview — không phân biệt đó là file từ Finder hay một phần tử HTML5 `draggable` bên trong
chính trang. Kết quả: `dragstart`/`dragover`/`drop` không bao giờ fire trong app desktop thật,
dù logic xử lý các sự kiện đó (đã sửa đúng ở df02f84) hoàn toàn chính xác. Một tab trình duyệt
thường không chạy trong Tauri, không có `dragDropEnabled` can thiệp, nên HTML5 DnD vẫn hoạt động
bình thường ở đó — khiến việc "test bằng browser" trông như đã xác nhận đúng trong khi môi
trường thật (app desktop) chưa từng được kiểm chứng.

## Impact

Tính năng kéo-thả sắp xếp request/folder trong Sidebar CHƯA TỪNG hoạt động đối với người dùng
thật (chạy app desktop), kể từ khi nó được xây dựng — không phải một regression mới, mà một
tính năng chưa bao giờ chạy được trong môi trường thật, chỉ "trông như hoạt động" khi kiểm tra
qua browser hoặc jsdom.

## How It Was Found/Reproduced

Dùng chuột thật (không phải script giả lập sự kiện) qua Playwright điều khiển system Chrome —
xác nhận logic ĐÚNG trong browser, mâu thuẫn với báo cáo người dùng, dẫn tới nghi ngờ đúng hướng:
môi trường thật (Tauri) khác biệt so với môi trường test. Grep codebase cho các cơ chế OS-level
khác (`onDragDropEvent`) tìm ra bằng chứng trực tiếp trong chính comment code cũ.

## The Fix

Viết lại toàn bộ cơ chế kéo-thả trong `Sidebar.tsx` bằng pointer events thuần
(`pointerdown`/`pointermove`/`pointerup`/`pointercancel`), không phụ thuộc vào drag session cấp
OS mà `dragDropEnabled` can thiệp:
- `onPointerDown` trên mỗi row (chỉ khi không đang sửa tên và `depth > 0`) bắt đầu theo dõi,
  chưa coi là kéo cho tới khi di chuyển vượt ngưỡng 4px (phân biệt với click thường chọn request).
- Vượt ngưỡng → gắn `dragging` state, `document.body` tắt user-select + đổi con trỏ thành
  `grabbing` (native DnD từng làm việc này tự động).
- Mỗi `pointermove` gọi `findDropTarget()` — dùng `document.elementFromPoint` + data attribute
  (`data-tree-row`/`data-row-id`/`data-container`/`data-depth`) gắn sẵn trên mỗi row để hit-test,
  giữ NGUYÊN toàn bộ logic phân vùng before/after/inside đã đúng từ fix trước.
- `pointerup` → `commitDrop()` (đọc `dragId`/`dropTarget` qua ref, không đóng trực tiếp state, vì
  listener là closure thuần tạo một lần lúc `pointerdown`, không phải React callback tái tạo mỗi
  lần render — đóng trực tiếp sẽ luôn thấy giá trị `null` từ TRƯỚC khi kéo bắt đầu).
- `Escape` hoặc `pointercancel` huỷ kéo giữa chừng (native DnD cũng cho phép Escape).

## Tests Added to Prevent Recurrence

Viết lại toàn bộ `Sidebar.test.tsx` (6 test) bằng pointer event thật thay vì `DragEvent` giả:
3 test phân vùng before/after/inside cũ (chuyển sang pointer), cộng 2 test mới — "không bắt đầu
kéo khi chưa vượt ngưỡng" (bảo vệ click thường) và "giữ Alt để copy thay vì move" — và test
`revealTick` không đổi. Xác nhận cả 6 fail trên code cũ (không có `data-tree-row`, vẫn dùng
`draggable`) / pass trên code mới.

## Unresolved

Chưa xác nhận trực quan trên app desktop thật (native Tauri window) — HMR đã đẩy code mới vào
tiến trình `tauri dev` đang chạy sẵn, nhưng màn hình máy đang khoá tại thời điểm này nên không
chụp được ảnh xác nhận. Theo nguyên tắc đã giữ suốt phiên làm việc, không tìm cách bỏ qua khoá
màn hình. Độ tin cậy của fix vẫn cao (xem lý luận dưới), nhưng bước xác nhận cuối cùng — thử kéo
thật trong app desktop — cần người dùng tự làm và xác nhận lại.

**Vì sao vẫn tin tưởng dù chưa xác nhận trực quan**: `dragDropEnabled` của Tauri chặn cụ thể
DRAG SESSION cấp hệ điều hành (thứ mà thuộc tính HTML5 `draggable` khởi tạo) — nó không chặn các
sự kiện con trỏ thông thường (`pointerdown`/`pointermove`/`pointerup`), vốn chỉ là sự kiện chuột
cơ bản mọi webview luôn xử lý bất kể có đang can thiệp drag-drop hay không. Cách sửa lần này né
hẳn cơ chế mà Tauri can thiệp, thay vì cố chạy song song với nó.

**Bước tiếp theo đề xuất**: người dùng tự thử kéo-thả trong app desktop thật sau khi mở khoá màn
hình, xác nhận lại với tôi — nếu vẫn có vấn đề, đó sẽ là một phát hiện MỚI (không phải cùng
nguyên nhân này), vì lý luận kỹ thuật ở trên khá chắc chắn cơ chế mới không bị `dragDropEnabled`
can thiệp.
