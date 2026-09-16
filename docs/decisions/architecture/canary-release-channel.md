# Kênh phát hành canary — thử nghiệm kiến trúc mới song song với bản ổn định

**Trạng thái**: đã RETIRE. Kiến trúc Platform/Plugin đã qua canary
(`canary-v1.1.0-arch1`, GitHub Release `canary-latest`), được xác nhận ổn
định, và đã hợp nhất thẳng vào `main` (`v0.9.0` trở đi phát hành từ đó qua
`release.yml` như bình thường — không còn kênh song song). `release-canary.yml`
và `src-tauri/tauri.canary.conf.json` đã bị xoá khỏi repo; nội dung dưới đây
giữ lại làm tài liệu lịch sử cho cơ chế, không còn áp dụng.

## Vì sao

Chuyển sang kiến trúc Platform/Plugin (Tier B sidecar, cài plugin/sidecar từ
URL) là một breaking change lớn. Muốn phát hành cho một nhóm người dùng thử
nghiệm một thời gian, chạy song song với bản ổn định hiện có, trước khi quyết
định thay hẳn.

## Điểm chặn kỹ thuật cần giải quyết

`plugins.updater.endpoints` của Tauri trỏ tới
`releases/latest/download/latest.json` — `releases/latest` là alias GitHub tự
quản, luôn trỏ bản phát hành **mới nhất không phải prerelease trong cả repo**,
không phân biệt kênh. Nếu publish bản canary vào cùng chuỗi tag `v*` hiện tại,
mọi người dùng bản ổn định sẽ bị đề nghị cập nhật lên bản đang thử nghiệm.

## Cơ chế đã dựng

Ba lớp cách ly, không đụng gì tới `release.yml`/`tauri.conf.json` gốc:

1. **Tag pattern riêng**: `.github/workflows/release-canary.yml` kích hoạt bởi
   `canary-v*`, độc lập với trigger `v*` của `release.yml`.
2. **`identifier`/`productName` riêng**: `src-tauri/tauri.canary.conf.json`,
   hợp nhất đè lên `tauri.conf.json` gốc qua `tauri build --config <file>`
   (Tauri deep-merge JSON, chỉ ghi đè field có mặt trong override). App canary
   cài song song trên cùng máy với identifier khác
   (`com.desktop-devtool-app.canary`) — `app_data` (secrets/store/
   plugin-data/service-data) tách biệt hoàn toàn với bản ổn định.
3. **Endpoint updater riêng**, trỏ vào một tag GitHub Release CỐ ĐỊNH
   (`canary-latest`) thay vì alias `/latest/`. Tag này bị xoá và tạo lại mỗi
   lần workflow chạy (rolling release) — lịch sử thật nằm ở git tag
   `canary-vX.Y.Z` đã push, không phụ thuộc GitHub Release còn giữ hay không.

`release-canary.yml` có một job riêng (`reset-canary-release`) chạy TRƯỚC
matrix ba nền tảng để xoá `canary-latest` — nếu để mỗi job matrix tự xoá, ba
job chạy song song sẽ giẫm lên nhau (job A xoá đúng lúc job B đang upload).

`TAURI_SIGNING_PRIVATE_KEY` dùng chung với kênh ổn định — cùng một nhà phát
hành, không cần khoá riêng.

## Cách phát hành một bản canary

```bash
git tag canary-v1.2.0-arch2
git push origin canary-v1.2.0-arch2
```

Workflow tự build 3 nền tảng, publish vào GitHub Release tag `canary-latest`
(prerelease), người dùng đã cài "DevTool Canary" tự nhận được bản này qua
updater riêng của họ.

## Khi quyết định thay hẳn bản ổn định

Đổi trigger tag của `release.yml` (hoặc trỏ nó sang nhánh/kiến trúc mới),
không cần viết lại cơ chế — `release-canary.yml` có thể xoá hoặc giữ lại cho
lần thử nghiệm tiếp theo.

## Chưa làm (ngoài phạm vi lúc dựng cơ chế)

- Icon riêng cho bản canary (hiện dùng chung bộ icon với bản ổn định, chỉ khác
  tên/identifier) — cân nhắc nếu muốn phân biệt rõ hơn trong Dock/Taskbar.
- Chạy thử thật một lần phát hành canary để xác nhận `tauri-action` xử lý
  đúng việc 3 job matrix cùng ghi vào một tag `canary-latest` sau khi job reset
  chạy xong (logic dựa trên cùng pattern `release.yml` đã dùng thành công cho
  3 job cùng ghi vào MỘT tag thật, nhưng chưa tự tay xác nhận với tag rolling).
