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

## Mở rộng: tài khoản dùng chung phiên, xoá tài khoản (2026-11)

- **Hai thư mục, một bộ transcript.** Trình quản lý tài khoản (ví dụ profile của Orca
  ở `…/orca/claude-profiles/<id>/home`) thường liên kết `projects/` của mỗi profile về
  cùng một chỗ để giữ lịch sử chung. Bản đầu quét từng thư mục độc lập nên hai tài khoản
  hiện số liệu y hệt và tổng bị nhân đôi. `scan_all` giờ quét theo thứ tự danh sách với
  **một** tập `seen` (id message) và một bảng `owner` (id phiên → thư mục đầu tiên có
  nó): phiên đã có chủ không được liệt kê lại, thư mục sau chỉ báo `shared_sessions` /
  `shares_data_with`. Khử theo **id phiên** chứ không theo đường dẫn thật
  (`canonicalize`), vì cách đó cũng đúng khi `projects/` được *chép* chứ không liên kết.
  Trạng thái "đang chạy" lấy từ registry riêng của thư mục sau vẫn được gắn vào phiên ở
  thư mục chủ. Hệ quả chấp nhận: phiên dùng chung thuộc về tài khoản đứng trước trong
  danh sách — transcript không ghi tài khoản nào đã chạy nên không tách được.
- **Xoá tài khoản = chuyển thư mục vào Thùng rác** (`claude_monitor_remove_account`,
  crate `trash`), không `remove_dir_all`: thao tác này lấy đi phiên, cấu hình và đăng nhập,
  nên phải hoàn tác được. Từ chối khi thư mục không có `projects/`, là thư mục home hay
  gốc ổ đĩa, hoặc registry của nó còn PID sống. Với `~/.claude` mặc định, `~/.claude.json`
  đi cùng. Keychain trên macOS không bị đụng tới (tool không bao giờ mở credential). Hàm
  lõi `remove_account` nhận hàm `trash` qua tham số để test không cần Thùng rác thật.

## Mở rộng: hạn mức gói (quota) cho từng tài khoản (2026-11)

Bản đầu cố ý không lấy % hạn mức vì phải đọc token. Người dùng yêu cầu rõ, sau khi được
nêu rủi ro, chọn dùng **cả hai nguồn**, đều tắt mặc định và bật theo từng tài khoản:

- **Status line (nguồn ưu tiên, `claude_quota.rs`).** Claude Code tự đưa `rate_limits`
  (`five_hour`/`seven_day`/`spend_limit`, `used_percentage` 0–100, `resets_at` là epoch
  **giây**) cho lệnh status line — đây là kênh Anthropic công bố. DevTool đặt một script
  `sh` làm status line của tài khoản: lưu stdin ra `.devtool-statusline.json` rồi chuyển
  stdin cho lệnh status line cũ (lưu nguyên vẹn để khôi phục). Ghi settings qua
  `write_config_file` (backup, rename nguyên tử, kiểm mtime). Đổi lại: số chỉ mới khi tài
  khoản có phiên đang chạy; serde_json không giữ thứ tự khoá nên settings.json có thể bị
  sắp xếp lại khoá khi bật/tắt. Windows: lệnh chạy qua `sh` — chưa kiểm chứng.
- **API (`/api/oauth/usage`, không công bố).** Token đọc trong Rust (Keychain qua
  `/usr/bin/security`, tên dịch vụ `Claude Code-credentials` hoặc `-<sha256(dir)[:8]>` —
  thử vài cách viết đường dẫn vì không biết giá trị `CLAUDE_CONFIG_DIR` thật; nơi khác đọc
  `.credentials.json`), không làm mới token hết hạn, không trả về JS. Gọi tối đa 5 phút/lần
  khi tab So sánh mở, lùi 15 phút khi bị 429. Rủi ro: API đổi/từ chối; có thể không hợp
  điều khoản gói cá nhân (đã nêu trong hộp xác nhận).
- **Sửa sau khi dùng thật (v1.9.5):** người dùng báo số lệch với `/usage` và đứng yên.
  Nguyên nhân tìm được trong code: script lưu bản đọc cạnh chính nó (`dirname "$0"`),
  mà các profile Orca có thể dùng chung một settings.json → mọi tài khoản chạy cùng một
  script và ghi đè chung một file. Giờ script ghi vào `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`
  (dựa trên giả định Claude Code truyền biến này cho lệnh status line — chưa kiểm chứng),
  và `refresh_script` cập nhật script cũ ở mỗi lần quét. Bản đọc cũ hơn 15 phút được đánh
  dấu; nguồn API ghi rõ token lấy từ mục Keychain nào để phát hiện đọc nhầm tài khoản.
  Tab So sánh bỏ bảng token cục bộ — người dùng chỉ cần so % hạn mức. Sau đó gộp hẳn vào
  bảng "Theo tài khoản" của tab Mức dùng: icon kiểu sóng hai SIM — hàng trên vạch đặc
  (5 giờ), hàng dưới vạch sọc (tuần), mỗi vạch 1/4 hạn mức, đảo được giữa đã dùng / còn
  lại — cạnh token và chi phí. Bỏ gợi ý "còn nhiều nhất": người dùng tự nhìn và chọn.
- **Hiển thị:** lấy bản đọc mới nhất giữa hai nguồn; cửa sổ đã qua `resets_at` coi là 0%.
  Không còn gợi ý tài khoản: thẻ giữ thứ tự tài khoản để vị trí không nhảy khi số đổi.

## Mở rộng: so sánh tài khoản và gán phiên dùng chung (2026-11)

- **Vấn đề:** bản trước gán mọi phiên dùng chung cho tài khoản đứng đầu danh sách. Với
  profile Orca liên kết `projects/` về `~/.claude`, mọi mức dùng dồn về "Default" và các
  profile Orca hiện 0 — tab So sánh sẽ sai đúng ở chỗ người dùng cần nó nhất.
- **Nguồn biết "ai chạy phiên nào":** transcript không ghi tài khoản. Có hai tín hiệu
  riêng theo từng thư mục cấu hình: (1) registry tiến trình `sessions/<pid>.json` khi
  phiên đang chạy, (2) `projects[*].lastSessionId` trong `.claude.json` của tài khoản đó.
  Rust trả về cả hai dưới dạng `claimed_sessions`, cùng `shared_session_ids` (phiên mà
  thư mục này có nhưng thư mục trước đã liệt kê).
- **Sổ ghi `sessionOwners`** (frontend, `sdk.storage`): mỗi lần quét cập nhật
  session id → profile theo các claim; claim sau ghi đè. Nhờ sổ được lưu, phiên đã thấy
  chạy dưới một tài khoản vẫn thuộc tài khoản đó sau khi tiến trình thoát. `attributeRows`
  gán `profileId` theo sổ; phiên dùng chung không có trong sổ → `SHARED_ACCOUNT`; còn
  lại → tài khoản của thư mục. `dirProfileId` luôn là thư mục chứa transcript, dùng để
  đọc transcript và tìm kiếm. Rust vẫn chỉ trả mỗi phiên một lần (dedup không đổi).
- **Giới hạn:** lịch sử trước khi có sổ chỉ gán được qua `lastSessionId` (mỗi dự án một
  phiên), nên cột "Dùng chung" có thể lớn lúc đầu và nhỏ dần khi tool được mở trong lúc
  làm việc. Tool đóng thì không ghi nhận được phiên chạy trong lúc đó.
- **Gợi ý tài khoản**: tài khoản (có thư mục tồn tại) dùng ít token nhất trong 5 giờ
  qua, hoà thì lấy tài khoản rảnh lâu nhất. Đây là số liệu cục bộ; hạn mức thật của gói
  vẫn không đọc (lý do ở mục trên).

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
