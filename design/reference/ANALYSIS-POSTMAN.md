# Nguồn 5 · Postman — 4 ảnh, đánh giá riêng cho API Client

> Khác bốn đợt trước (đọc DBX — sản phẩm, website, mã nguồn, trang Settings), đợt này là
> Postman, và phạm vi hẹp hơn: đánh giá style + khả năng áp dụng cho **API Client** của
> DevTool cụ thể, không phải toàn bộ hệ thiết kế. Vì vậy tách file riêng thay vì gộp vào
> `ANALYSIS-DBX.md`.

## Kết luận trước khi vào chi tiết

`AddressBar.tsx` của DevTool đã tự ghi ngay trong comment: *"It spans the full width...
(Bruno layout)"* — API Client được thiết kế **có chủ đích mô phỏng đúng lớp công cụ này**
(Postman/Bruno/Insomnia) ngay từ đầu, không phải phát hiện ra hôm nay. Nên khác với DBX
(một nguồn phần lớn CHƯA được đối chiếu), đợt này phần lớn là **xác nhận lại**, không phải
tìm ra cái mới — và đó là kết quả đáng tin, không phải qua loa: mỗi khoản dưới đây đối
chiếu trực tiếp với file thật, không đoán từ ảnh.

## Đã có, tương đương hoặc tốt hơn — không lấy

| Postman | DevTool | Bằng chứng |
|---|---|---|
| Tab mở nhiều request, tô màu method trước tên | Đã có | `RequestTabs.tsx` — `methodColor`/`methodShort` |
| Bulk Edit + checkbox bật/tắt từng dòng param/header | Đã có | `KeyValueEditor.tsx` |
| History nhóm theo ngày | **Tốt hơn** | `HistoryView.tsx` có "Today"/"Yesterday", Postman chỉ ghi ngày tháng trần |
| Tô `{{variable}}` trong URL | **Tốt hơn** | `InlineCodeField` — xanh khi biết, ĐỎ khi lạ, có autocomplete; ảnh Postman chỉ một màu, không phân biệt biết/lạ |
| Auth/header kế thừa theo cây folder/collection | Đã có | `NodeSettingsDialog.tsx`, `inheritAuth()` trong `Sidebar.tsx` — dạng dialog thay vì trang riêng, cùng khả năng |
| Empty state của Response panel khi chưa gửi gì | **Tốt hơn** | Splash dạy **7 phím tắt** (`ResponsePanel.tsx` biến `blank`) — Postman chỉ có 3 link gợi ý tính năng chung chung |

Dòng cuối đáng nói riêng vì suýt kết luận sai: nhìn thấy `ResponsePanel.tsx` có một dòng
chữ đơn "No response — see the Tests and Console tabs for what ran." và ban đầu tưởng đây
là empty-state chính, định làm phong phú thêm theo mẫu Postman. Đọc kỹ hơn thì dòng đó chỉ
render ở một NHÁNH PHỤ hẹp (`!blank` — đã có test/log chạy nhưng chưa có response body, ví
dụ script tiền-request báo lỗi trước khi gửi). Nhánh CHÍNH (`blank && !sending` — chưa làm
gì cả) đã có splash phím tắt từ trước, không cần sửa. Bài học: đọc hết các nhánh điều kiện
trước khi kết luận "thiếu", một dòng chữ đơn giản có thể chỉ là ca phụ, không phải toàn bộ
câu chuyện.

## Cố ý KHÁC — không phải thiếu sót

**Chấm "chưa lưu" trên tab.** Postman hiện chấm cam ở tab có thay đổi chưa lưu (Register,
Verify Reg, `{{users-app}}` trong ảnh). DevTool không có khái niệm này vì **không có bước
Save tách rời** — mọi chỉnh sửa ghi thẳng vào store ngay lập tức. Postman cần Save vì đồng
bộ lên cloud/team workspace; DevTool chạy hoàn toàn cục bộ nên autosave tức thời hợp lý
hơn, không phải phiên bản thiếu tính năng của mô hình Postman.

**Thanh top-bar Invite/Upgrade/notification.** Chrome của sản phẩm SaaS nhiều người dùng —
không áp dụng cho app desktop một người.

## Thật sự thiếu — nhưng KHÔNG phải việc nhỏ

**Cột "Description" cho Params/Headers.** Ảnh 1–2 cho thấy Postman có cột mô tả riêng cho
mỗi key (bên cạnh Value). DevTool's `KeyValueEditor` chỉ có Name/Value/Resolved — không có
chỗ ghi chú "vì sao param này tồn tại". Giá trị thật: một request có 26 header (như ảnh 2)
mà nửa năm sau quay lại không nhớ `x-api-request-id` để làm gì.

**Vì sao chưa làm ngay, khác các mục trên:** đây không phải một dòng CSS mà là thay đổi
MÔ HÌNH DỮ LIỆU — `KeyValue` cần thêm field `description`, kéo theo:
- Cập nhật type + mọi nơi tạo/đọc `KeyValue` (params, headers, url-encoded body, MultipartEditor).
- Đường import/export: cURL parser, Postman collection import/export, có giữ được mô tả không.
- UI: thêm một cột vào bảng vốn đã 4-5 cột (`w-8 | Name | Value | Resolved | actions`) — cột
  Description dài, cần quyết định co giãn thế nào trên bảng đã chật.

Effort này khác hẳn quy mô các đợt sửa trong ngày (đổi class, thêm token, viết lại một
component UI) — cần bạn xác nhận có muốn làm không trước khi động vào, không tự ý mở rộng.

---

## Một câu rút gọn

Không phải mọi nguồn tham khảo đều sinh ra việc phải làm — đối chiếu cẩn thận với code
thật có khi kết luận đúng là "đã có, đã tốt hơn, không đụng vào", và đó vẫn là công việc
có giá trị: nó xác nhận các quyết định trước đó đúng, thay vì để ngỏ nghi ngờ.
