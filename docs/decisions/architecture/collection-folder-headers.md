# Collection / Folder Headers (Bruno-style)

## Phương án đã chọn

Thêm **`headers?: KeyValue[]`** vào cả `Collection` và `Folder` (`types.ts`), áp dụng cho
**mọi request nằm trong** collection/folder đó — song song với cơ chế đã có sẵn cho
pre/post-request script và auth kế thừa (`Collection.script`/`auth`, `Folder.script`/`auth`).

Thứ tự ưu tiên khi build header thực gửi đi (`request.ts`'s `buildHeaders`), so khớp tên
**không phân biệt hoa/thường** (đúng ngữ nghĩa HTTP header):

```
collection headers  <  folder headers (ngoài → trong, nếu có nhiều cấp folder)  <  request's own headers  <  auth header (Bearer/Basic/API key)  <  Content-Type mặc định theo body
```

Một header cùng tên ở tầng trong (gần request hơn) ghi đè tầng ngoài — request luôn có tiếng
nói cuối cùng, giống Bruno.

Đường đi dữ liệu:
- `store.ts`'s `collectInherited()` — vốn đã đi bộ cây collection→folder để gom `pre`/`post`
  script và `auth` gần nhất — nay gom thêm `headers: KeyValue[][]`, giữ đúng thứ tự **ngoài →
  trong** (collection trước, folder sau) để `buildHeaders` áp theo đúng thứ tự ưu tiên ở trên.
- `engine.ts`'s `executeRequest` truyền `inherited.headers` xuống `sendRequest`.
- `request.ts`'s `buildHeaders` nhận thêm `inheritedHeaders: KeyValue[][]`, dùng 1 map
  `lowercase key → key gốc đã dùng` để việc ghi đè theo tên không phân biệt hoa/thường không để
  sót lại header trùng tên khác cách viết hoa (ví dụ folder đặt `Content-Type`, request đặt lại
  `content-type` — chỉ 1 header được gửi, giá trị của request thắng).
- **Generate Code** (`resolveRequest`/`generateCode`/`GenerateCodeDialog`) cũng nhận
  `inheritedHeaders` — nếu không, snippet sinh ra sẽ thiếu header cấp collection/folder mà Send
  thực tế vẫn gửi, gây lệch giữa preview và hành vi thật.

UI: `NodeSettingsDialog.tsx` (dialog "Collection/Folder settings…") có thêm tab **Headers**
cạnh Scripts/Auth, dùng lại `KeyValueEditor` y hệt cách sửa header của 1 request. `store.ts`
thêm `setNodeHeaders(collectionId, nodeId, headers)` theo đúng khuôn của `setNodeScript`/
`setNodeAuth` (nodeId `null` = collection, có id = folder).

## Lý do

- **Vì sao đặt header ở đây thay vì chỉ dùng Collection Variables + `{{var}}` trong header của
  từng request**: Collection Variables (đã có) giải quyết "giá trị dùng chung", không giải
  quyết "header nào tự động có mặt trên mọi request" — Bruno tách 2 khái niệm này (Vars tab vs
  Headers tab ở cấp collection/folder) vì nhiều header (auth header dùng riêng, tracing header,
  API version…) cần **tự động xuất hiện** trên mọi request mới thêm vào, không phải người dùng
  tự gõ lại `{{...}}` trong header list của từng request.
- **Vì sao request luôn thắng, không phải ngược lại**: khớp mọi client tương tự (Bruno,
  Postman folder-level auth) — cấp càng gần request càng cụ thể, nên càng có quyền ghi đè cấp
  chung chung hơn. Test `request.test.ts` khẳng định rõ 3 trường hợp: header kế thừa được áp,
  request ghi đè header kế thừa cùng tên (không phân biệt hoa/thường), và folder ghi đè
  collection cùng tên.
- **Vì sao so khớp không phân biệt hoa/thường thay vì so khớp chuỗi y hệt như code cũ**: code
  cũ (`buildHeaders` trước thay đổi này) chỉ ghi đè khi header của auth trùng **y hệt** key đã
  gõ — chấp nhận được vì auth luôn tự đặt tên header chuẩn (`Authorization`). Nhưng 1 khi có 3
  tầng (collection/folder/request) độc lập gõ tay, khả năng lệch hoa/thường cho cùng 1 header
  (`Content-Type` vs `content-type`) là thực tế và sẽ gửi đi 2 header trùng ngữ nghĩa nếu so
  khớp y hệt chuỗi — nên đổi sang so khớp theo `toLowerCase()`, giữ lại key gốc người dùng đã gõ
  để hiển thị/generate code đúng như họ nhập.
- **Vì sao không thêm `vars: {req, res}` kiểu request cho collection/folder trong đợt này**:
  Bruno có, nhưng phạm vi yêu cầu lần này là "vars, headers, script, tests" — 3/4 (vars ở dạng
  Collection Variables, script, tests/assertions) đã có sẵn từ trước; header là khoảng trống
  thực sự duy nhất. Thêm collection/folder-level declarative Vars (`VarDef[]` dạng biểu thức JS)
  là một tính năng độc lập, nên để lại cho một quyết định riêng nếu có nhu cầu cụ thể.

## Rủi ro / follow-up đã biết

- Postman v2.1 không có khái niệm header ở cấp `Item`/`ItemGroup` (collection/folder) — nên
  import/export Postman **không** round-trip trường `headers` mới này (giống Collection
  Variables trước đó). Có thể lách bằng cách "đẩy xuống" thành header ở mọi request con khi
  export, nhưng chưa làm ở đợt này để tránh nhân bản dữ liệu ngầm mà người dùng không thấy.
- `collectInherited` được gọi lại mỗi lần `collections` đổi (qua `useCallback`/`useMemo` phụ
  thuộc `collections`) — cùng chi phí đã chấp nhận từ trước cho `pre`/`post` script, không phát
  sinh thêm điểm tính toán nặng mới.
