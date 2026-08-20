# Redis tool — Pub/Sub dùng registry thay vì kết nối tạm thời

## Phương án đã chọn

`redis_tool.rs` vốn có invariant: mọi command mở một `MultiplexedConnection` mới, chạy xong là
đóng — không có pool/registry sống lâu (khác với `rabbit.rs`/`kafka.rs` vốn có consumer sống
qua nhiều lần gọi lệnh). Tính năng Pub/Sub phá invariant này một cách có chủ đích: `SUBSCRIBE`
là một hành động buộc phải giữ kết nối sống để tiếp tục nhận message sau khi command ban đầu đã
trả về — không thể "mở rồi đóng ngay" như các command khác.

Giải pháp: thêm `PubSubRegistry` (`Arc<Mutex<HashMap<String, Arc<Notify>>>>`), giống hệt pattern
`ConsumerRegistry` đã có sẵn trong `rabbit.rs` (và tương tự bên `kafka.rs`) — `redis_pubsub_
subscribe` mở một `client.get_async_pubsub()` riêng (không qua `connect()`/`MultiplexedConnection`
dùng chung cho các command khác), subscribe xong thì `tokio::spawn` một task chạy vòng lặp
`tokio::select!` giữa `notify.notified()` (tín hiệu dừng) và `stream.next()` (message mới), đẩy
từng message qua Tauri `Channel<PubSubMessage>` về frontend. `redis_pubsub_unsubscribe` chỉ
`notify_one()` — task tự dọn registry khi thoát vòng lặp.

Ở frontend, khác với `consumerStore.ts` (Kafka/RabbitMQ) — vốn là module-scope store để consumer
sống qua nhiều lần chuyển tab trong tool — `PubSubView.tsx` cố tình **không** làm vậy: subscription
sống trong chính component (`useRef` giữ subscription id), dừng khi component unmount (chuyển
sang view khác trong Redis tool). Đây là lựa chọn phạm vi có chủ đích, không phải thiếu sót.

## Lý do

- Pub/Sub trong tool này là công cụ debug nhanh ("xem thử channel X có message gì"), không phải
  một live monitor cần chạy nền lâu dài như Kafka consumer hay RabbitMQ queue consumer — người
  dùng thường subscribe, xem vài message, rồi rời view. Giữ subscription sống khi rời view sẽ
  yêu cầu thêm một module-scope store + UI hiển thị "N subscription đang chạy ngầm" mà use case
  hiện tại chưa cần tới.
- Redis Pub/Sub không có khái niệm "db" (channel là global toàn server, không như key namespace
  theo `SELECT db`), nên `redis_pubsub_subscribe`/`redis_publish` không nhận tham số `db` — khác
  với hầu hết command khác trong file.
- Dùng `client.get_async_pubsub()` (kết nối RESP2 pubsub riêng) thay vì `MultiplexedConnection`
  dùng chung, vì một khi subscribe, kết nối đó không còn chạy được command thường nữa (theo thiết
  kế của `redis` crate bản 1.x) — không thể tái sử dụng connection helper `connect()` sẵn có.

## Rủi ro / follow-up

- Nếu sau này cần Pub/Sub sống qua nhiều lần chuyển tab (vd. muốn vừa xem Keys vừa để Pub/Sub
  chạy nền), refactor theo đúng pattern `consumerStore.ts`: chuyển state ra module-scope, thêm
  `useSyncExternalStore` hook, và gọi `stop`/`stopAll` ở nơi tool unmount hẳn (như
  `RedisClient`/`KafkaExplorer` đã làm với consumer của chúng).
- `CONNECT_TIMEOUT` (6s) áp dụng cho bước mở pubsub connection giống các command khác, nhưng
  không áp dụng timeout cho vòng đời sau đó — một subscription "treo" (server ngừng gửi message
  nhưng không đóng kết nối) sẽ không tự dừng cho tới khi người dùng bấm Stop hoặc rời view.
