# Environment inheritance / Collection Variables

## Phương án đã chọn

Thêm **1 tầng biến mới cấp collection** (`Collection.variables?: KeyValue[]`), độc lập với
Environment, thay vì làm Environment kế thừa lẫn nhau (Global + Collection gộp lại).

Precedence khi substitute `{{var}}` (điểm hợp nhất duy nhất — `engine.ts`'s `varMap()`):

```
vault  <  collection variables  <  environment  <  data-file row (Runner)  <  runtime (bru.setVar/script)
```

Collection variables là **default dùng chung cho mọi request trong collection**, bất kể
environment nào đang active. Environment (Global hoặc scoped-1-collection) vẫn giữ nguyên
quan hệ loại trừ lẫn nhau như trước — **không** gộp Global + Collection Environment thành một
chuỗi kế thừa.

UI: dialog "Environments" (`EnvironmentEditor.tsx`) có thêm 1 mục chọn "Collection Variables"
ở đầu danh sách bên trái (chỉ hiện khi có collection đang active), dùng lại `KeyValueEditor`
y hệt cách sửa 1 environment.

## Lý do

- **Vấn đề cần giải quyết**: trước khi có thay đổi này, muốn dùng chung 1 giá trị (base URL,
  API version...) cho toàn bộ request trong 1 collection, người dùng buộc phải tạo 1
  Environment scoped-theo-collection và luôn giữ nó active — không có khái niệm "giá trị mặc
  định của collection" tách biệt khỏi khái niệm "environment đang chọn". Điều này conflate 2
  khái niệm vốn khác mục đích: environment = "tôi đang trỏ tới stage nào" (dev/staging/prod),
  còn collection variable = "giá trị không đổi bất kể đang ở stage nào" (tên API, version cố
  định...).
- **Vì sao không gộp Global + Collection Environment thành 1 chuỗi kế thừa** (như một số
  client khác làm: Global → Collection Env → Environment): sẽ làm phức tạp hoá mô hình mutual
  exclusion đơn giản hiện có (1 environment global HOẶC scoped, không bao giờ cả hai cùng lúc)
  mà lợi ích thực tế cho 1 tool desktop single-user là không tương xứng — người dùng vẫn có
  thể đạt hiệu quả tương đương bằng cách đặt giá trị chung vào Collection Variables (tầng mới)
  và chỉ override phần khác-nhau-theo-stage ở Environment.
- **Vì sao Collection Variables nằm dưới Environment (không phải trên)**: khớp đúng trực giác
  Postman ("collection variable là baseline, environment override khi cần") — một giá trị đặt
  cụ thể trong environment luôn phải thắng giá trị mặc định ở cấp collection, không thì
  environment mất tác dụng "chọn stage".
- **Vì sao đây là điểm sửa duy nhất trong `engine.ts`'s `varMap()`**: đây vốn đã là điểm hợp
  nhất precedence duy nhất cho toàn bộ hệ thống biến (vault/env/data/runtime) — bất kỳ nguồn
  biến mới nào trong tương lai đều phải đi qua đúng điểm này, không tạo đường hợp nhất song
  song, để precedence luôn nhất quán và dễ test.

## Rủi ro / follow-up đã biết

- `collectCollectionVars` (trong `store.ts`) resolve theo **request id** (dò theo cây
  collection/folder chứa request đó), không theo "collection đang active trên UI" — cố ý, để
  Runner chạy đúng collection vars của chính collection chứa request được chạy, kể cả khi
  request đó không thuộc collection đang focus trên sidebar. Nếu sau này có thêm 1 cách chạy
  request "rời" khỏi cây collection (ví dụ import 1 request đơn lẻ không thuộc collection nào),
  cần rà lại hàm này.
- Chưa hỗ trợ export Collection Variables qua Postman collection export (Postman không có khái
  niệm tương đương ở cấp `Item`/`ItemGroup` — chỉ có `variable` ở cấp toàn bộ collection, có thể
  map 1-1 trong tương lai nếu cần round-trip, nhưng chưa làm ở đợt này).
- Không thêm masking/secret cho Collection Variables ở đợt này — xem `2.1` (cờ "secret" cho
  Environment Variables) trong kế hoạch tổng; nếu người dùng đặt secret vào Collection
  Variables, nó sẽ plaintext giống Environment Variables trước khi có `2.1`.
