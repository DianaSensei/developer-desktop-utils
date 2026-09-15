# Testing — quy ước cho plugin

## Tier A — test component/hook qua SDK giả lập

Không test bằng cách mock từng hàm `@tauri-apps/*` — mock thẳng `sdk.service`/
`sdk.native`/... ở BIÊN mà code của bạn thực sự gọi. Platform's chính nó
(`service.test.ts`, `sdk.test.ts`) đã cover phần kiểm quyền/audit bên trong
`createPluginSdk`/`createPluginService` — test của plugin không cần lặp lại
việc đó, chỉ cần assert code của MÌNH gọi đúng method/tham số.

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PluginSdk } from '@/platform';
import { createMyToolApi } from './types';

function makeSdk(overrides: { call?: ReturnType<typeof vi.fn> } = {}) {
  const call = overrides.call ?? vi.fn().mockResolvedValue(undefined);
  const sdk = { service: { call } } as unknown as PluginSdk;
  return { sdk, call };
}

it('listConfigs gọi đúng method JSONL', async () => {
  const { sdk, call } = makeSdk();
  const api = createMyToolApi(sdk);
  await api.listConfigs();
  expect(call).toHaveBeenCalledWith('list-configs', undefined);
});
```

### Test một điểm thắt (seam) duy nhất

Nếu tool của bạn có một hàm `create<X>Api(sdk)` gom mọi lời gọi (khuyến
nghị — xem cách `createRedisApi`/`createContainerApi`/`createRabbitApi`
làm), test TOÀN BỘ mapping method ở một file `types.test.ts`. Đây là cách
rẻ nhất để bắt lỗi gõ sai tên method JSONL — sai một ký tự trong tên
method là lỗi RUNTIME (bị `service.methods` allowlist chặn), không phải
lỗi TypeScript.

### Test method stream

Mock `sdk.service.stream` để gọi `onMessage` NGAY BÊN TRONG
`mockImplementation`, trước khi resolve promise — điều này mô phỏng đúng
hành vi thật: `sdk.service.stream()`'s implementation gắn `channel.onmessage`
TRƯỚC khi gọi `invoke()`, nên một sự kiện có thể tới trước khi promise
`stream()` bên ngoài settle.

```ts
function streamThatEmitsSubscribed(hostStop = vi.fn().mockResolvedValue(undefined)) {
  let emit: ((event: unknown) => void) | undefined;
  const stream = vi.fn().mockImplementation((_method, onMessage) => {
    emit = onMessage;
    onMessage({ type: 'subscribed', subscriptionId: 'sub-1' });
    return Promise.resolve({ stop: hostStop });
  });
  return { stream, hostStop, emit: (e: unknown) => emit!(e) };
}
```

Nếu API của bạn đợi `"subscribed"`/`"error"` trước khi resolve (khuyến
nghị — xem 04-tier-b-sidecars.md), viết test cho CẢ HAI nhánh:

- `await api.watchStart(...)` resolve đúng khi mock emit `"subscribed"`.
- `await api.watchStart(...)` reject đúng message khi mock emit
  `"error"`, VÀ `hostStop` được gọi (dọn đăng ký host, không để lại stream
  mồ côi).

## Tier B (sidecar Rust) — ba lớp test

### 1. Test đơn vị thuần

Cho logic không chạm mạng: parse tham số, validate, build URL/connection
string. Không cần mock gì — gọi hàm trực tiếp.

```rust
#[test]
fn thieu_tham_so_bat_buoc_tra_ve_loi_ro_rang() {
    let res = handle("overview", serde_json::json!({}));
    assert!(res.unwrap_err().contains("configId"));
}
```

Mang theo NGUYÊN VẸN mọi test thuần đã có ở code Tier A cũ nếu bạn đang
port một tool có sẵn — chúng chính là bằng chứng hành vi không đổi.

### 2. Test qua binary giả (`sh`/`cat`) — chỉ dùng cho logic điều phối của
   HOST (`service_host.rs`), không phải cho sidecar của bạn

Không áp dụng khi viết MỘT sidecar mới — chỉ liên quan nếu bạn sửa
`service_host.rs` (hiếm, và cần cân nhắc kỹ vì đó là hàm biên giới tin cậy
dùng chung cho mọi sidecar).

### 3. Test bằng BINARY THẬT — bắt buộc cho hành vi giao thức

```rust
// src-tauri/tests/my_sidecar.rs — PHẢI là integration test (thư mục
// tests/), KHÔNG PHẢI #[cfg(test)] trong src/ — CARGO_BIN_EXE_<ten> chỉ
// được Cargo set cho integration test.

fn spawn() -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_devtool-svc-mytool"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn devtool-svc-mytool")
}

#[test]
fn ping_tra_ve_pong() {
    let mut child = spawn();
    let res = round_trip(&mut child, &json!({
        "protocol": 1, "id": "1", "method": "ping", "params": null
    })).expect("phải có phản hồi");
    assert_eq!(res["result"], "pong");
    let _ = child.kill();
}
```

Test tối thiểu nên có: method hợp lệ trả đúng kết quả, method lạ trả lỗi
KHÔNG panic sidecar, JSON hỏng không làm sidecar chết (vẫn trả lời được
request tiếp theo), lệch `protocol` bị từ chối, đóng stdin thì sidecar tự
thoát (mô phỏng cách host dọn tiến trình khi app tắt).

### 4. Xác nhận thủ công bằng server/daemon thật — KHÔNG thể bỏ qua

Test tự động (kể cả binary thật) không thay thế được việc chạm một server
thật cho code có logic mạng. Dùng container Docker tạm, TỰ TẠO và TỰ
DỌN sau khi xong:

```bash
docker run -d --rm --name my-test-db -p 16399:5432 postgres:16-alpine
# ... viết một script JSONL nhỏ, gửi request qua stdin, đọc response từ stdout ...
docker stop my-test-db   # --rm đã tự xoá container khi stop
```

Đừng dừng/xoá container KHÔNG PHẢI do bạn tạo (kiểm `docker ps -a` trước
khi chạy `docker run --name` — nếu tên trùng với container có sẵn của
người dùng, đổi tên khác, không ép ghi đè).

## Checklist trước khi coi một plugin "xong"

- [ ] `npx tsc --noEmit` sạch.
- [ ] `npx vitest run` — mọi test hiện có VÀ test mới đều xanh.
- [ ] (Tier B) `cargo build` + `cargo test` toàn workspace xanh — không chỉ
      riêng sidecar mới, để chắc không phá gì có sẵn.
- [ ] (Tier B) Xác nhận bằng server/daemon thật cho MỌI method chạm mạng,
      không chỉ đọc mà cả ghi (an toàn nếu dùng resource tự tạo).
- [ ] `npm run build` thành công.
- [ ] Nếu port từ tool có sẵn: đối chiếu tay số lượng và tên method JSONL
      với `service.methods` trong `plugin.ts` — lệch tên là lỗi runtime âm
      thầm (bị allowlist chặn), không phải lỗi compile-time.
