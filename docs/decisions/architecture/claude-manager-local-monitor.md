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
