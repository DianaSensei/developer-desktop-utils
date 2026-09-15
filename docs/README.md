# DevTool — bản đồ tài liệu

Chỉ mục cho toàn bộ `docs/`. Mỗi thư mục con phục vụ MỘT loại người đọc/mục
đích — đọc mục dưới đây để biết bắt đầu từ đâu thay vì lục từng file.

| Bạn là ai / cần gì | Bắt đầu từ |
|---|---|
| Người dùng DevTool, muốn biết mỗi tool làm gì, dữ liệu đi đâu | [`human/TOOLS.md`](./human/TOOLS.md) |
| Muốn build/chạy DevTool từ source | [`human/SETUP.md`](./human/SETUP.md) |
| Muốn đóng góp code, thêm một tool built-in mới | [`human/CONTRIBUTING.md`](./human/CONTRIBUTING.md) |
| Muốn dùng DevTool qua MCP (Claude Desktop/Code) | [`human/mcp-server.md`](./human/mcp-server.md) |
| **Muốn viết một plugin MỚI** (cài qua URL hoặc built-in) | [`plugin-sdk/README.md`](./plugin-sdk/README.md) |
| AI agent / người bảo trì chính app này | [`ai/CLAUDE.md`](./ai/CLAUDE.md) |
| Muốn hiểu vì sao một quyết định kiến trúc/UI được chọn | [`decisions/`](#decisions--adr) |
| Muốn xem cái gì đã thay đổi và tại sao (sau khi merge) | [`changelog/`](./changelog/) |
| Điều tra một bug đã xảy ra thật, muốn biết nguyên nhân gốc | [`postmortems/`](./postmortems/) |
| Tránh lặp lại một lỗi kỹ thuật đã gặp | [`knowledge/experience-log.md`](./knowledge/experience-log.md) |
| Xem một tính năng đang được thiết kế (chưa/đang triển khai) | [`plans/`](./plans/) |
| Token màu sắc, spacing, component dùng chung | [`design/DESIGN-SYSTEM.md`](./design/DESIGN-SYSTEM.md) (và `design/RULES.md`/`design/TOKENS.md` ở gốc repo, ngoài `docs/`) |

## Cấu trúc

```
docs/
├── ai/CLAUDE.md            — nguồn sự thật cho AI agent làm việc TRÊN chính app này
├── human/                  — hướng dẫn cho người: setup, đóng góp, MCP, per-tool
├── plugin-sdk/             — tài liệu THAM KHẢO cho việc viết một plugin mới
├── design/DESIGN-SYSTEM.md — ghi chú thiết kế đặc thù app (xem thêm design/ ở gốc repo)
├── decisions/              — Architecture Decision Record (ADR): PHƯƠNG ÁN đã chọn + LÝ DO
│   ├── architecture/       — quyết định hệ thống/backend/dữ liệu
│   └── ui/                 — quyết định giao diện/tương tác thuần tuý
├── changelog/               — CÁI GÌ đã đổi (ghi lại SAU KHI làm xong, đối chiếu plan)
├── plans/                   — phương án ĐANG/SẮP triển khai (ghi TRƯỚC khi làm, cập nhật khi chọn xong)
├── postmortems/              — điều tra bug/sự cố THẬT đã xảy ra, nguyên nhân gốc
└── knowledge/experience-log.md — nhật ký kỹ thuật tích luỹ, một dòng cho mỗi bài học
```

## Phân biệt bốn loại tài liệu dễ nhầm

Đây là nguồn nhầm lẫn phổ biến nhất khi thêm tài liệu mới — đọc kỹ trước khi
quyết định một ghi chú mới thuộc thư mục nào:

| Loại | Viết KHI NÀO | Trả lời câu hỏi |
|---|---|---|
| **`decisions/`** (ADR) | Trước hoặc ngay khi triển khai một quyết định có tính lâu dài | "Tại sao chọn cách này, không phải cách khác?" |
| **`plans/`** | Trước khi triển khai, khi có nhiều phương án cần cân nhắc | "Đang định làm gì, phương án nào đang xét?" |
| **`changelog/`** | Ngay sau khi một tính năng/thay đổi lớn hoàn thành | "Vừa xong cái gì, kết quả ra sao?" |
| **`postmortems/`** | Sau khi một BUG THẬT đã xảy ra và được tìm ra nguyên nhân | "Bug này từ đâu ra, sao lọt qua được test?" |

`plans/` và `changelog/` thường đi theo cặp cho cùng một tính năng (ví dụ
`native-sidecar-install.md` có mặt ở cả hai) — `plans/` đóng băng lúc quyết
định phương án, `changelog/` ghi lại điều thực sự xảy ra lúc code xong (có
thể lệch so với plan ban đầu).

## `decisions/architecture/` vs `decisions/ui/`

- **`architecture/`**: ảnh hưởng cấu trúc hệ thống, mô hình dữ liệu, hiệu
  năng, hoặc backend — ví dụ `platform-plugin-architecture.md`,
  `canary-release-channel.md`, `runner-large-data-runs.md`.
- **`ui/`**: thuần về hình thức hiển thị/tương tác, không đổi cấu trúc dữ
  liệu hay backend — ví dụ `font-preference.md`, `corner-style-preference.md`,
  `dialog-size-scale.md`.

Ranh giới không tuyệt đối 100% (một vài quyết định UI có chạm nhẹ tới data
model) — xếp theo TÁC ĐỘNG CHÍNH của quyết định, không phải mọi chi tiết nó
đề cập.
