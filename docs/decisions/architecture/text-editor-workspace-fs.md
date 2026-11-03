# Text Editor — truy cập thư mục theo "workspace root" cấp qua hộp thoại Rust

## Vấn đề

Tool **Text Editor** (`src/plugins/text-editor`, `src/components/tools/editor/`) cần làm
những việc một editor kiểu VS Code làm: mở thư mục, liệt kê cây, đọc/ghi file, tạo / đổi tên
/ di chuyển / xoá file và thư mục. SDK hiện có (`sdk.files`) chỉ đọc/ghi **từng file** người
dùng chọn qua hộp thoại — không liệt kê thư mục, không tạo/xoá/đổi tên. Còn `fs` plugin của
Tauri thì scope chỉ có `fs:scope-appdata-recursive`.

Hai cách hiển nhiên đều sai:

1. **Nới capability `fs` (`fs:allow-read-dir`, `fs:allow-remove`, scope `**`)** — biến webview
   thành "làm gì cũng được với mọi file của user", trái với hướng `dropped.rs` đã vạch ra
   (một XSS là đủ phá).
2. **Lệnh Rust nhận đường dẫn tuỳ ý** (`delete(path)`) — y hệt vấn đề trên, chỉ chuyển chỗ.

## Phương án đã chọn

Ranh giới ở **cấp thư mục**, giống ý tưởng của `dropped.rs` ở cấp file:

- **Workspace root** chỉ được thêm bởi `editor_pick_folder` — lệnh này **tự mở hộp thoại chọn
  thư mục từ Rust** (`tauri_plugin_dialog::DialogExt`) rồi ghi folder người dùng chọn vào
  `Roots`. Webview không bao giờ gửi "hãy cấp quyền cho folder X". Danh sách root được lưu ở
  `<app_data>/editor-roots.json` (chỉ Rust ghi) nên mở lại "Recent" sau khi khởi động lại vẫn
  an toàn. Xoá khỏi Recent (`editor_forget_root`) = thu hồi quyền.
- Mọi lệnh khác (`editor_list_dir`, `_list_files`, `_stat`, `_read_file`, `_write_file`,
  `_create_file`, `_create_dir`, `_rename`, `_move`, `_delete`) đi qua `Roots` trong
  `src-tauri/src/editor_fs.rs` (Rust thuần, không phụ thuộc Tauri → test được không cần
  WebKit):
  - `resolve(p)`: canonicalize **cả đường dẫn** (đi theo symlink) rồi kiểm tra nằm trong một
    root — dùng cho đọc / ghi / liệt kê. Symlink trỏ ra ngoài → `denied`.
  - `resolve_entry(p)`: canonicalize **chỉ thư mục cha** + tên — dùng cho xoá / đổi tên / di
    chuyển, để thao tác lên chính symlink chứ không phải đích của nó. Root không bao giờ là
    entry (không xoá/đổi tên được workspace từ cây).
  - Tạo file/thư mục lồng nhau (`a/b/c.txt`) tạo **từng cấp** và kiểm tra lại containment ở
    mỗi cấp — `create_dir_all` sẽ đi xuyên một symlink có sẵn và tạo thư mục bên ngoài trước
    khi kịp kiểm tra (xem experience-log 2026-11-02).
  - `write_text` không bao giờ tạo file mới; ghi đè tại chỗ (giữ quyền, owner, hard link) và
    trả `conflict` nếu mtime trên đĩa khác mtime editor đã đọc.
- Manifest chỉ khai `native` với allowlist `['editor_']` + `storage` + `clipboard:write`.
  **Không thêm capability Tauri nào** (hộp thoại mở từ Rust không đi qua IPC permission).

### Frontend

- `store.ts` — store phạm vi module (shell unmount tool khi chuyển tool; chỉnh sửa chưa lưu
  phải sống sót). Giữ `EditorState` của CodeMirror cho **từng tab** (undo history, selection,
  scroll riêng); **một** `EditorView` duy nhất được `setState` khi đổi tab. Theme / ngôn ngữ /
  word-wrap là `Compartment` dùng chung; khi một state được đưa vào view thì theme + wrap được
  reconfigure lại (state cất trong Map giữ cấu hình của lúc nó được tạo).
- Lưu bền qua `sdk.storage` (gộp 250 ms, chỉ ghi key đổi): folder đang mở, đường dẫn các tab,
  tab đang active, thư mục đang mở rộng, word wrap. **Nội dung chưa lưu không được lưu bền.**
- Không có file watcher: khi cửa sổ được focus lại, re-list các thư mục đang mở rộng và `stat`
  các tab — tab sạch tự reload, tab có thay đổi chưa lưu hiện banner Reload / Keep Mine.
- Bản web (`npm run dev`, test) chạy trên `memoryFs.ts` cùng ngữ nghĩa và mã lỗi với Rust,
  nên test của store/component chạy thật đầu-cuối trong jsdom.
- Highlight theo tên file qua `@codemirror/language-data` — mỗi grammar là một dynamic import
  riêng, chỉ tải khi mở file loại đó.
- Kéo-thả trong cây dùng pointer event (HTML5 DnD không tới được webview vì Tauri chặn để nhận
  file thả từ OS — cùng lý do với cây của API Client).

## Tab Untitled ("hot exit") — bổ sung 2026-11-02

Yêu cầu: tab mới (⌘N) gõ tuỳ ý, không phải chọn nơi lưu, **không mất khi đóng** và khôi
phục lại được.

- **Nội dung không nằm trong `sdk.storage`.** Store dùng chung (`app-settings.json`, plugin
  store của Tauri, autosave 100 ms) ghi lại TOÀN BỘ file mỗi lần đổi — nhét buffer có thể vài
  MB vào đó làm phình và làm chậm mọi lần lưu setting của cả app. Thay vào đó mỗi tab untitled
  có một file `<app_data>/editor-backups/<key>.txt` (`src-tauri/src/editor_backup.rs`): ghi
  nguyên tử (tmp + rename), quyền 0600, tối đa 20 MB. Lệnh chỉ nhận **key**
  (`[A-Za-z0-9_-]{1,64}`), thư mục cố định — không thành đường đọc/ghi tuỳ ý.
  `sdk.storage` chỉ giữ metadata nhỏ: `untitled` (key + số "Untitled-N" theo thứ tự tab) và
  `closed` (danh sách Recently Closed).
- **Đóng tab untitled không bao giờ hỏi.** Có chữ → chuyển vào Recently Closed (giữ backup) +
  thông báo có nút Khôi phục; rỗng → bỏ luôn. ⌘⇧T mở lại tab vừa đóng (cả tab file). Giữ tối đa
  30 mục; mục bị đẩy ra, Discard, Clear List đều xoá backup. Lúc khởi động, backup không còn ai
  tham chiếu (crash, tab bị bỏ khi đang thoát) bị dọn.
- Ghi backup debounce 400 ms sau lần gõ cuối, và flush cùng `flushPersist()` (cả `pagehide`).
  Đóng tab ghi bản cuối ngay trước khi bỏ `EditorState`.
- Tên tab = dòng đầu có chữ (tối đa 40 ký tự), như VS Code; Save As gợi ý tên đó + `.txt`.
- **Save As / Open File cấp quyền từng file**: `Roots.files` bên cạnh `Roots.roots`. File được
  chọn trong hộp thoại OS (mở từ Rust) chỉ được đọc / ghi / stat — `resolve_entry` vẫn đòi thư
  mục cha nằm trong root nên không xoá / đổi tên / liệt kê quanh nó được. `editor-roots.json`
  chuyển từ mảng sang `{ roots, files }`, vẫn đọc được định dạng cũ.
- ⌘N đổi nghĩa từ "file mới trong thư mục đang chọn" sang "tab untitled" (đúng VS Code); tạo
  file trong cây vẫn có ở nút Explorer và menu chuột phải.

Rủi ro: backup là văn bản thuần trên đĩa — ai dán secret vào tab nháp thì secret nằm trong file
đó tới khi Discard (đã ghi trong TOOLS.md). Mã hoá bằng khoá vault là hướng làm nếu cần.

## Highlight và formatter kiểu VS Code — bổ sung 2026-11-03

- **Bảng màu**: `vscodeHighlight` (`src/components/ui/code-theme.ts`) lấy màu từ token
  `--vsc-*` (Light+ / Dark+ của VS Code) và phủ mọi tag mà các grammar trong language-data phát
  ra (khai báo vs điều khiển luồng, type, function, property, hằng, tag/attribute, markup,
  diff). Chỉ Text Editor dùng; các editor nhỏ trong app giữ `codeHighlight` (`--sql-*`) để không
  đổi giao diện tool khác.
- **Tô màu cặp ngoặc** (`code-vscode.ts`): tự viết, ~60 dòng — đếm độ sâu từ đầu tài liệu (tối
  đa 300 000 ký tự trước viewport) tới hết viewport, bỏ qua ngoặc trong node có tên dạng
  string/comment/regexp/template (khớp không phân biệt hoa thường để chạy với cả grammar lezer
  lẫn legacy mode), ngoặc đóng thừa tô đỏ. Không thêm package vì các package có sẵn đều cũ hoặc
  chỉ hỗ trợ JS.
- **Đường kẻ thụt lề**: `@replit/codemirror-indentation-markers`. Pseudo-element của nó có
  `z-index: -1`, nên phải đặt `isolation: isolate` cho `.cm-content`, không thì bị nền của khung
  editor che (xem experience-log).
- **Nhận dạng thụt lề** (`detectIndent`): tab vs space theo số dòng, độ rộng = bước tăng phổ biến
  nhất (làm tròn về 2/4/8), bỏ qua bước 1 space (JSDoc ` * `). Gắn qua compartment
  `indentSlot` cho từng `EditorState`; status bar đổi được.
- **Formatter** (`format.ts`): Prettier standalone (mỗi parser là một dynamic import, chunk
  riêng — typescript ~0,9 MB chỉ tải khi format TS), `sql-formatter` cho các dialect SQL,
  còn lại dùng `indentRange` của CodeMirror + xoá khoảng trắng cuối dòng. Kết quả được áp thành
  **một** thay đổi tối thiểu (bỏ prefix/suffix chung) để con trỏ và scroll đứng yên, ⌘Z một lần
  là hoàn tác. Lỗi cú pháp → thông báo kèm dòng:cột, văn bản không bị đụng.
  - Config Prettier: `.prettierrc(.json/.yaml/.yml)` / `package.json#prettier` gần nhất, đi lên
    tới thư mục workspace; config thắng thụt lề đã nhận dạng (như extension VS Code).
    `parser`, `plugins`, `overrides` trong config bị bỏ qua; file config dạng JS không bao giờ
    được chạy.
  - XML: plugin mặc định `xmlWhitespaceSensitivity: 'strict'` (không re-indent gì cả) → đặt
    mặc định `ignore` như cách VS Code format XML; config dự án vẫn ghi đè được.
  - Format on Save (tắt mặc định, như VS Code), lưu trong `sdk.storage`.
- **Change Language Mode** (`LanguagePicker.tsx`) + tự đoán cho tab untitled (`guessLanguage`,
  heuristic có thứ tự, chạy lại 500 ms sau khi ngừng gõ nếu người dùng chưa chọn). Lựa chọn của
  tab untitled được lưu cùng metadata của nó.

## Đã cân nhắc, chưa làm

- **Xoá vào Thùng rác** (crate `trash`) — UX tốt hơn, nhưng thêm dependency native cho cả ba
  OS mà môi trường CI/agent không build thử được macOS/Windows. Hiện xoá vĩnh viễn, luôn qua
  `ConfirmDialog` nói rõ "không vào Thùng rác". Ứng viên đầu tiên nếu có phản hồi.
- **File watcher** (`notify` crate) — chính xác hơn focus-refresh nhưng tốn tài nguyên với
  workspace lớn và cần quản lý vòng đời watcher theo root.
- **Tìm trong toàn workspace** (⌘⇧F), và hot exit cho chỉnh sửa chưa lưu của **file** (hiện
  chỉ tab untitled được backup).
- **Formatter cho Python/Go/Rust/Java…** (ruff/gofmt/rustfmt bản WASM): nặng và mỗi ngôn ngữ một
  runtime; hiện các ngôn ngữ này chỉ được re-indent theo grammar.
- **Encoding khác UTF-8** — file không phải UTF-8 hiện bị coi là nhị phân (không mở) để không
  ghi hỏng khi lưu.

## File

- `src-tauri/src/editor_fs.rs` — luật filesystem + 18 test (symlink, `..`, prefix, root…)
- `src-tauri/src/editor.rs` — lệnh Tauri, state, lưu `editor-roots.json`, hộp thoại
- `src-tauri/src/editor_backup.rs` — backup tab untitled + test
- `src/components/tools/editor/` — `store.ts` (+ test), `fs.ts`, `memoryFs.ts`, `Explorer.tsx`,
  `EditorTabs.tsx`, `EditorPane.tsx`, `StatusBar.tsx`, `QuickOpen.tsx`, `fileRanking.ts`
