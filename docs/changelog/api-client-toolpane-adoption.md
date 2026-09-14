# Changelog: api-client-toolpane-adoption

## Chosen Proposal

Phương án 1 (khuyến nghị) — `RequestTabs.tsx`'s outer wrapper chuyển từ một `<div>` tự định nghĩa
`bg-bg-2/10` sang `<ToolToolbar>` dùng chung (`@/components/ui/tool-layout`), lấy `header-chrome`
(`bg-chrome` + `border-b border-line`) làm nền/viền thay vì tái định nghĩa riêng. Không thêm shadow,
không sửa `design/RULES.md`.

## Diagrams

Không cần — thay đổi 1 wrapper element, không đổi cấu trúc con bên trong.

## Why This Proposal

`bg-bg-2/10` (10% độ đục của một tông đã nhạt) hiệu quả là trong suốt — toolbar API Client chưa bao
giờ đọc ra như một thanh chrome thật, khác hẳn Sidebar và mọi tool khác trong app (đã dùng
`ToolToolbar`/`sidebar-chrome` từ trước). Phương án 2 (thêm shadow, sửa RULES.md) bị loại vì đây sẽ
là vết nứt đầu tiên trong luật "độ sâu chỉ từ viền, không shadow/gradient" đang tuyệt đối — Phương
án 1 đã đủ giải quyết đúng cảm giác "độ nổi" người dùng yêu cầu (qua ranh giới bậc tông `--chrome`
vs `--card` + viền) mà không cần đánh đổi đó.

Phát hiện thêm trong lúc triển khai: `IconButton` (dùng cho +New/Reveal/History/layout-toggle trong
toolbar) đã có sẵn phản hồi khi nhấn (`active:scale-90`) từ trước — AC-003 trong plan (đề xuất thêm
`.press`) hoá ra đã được thoả mãn sẵn, không cần sửa gì thêm cho phần đó.

## Final AC / DoD Status

| Item | Status | Notes |
|------|--------|-------|
| Toolbar là bề mặt `--chrome` đặc, viền dưới rõ | Met | Xác nhận qua ảnh chụp Playwright (dark mode) |
| Không reflow/không đổi khoảng cách các phần tử con | Met | Chỉ đổi wrapper + className, không đổi children |
| IconButton trong toolbar có phản hồi khi nhấn | Met | Đã có sẵn trong `IconButton`, không cần đổi |
| Không có shadow mới, không sửa RULES.md | Met | Đúng Phương án 1 |
| `rg 'bg-bg-2/10'` trong RequestTabs.tsx sạch (trừ comment lịch sử) | Met | Xác nhận |
| VI/EN, light/dark, resize cửa sổ | Met | Toolbar không có text nhãn hiển thị (chỉ icon+tooltip); dùng chung token `--chrome`/`--line` đã chứng minh đúng ở Sidebar |
| 622 test apiclient pass, `tsc` sạch | Met | |

## Remaining Risk

Không có. Thay đổi thuần CSS/wrapper, không đổi logic; đã xác nhận trực quan qua Playwright.

## Files Changed

- `src/components/tools/apiclient/RequestTabs.tsx` — outer wrapper `<div>` → `<ToolToolbar>`, import
  mới từ `@/components/ui/tool-layout`.
- `design/reference/ANALYSIS-COMPETITORS.md` (mới) — ảnh thật Hoppscotch/Insomnia/Thunder Client +
  ghi chú Requestly chỉ có ảnh trang tính năng, không phải UI thật.
- `docs/plans/api-client-toolpane-adoption.md` (mới) — 2 phương án + phương án đã chọn.
