# Workspace — bộ tab tool có tên, lưu bền

## Vấn đề

Người dùng làm liên tục trên nhiều tool cùng lúc (VD debug backend: API Client → JSON →
JWT → Base64 → quay lại API Client) và mất thời gian tìm lại tool qua sidebar/⌘K mỗi lần
chuyển. Trước đây đã có dải "Open tools" (`OpenToolsStrip` + `useOpenTools`), nhưng:

1. **Không bao giờ hiện trên app desktop.** Nó chỉ được render trong header dạng web
   (`!showMergedTitlebar`). Trên Tauri, titlebar hợp nhất luôn bật (macOS overlay hoặc
   custom chrome Windows/Linux), nên tính năng chỉ chạy được ở `npm run dev`.
2. **Chỉ trong RAM** — mất sạch mỗi lần khởi động lại app.
3. **Một bộ duy nhất** — không tách được "bộ việc backend" với "bộ việc hằng ngày".

## Phương án đã chọn

Workspace = một bộ tab tool có tên. Có thể có tối đa 9 workspace; mỗi workspace giữ tối đa
12 tab và nhớ tool đang mở lần cuối.

- **Mở tool ở đâu cũng vào tab**: `WorkspaceProvider` (trong `<Router>`) nghe URL; mọi đường
  mở tool (sidebar, ⌘K, deep link, tab nhóm) tự ghi vào workspace đang dùng. Settings không
  chiếm tab.
- **Chuyển workspace** = khôi phục bộ tab + nhảy về tool mở lần cuối của workspace đó.
- **Lưu bền** qua `persistentStore` (key `devtool-workspaces`), parse phòng thủ — dữ liệu hỏng
  thì về trạng thái mặc định, không bao giờ khởi động vào workspace không tồn tại.
- **Thanh workspace** (`WorkspaceBar`) dựng ở cả titlebar hợp nhất (desktop) lẫn header web.
  Ẩn (hiện danh tính tool như cũ) khi < 2 tab và chỉ 1 workspace.
- Tab: bấm để chuyển, × / chuột giữa để đóng, chuột phải → Đóng / Đóng các tab khác, kéo-thả
  để sắp xếp, ←/→ khi focus trong dãy tab. Nút `+` mở ⌘K.
- ⌘K liệt kê các workspace khác ở đầu danh sách (và khớp theo tên khi gõ); gõ "workspace"
  hiện lệnh **Workspace mới…** — đường tạo workspace thứ hai, vì thanh tab (nơi có menu
  workspace) chỉ hiện khi đã có ≥2 tab.
- Chuyển sang một workspace rỗng (đã đóng hết tab) ghi luôn tool đang mở vào làm tab đầu —
  URL không đổi nên effect theo dõi URL không tự làm việc này.

### Phím tắt (Ctrl thay ⌘ trên Windows/Linux)

| Phím | Việc |
|---|---|
| ⌘1…⌘8 | Tab thứ N |
| ⌘9 | Tab cuối |
| ⌘⇧[ / ⌘⇧] (+ Ctrl+PgUp/PgDn) | Tab trước / sau |
| ⌘⌥1…⌘⌥9 | Workspace thứ N |

Không dùng **Ctrl+Tab** (API Client dùng cho tab request) và **⌘W** (API Client dùng để đóng
tab request). So theo `e.code` vì ⌥ trên macOS biến `e.key` thành ký tự khác.

## Phương án đã cân nhắc, chưa làm

- **Split view (hai tool cạnh nhau)** — giải quyết "nhìn hai tool cùng lúc", không phải "tìm
  lại tool". Tốn hơn nhiều (layout, focus, ToolHeaderActions portal phải thành đa đích). Để
  sau, nếu nhu cầu thật xuất hiện.
- **Keep-alive tool khi chuyển tab** — tool vẫn remount mỗi lần chuyển (xem memory
  "tools remount on tab switch"). Input đã lưu qua `usePluginState` nên không mất dữ liệu;
  thứ mất là trạng thái tạm (scroll, kết quả chưa lưu). Giữ sống nhiều tool cùng lúc tốn bộ
  nhớ và đụng các tool có timer/kết nối — cần đo trước khi làm.

## File

- `src/lib/workspaces.ts` — model thuần + test (`workspaces.test.ts`)
- `src/contexts/WorkspaceContext.tsx` — nối router/storage, phím tắt, hộp đặt tên
- `src/components/WorkspaceBar.tsx` — UI (+ `WorkspaceBar.test.tsx`)
- `src/components/WorkspaceNameDialog.tsx`
- `src/lib/shortcuts.ts` — khai báo cho Settings → Phím tắt
