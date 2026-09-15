# DevTool Plugin SDK — tài liệu cho tác giả plugin

Bộ tài liệu này dành cho người viết một plugin MỚI cho DevTool — không phải
người bảo trì chính app (xem `docs/ai/CLAUDE.md` cho việc đó) hay người muốn
hiểu lý do kiến trúc được chọn (xem `docs/decisions/platform-plugin-architecture.md`
và `docs/decisions/canary-release-channel.md` cho các quyết định + đánh đổi
đầy đủ). Ở đây là tài liệu THAM KHẢO thực dụng: bạn cần gì để viết, đóng gói
và phát hành một plugin.

## Đọc theo thứ tự nào

1. **[01-architecture.md](./01-architecture.md)** — Platform là gì, Plugin là
   gì, ba tier (A/B/C), ranh giới tin cậy nằm ở đâu. Đọc trước tất cả — mọi
   quyết định thiết kế khác đều xuất phát từ đây.
2. **[02-manifest.md](./02-manifest.md)** — `definePlugin()`, từng field của
   `PluginManifest`, bảng quyền, luật validate.
3. **[03-sdk-reference.md](./03-sdk-reference.md)** — toàn bộ bề mặt
   `sdk.*` mà code trong component của bạn được gọi.
4. **[04-tier-b-sidecars.md](./04-tier-b-sidecars.md)** — nếu plugin cần
   chạm socket thô, filesystem nặng, hay một SDK ngôn ngữ khác — cách viết
   một sidecar (tiến trình Rust riêng) nói JSONL với host.
5. **[05-external-install.md](./05-external-install.md)** — đóng gói và host
   plugin/sidecar để cài qua URL, không cần compile vào app.
6. **[06-testing.md](./06-testing.md)** — quy ước test cho cả hai tier.

## Bắt đầu nhanh — plugin nhỏ nhất có thể chạy

```ts
// src/plugins/hello/plugin.ts
import { Puzzle } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'hello',
  label: 'Hello',
  icon: Puzzle,
  description: 'Plugin ví dụ tối giản.',
  route: '/hello',
  order: 999,
  defaultEnabled: true,
  sdk: '^1.0.0',
  load: () => import('./HelloView').then((m) => m.HelloView),
});
```

```tsx
// src/plugins/hello/HelloView.tsx
export function HelloView() {
  return <div className="p-6">👋 Hello</div>;
}
```

Platform tự quét `src/plugins/*/plugin.ts` (`import.meta.glob`) — không có
bảng đăng ký tay nào cần sửa. Plugin này chưa khai `permissions` nào, nên nó
chưa gọi được gì ra ngoài chính nó; xem 02/03 để thêm khả năng thật.

## Nguyên tắc xuyên suốt cả bộ tài liệu

- **Một cửa duy nhất**: mọi thứ plugin cần import đều đi qua `@/platform`.
  Không import thẳng `@tauri-apps/*` trong code plugin — đó là thứ
  `guard.test.ts` khoá về 0 cho toàn bộ plugin hiện có, và lý do được giải
  thích ở 01-architecture.md.
- **Quyền phải đi kèm allowlist cụ thể**, không phải cờ bật/tắt suông:
  `native` luôn kèm `commands`, `http` luôn kèm `hosts`, `service` luôn kèm
  `service.methods`. `validateManifest()` từ chối cả chiều thiếu lẫn chiều
  thừa.
- **Không có sandbox chống mã độc.** Toàn bộ plugin hiện do cùng một người
  phát hành. Quyền ở đây phục vụ ba việc có giá trị thật: hiện cho người
  dùng thấy plugin chạm vào gì, bắt lỗi sớm khi gọi nhầm kênh chưa khai, và
  cho nhật ký audit một nhãn để ghi. Đừng thiết kế plugin của bạn theo kiểu
  "phòng thủ chống chính tác giả" — không cần thiết.
