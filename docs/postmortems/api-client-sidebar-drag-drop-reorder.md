# Postmortem: API Client sidebar drag/drop reorder không hoạt động quanh folder - 2026-09-13

## Time Discovered

2026-09-13, báo cáo trực tiếp từ người dùng kèm ảnh chụp màn hình danh sách Containers/Sidebar.

## Timeline of Events

- Người dùng báo: "tính năng drag/drop request/folder để sắp xếp không hoạt động".
- `workflow-router` phân loại đây là bug-fix (hành vi hiện tại sai, không phải tính năng mới).
- Đọc `Sidebar.tsx` (component kéo thả) và `store.ts` (`moveItem`/`copyItem`, `insertRelative`)
  để xác định nguyên nhân trước khi hỏi thêm người dùng.
- Phát hiện: `onDragOver` ép `where = 'inside'` bất cứ khi nào hover lên row `container`
  (folder/collection) — không có phân vùng theo vị trí con trỏ như row request.
- Trình bày hướng sửa qua `AskUserQuestion` (checkpoint bắt buộc) — người dùng đồng ý phương án
  chia 3 vùng (trước/trong/sau) kiểu VS Code Explorer.
- Sửa `onDragOver`, viết 3 test kéo-thả thật qua DOM (`Sidebar.test.tsx`), xác nhận bằng
  `git stash` rằng test thất bại trên code cũ và pass trên code mới.
- Chạy toàn bộ test suite (1240 test, 101 file) + `tsc --noEmit` — sạch.

## Initial Symptoms

Kéo một request hoặc folder trong sidebar API Client để sắp xếp lại vị trí không cho kết quả
như mong đợi khi thả gần một folder khác — vật thể luôn bị nhét vào trong folder đó thay vì
đứng cạnh nó như một sibling.

## Root Cause

`Row`'s `onDragOver` handler trong `Sidebar.tsx`:

```ts
let where: DropTarget['where'] = 'after';
if (container) where = 'inside';
else { const r = e.currentTarget.getBoundingClientRect(); where = e.clientY < r.top + r.height / 2 ? 'before' : 'after'; }
```

Khi hover lên một row `container` (folder hoặc collection), `where` luôn bị ép thành `'inside'`
bất kể vị trí con trỏ trên row — không hề có logic chia vùng như nhánh `else` (request) đã có
cho `before`/`after`. `store.moveItem`/`copyItem` (qua `insertRelative`) đã hỗ trợ sẵn
`before`/`after` với `targetId` là một folder — chỉ UI chưa bao giờ tạo ra được lựa chọn đó.

## Impact

Người dùng không thể sắp xếp thứ tự request/folder trong sidebar bất cứ khi nào một folder nằm
kề bên vị trí muốn thả tới — tức phần lớn các collection có tổ chức bằng folder. Không mất dữ
liệu (thao tác chỉ đơn giản là im lặng làm sai việc: nhét vào trong thay vì đặt cạnh), nhưng
tính năng sắp xếp coi như không dùng được trong các trường hợp phổ biến nhất.

## How It Was Found/Reproduced

Đọc trực tiếp `onDragOver` trong `Sidebar.tsx` và đối chiếu với `moveItem`/`insertRelative` trong
`store.ts`: xác nhận tầng store hỗ trợ đầy đủ `before`/`after` với target là folder, nên lỗi chỉ
có thể nằm ở UI không bao giờ SINH ra giá trị `where` đó cho một target dạng container. Xác nhận
lại bằng test DOM thật (kéo-thả qua `fireEvent`/`createEvent`), chứng minh test mới FAIL trên
code cũ (`git stash`) và PASS trên code đã sửa.

## The Fix

Chia row của **folder** (không áp dụng cho **collection**) thành 3 vùng dọc theo vị trí con trỏ
tương đối trong row, giống VS Code Explorer:

```ts
if (container && depth > 0) {
  const offset = (e.clientY - r.top) / r.height;
  where = offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside';
} else if (container) {
  where = 'inside'; // collection: xem lý do loại trừ bên dưới
} else {
  where = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}
```

Collection (`depth === 0`) bị loại trừ có chủ đích: `moveItem`/`copyItem` luôn append thẳng vào
collection bất kể `where` khi target là một collection id (một collection không bao giờ nằm
trong `items[]` của ai để mà sắp xếp trước/sau nó) — cho row collection một chỉ báo before/after
sẽ hiển thị sai về việc thả thực sự làm gì.

## Tests Added to Prevent Recurrence

`src/components/tools/apiclient/Sidebar.test.tsx` (mới) — 3 test kéo-thả qua DOM thật (không gọi
thẳng store):
- Thả ở góc trên (25% đầu) của một folder → item đứng NGAY TRƯỚC folder đó.
- Thả ở góc dưới (25% cuối) → item đứng NGAY SAU folder đó.
- Thả ở vùng giữa → item vẫn được nhét VÀO TRONG folder đó (hành vi cũ, không đổi).

Đã xác nhận cả 3 test FAIL trên code cũ (`git stash` tạm bỏ fix) và PASS sau khi phục hồi fix.

## Lessons / Prevention Recommendations

- Khi một UI kéo-thả rẽ nhánh theo LOẠI target (container vs. leaf) bằng một if/else ép cứng
  MỘT giá trị cho cả nhánh, luôn kiểm tra xem nhánh đó có đang bỏ sót một chế độ tương tác hợp lệ
  mà tầng dưới (ở đây: `store.moveItem`) đã hỗ trợ sẵn hay không — bug loại này nằm hoàn toàn ở
  UI, không phải ở business logic, nên đọc kỹ handler UI trước khi nghi ngờ store.
- jsdom không implement `DragEvent` (chỉ có `Event` chung) và không có `scrollIntoView` — test
  kéo-thả phải tự dựng event qua `createEvent` của `@testing-library/dom` rồi gán tay
  `clientY`/`altKey` sau khi tạo (constructor `Event` bỏ qua các field này một cách im lặng,
  không báo lỗi), và polyfill `Element.prototype.scrollIntoView` trước khi render bất cứ thứ gì
  có row đang active trong cây này.
