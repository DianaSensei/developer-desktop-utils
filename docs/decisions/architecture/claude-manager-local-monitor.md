# Claude Manager — monitor chỉ-đọc dựa trên dữ liệu cục bộ của Claude Code

## Bối cảnh

Yêu cầu: một tool "quản lý Claude" kiểu Orca — theo dõi trạng thái, phiên agent, mức
dùng, nhiều tài khoản. Orca là một trình điều phối (tự mở terminal, worktree, chạy
agent). DevTool là bộ tiện ích; nó không có terminal nhúng hay PTY.

## Phương án đã chọn

Phiên bản đầu là **monitor chỉ-đọc**: plugin `claude-manager` + module Rust
`claude_monitor.rs` đọc những gì Claude Code đã ghi sẵn xuống đĩa. Không khởi chạy,
không dừng, không nhắn cho phiên nào.

```
~/.claude (hoặc CLAUDE_CONFIG_DIR)            claude_monitor.rs            UI
├─ projects/<proj>/<session>.jsonl      ──►  FileState (cache theo file,  ──►  usage.ts
│   └─ <session>/subagents/*.jsonl            đọc tăng dần theo offset)        (trạng thái,
├─ sessions/<pid>.json  (registry)      ──►  LiveInfo (+ kiểm tra PID sống)     gộp, chi phí)
└─ .claude.json | ~/.claude.json        ──►  Account (chỉ khối oauthAccount)
```

- **Tài khoản = thư mục cấu hình.** Claude Code tách tài khoản bằng `CLAUDE_CONFIG_DIR`,
  nên "multi account" là danh sách thư mục (`Profile`), lưu trong `sdk.storage`. Không
  có khái niệm "chuyển tài khoản" trong app: nút chép lệnh `CLAUDE_CONFIG_DIR=… claude`
  để người dùng tự chạy.
- **Dò tìm thư mục theo nội dung, không theo danh sách tool.** Mỗi công cụ chuyển tài
  khoản / điều phối agent tự chọn chỗ đặt thư mục (`~/.<tool>/instances/<tên>`, thư mục
  app-data…), và danh sách đó thay đổi liên tục, nên không hard-code đường dẫn của tool
  nào. `claude_monitor_detect` nhận diện một thư mục cấu hình bằng chữ ký: có `projects/`
  **và** (có transcript tên dạng UUID / `agent-*` **hoặc** có `.claude.json` /
  `.credentials.json` — chỉ kiểm tra tồn tại). Chỉ `projects/` thì quá phổ biến để tin.
  Ba nguồn, theo thứ tự ưu tiên khi trùng: vị trí chuẩn (`~/.claude`, `~/.config/claude`)
  → `CLAUDE_CONFIG_DIR` của app và của **tiến trình đang chạy** (`sysinfo` `environ()`;
  nguồn chính xác nhất cho "tool khác", vì chính tool đó đã truyền biến này cho Claude)
  → duyệt BFS thư mục home sâu 4 cấp, tối đa 20.000 thư mục, bỏ `node_modules`/`.git`/
  cache, không theo symlink. BFS để các chỗ nông (khả năng cao) được xét trước khi hết
  ngân sách.
- **Lần đầu tự thêm, về sau chỉ gợi ý.** Lần mở đầu tiên mọi thứ tìm thấy được theo dõi
  luôn (`autoDetected`). Sau đó thư mục mới chỉ hiện ở "Tìm thấy trên máy"; thư mục người
  dùng đã bỏ theo dõi vào `ignoredDirs` để không tự quay lại.
- **Đường dẫn tùy ý**: cùng lệnh đó với `roots` — kiểm tra chính thư mục, rồi tìm bên
  trong 3 cấp (chọn thư mục cha chứa nhiều tài khoản là đủ). Không thấy gì thì từ chối
  kèm lý do, thay vì thêm một dòng rỗng. Nút chọn thư mục dùng
  `sdk.files.pickOpen({ directory: true })` (tùy chọn `directory` được thêm vào SDK cho
  việc này).
- **Trạng thái** lấy từ registry `sessions/<pid>.json` (`status`: busy / idle / …) khi
  PID còn sống. Không có registry (bản Claude Code cũ, chạy qua SDK) thì transcript vừa
  được ghi trong 2 phút = đang chạy. Chuỗi `status` được truyền nguyên về frontend và
  phân loại ở `sessionStatus()` — giá trị lạ rơi về "idle", không vỡ.
- **Usage** cộng từ `message.usage` của từng dòng `assistant`, gom theo
  **(giờ UTC, model)** cho mỗi phiên. Frontend tự gộp theo ngày địa phương / model / dự
  án / tài khoản, nên đổi khoảng thời gian không cần quét lại.
- **Khử trùng lặp theo `message.id`**, ở hai cấp: (1) trong một file, một response được
  ghi thành nhiều dòng (mỗi content block một dòng) lặp lại cùng id — dòng sau ghi đè;
  (2) giữa các file, phiên `--resume` chép lại lịch sử sang transcript mới — quét theo
  thứ tự phiên cũ trước và bỏ id đã thấy, để token thuộc về phiên đã thực sự trả tiền.
- **Đọc tăng dần.** Transcript chỉ được nối thêm và có thể rất lớn. Cache tĩnh
  `PathBuf → FileState` giữ `offset` (luôn dừng ở ranh giới dòng); file lớn lên thì đọc
  tiếp từ offset, file nhỏ đi thì đọc lại từ đầu. Dòng cuối chưa có `\n` (đang ghi dở)
  được để lại cho lần sau. Nhờ vậy poll 5 giây là rẻ.
- **Chi phí** là ước tính theo bảng giá API (`PRICES` trong `usage.ts`, khớp theo tiền tố
  dài nhất). Model không có trong bảng → không tính, và UI nói rõ số lượt bị bỏ.

## Mở rộng: transcript, ngân sách, cấu hình (2026-11)

Ba bổ sung sau bản đầu, mỗi cái nới một ràng buộc ban đầu một cách có chủ đích:

- **Nội dung hội thoại, theo yêu cầu** (`claude_transcript.rs`). Bản đầu không trả nội
  dung về webview; người dùng đã chọn có trình xem. Ranh giới mới: `scan` vẫn chỉ trả
  tiêu đề, còn nội dung chỉ đi qua IPC khi người dùng mở một phiên
  (`claude_monitor_transcript`, phân trang 300 mục, mỗi mục ≤ 20.000 ký tự) hoặc tìm kiếm
  (`claude_monitor_search`, chỉ trả đoạn trích ±80 ký tự). Không lưu gì vào storage.
  Chỉ số mục (`index`) được tính bởi cùng một hàm `read_entries` cho cả hai lệnh, nên kết
  quả tìm kiếm mở đúng chỗ trong trình xem. Tìm kiếm bỏ qua tool call / kết quả tool và
  transcript của agent con: chúng lấn át hội thoại và chiếm phần lớn dung lượng. Tên
  `project` / `session` từ UI được kiểm (`safe_name`) để không thoát khỏi `projects/`.
  Tìm kiếm đọc lại mọi file mỗi lần (không có chỉ mục) — chấp nhận được với debounce
  350 ms; nếu chậm trên kho transcript lớn thì thêm chỉ mục hoặc lọc trước theo byte.
- **Ngân sách và thông báo** (`budgetStates` / `dueBudgetAlerts` trong `usage.ts`). Tính
  trên chi phí ước tính của **mọi** tài khoản (không theo bộ lọc trên thanh công cụ), theo
  ngày và tháng lịch địa phương. Mỗi ngưỡng (80%, 100%) báo một lần mỗi kỳ nhờ nhật ký
  `budgetAlerts` = `<kỳ>:<mức>` lưu trong storage. Không gắn component nền vào `App.tsx`:
  thông báo chỉ chạy khi tool đang mở trong một tab; tab không ở trước vẫn quét lại mỗi
  30 giây (`BACKGROUND_POLL_MS`). Đổi lại, đóng tab là hết cảnh báo — đã ghi rõ trong UI.
- **Ghi cấu hình, phạm vi hẹp** (`claude_config.rs`). Tool không còn hoàn toàn chỉ-đọc:
  `claude_monitor_write_config` ghi được đúng hai file, `settings.json` và `CLAUDE.md`
  (danh sách trắng theo tên, không nhận đường dẫn), và chỉ trong thư mục có `projects/`.
  Mỗi lần ghi: kiểm `expected_mtime_ms` (file đổi sau khi mở → `conflict`, không ghi đè),
  `settings.json` phải là JSON object, bản cũ chép sang `<tên>.devtool-bak`, bản mới ghi ra
  file tạm rồi `rename` để Claude Code không bao giờ đọc file dở. **MCP server chỉ xem**:
  chúng nằm trong `.claude.json`, file Claude Code tự ghi lại liên tục khi đang chạy (lịch
  sử, cache, số liệu) — một bên ghi thứ hai sẽ đua với nó và có thể làm mất dữ liệu. Thay
  vào đó có nút chép lệnh `claude mcp remove`. Giá trị `env` / `headers` của MCP server
  được parse thành `IgnoredAny` nên không bao giờ rời Rust; chỉ tên khoá được trả về.
- **Biểu đồ** một chuỗi (chi phí hoặc token theo ngày, gộp tuần khi > 62 ngày) dùng màu
  accent của app, không có bảng màu phân loại; phân tách theo model nằm ở bảng bên dưới.

## Lý do

- **Không đụng credential.** Con số "còn bao nhiêu % hạn mức 5 giờ / tuần" chỉ máy chủ
  Anthropic biết; lấy nó phải đọc OAuth token trong `.credentials.json` / keychain và gọi
  một endpoint không công bố. Đổi một con số lấy rủi ro với token của người dùng là không
  đáng, và trái nguyên tắc "không gọi mạng ngầm". Tool chỉ hiển thị thứ đo được cục bộ và
  ghi rõ đó không phải hạn mức còn lại.
- **Không trả nội dung hội thoại về webview.** Chỉ tiêu đề (≤ 140 ký tự). Plugin chạy
  chung JS realm với mọi plugin khác; càng ít dữ liệu nhạy cảm đi qua IPC càng tốt.
- **Rust thay vì `sdk.files`**: cần duyệt thư mục ngoài app-data, đọc file hàng trăm MB
  theo offset và kiểm tra PID — cả ba đều không hợp với webview.
- **Tier A (lệnh Tauri) thay vì sidecar Tier B**: không có kết nối sống lâu hay thư viện
  nặng; chỉ dùng `serde_json`, `chrono`, `sysinfo` vốn đã có trong cây phụ thuộc.

## Rủi ro đã biết / việc tiếp theo

- **Định dạng transcript và registry không phải API công khai** của Claude Code. Mọi
  trường đều `Option` và dòng không parse được bị bỏ qua, nên thay đổi định dạng làm
  thiếu số liệu chứ không làm hỏng tool — nhưng số liệu thiếu thì khó nhận ra. Khi thấy
  usage bằng 0 bất thường, kiểm tra lại tên trường trong `Line` / `Usage` trước.
- **Dò tìm có thể sót**: thư mục nằm ngoài home, sâu hơn 4 cấp, hoặc sau symlink sẽ
  không được quét — khi đó chỉ thấy lúc tool kia đang chạy Claude (nguồn tiến trình),
  hoặc người dùng thêm tay. Môi trường của tiến trình thuộc user khác không đọc được.
- **PID tái sử dụng**: registry có `procStart` nhưng chưa đối chiếu; một PID chết rồi
  được tiến trình khác dùng lại sẽ hiện phiên là "đang mở" cho tới khi Claude Code dọn
  file registry.
- **Cache không bao giờ thu nhỏ** trong một lần chạy app (mỗi response một `MsgUsage`,
  ~100 byte). Với vài trăm nghìn response vẫn chỉ vài chục MB; nếu thành vấn đề thì gộp
  sẵn thành bucket cho các file đã ngừng thay đổi.
- **"5 giờ gần nhất"** tính theo bucket giờ (giờ hiện tại + 4 giờ trước), không khớp
  chính xác cửa sổ trượt của Anthropic.
- **Điều phối kiểu Orca** (mở phiên mới, worktree, gửi prompt) là bước sau nếu cần: nên
  đi qua một sidecar Tier B điều khiển `claude` CLI / Agent SDK, không nhét vào module
  chỉ-đọc này.
- Bảng giá trong `usage.ts` phải cập nhật tay khi có model mới.
