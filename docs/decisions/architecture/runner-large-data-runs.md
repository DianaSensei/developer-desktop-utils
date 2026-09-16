# API Client Runner — chạy collection với data file ~100k dòng

## Phương án đã chọn

Runner (`RunnerDialog.tsx`) ban đầu được viết cho quy mô demo: vài request × vài chục iteration.
Khi bind một file CSV ~100k dòng (mỗi dòng = 1 iteration), ba chỗ trong thiết kế cũ trở thành
nút cổ chai bậc hai hoặc chặn hẳn main thread. Bốn thay đổi dưới đây là để cùng một dialog
chịu được quy mô đó mà không đổi mô hình dữ liệu (records vẫn là **danh sách có thứ tự** các
lần thực thi, không phải map theo request — `setNextRequest` cho phép một request chạy nhiều
lần hoặc không lần nào trong một iteration).

**1. Records sống trong ref, UI cập nhật theo nhịp throttle.**
Trước: `setRecords(prev => [...prev, record])` sau mỗi request, cộng với
`useMemo(() => summarize(records), [records])` — mỗi record tốn O(n) để copy mảng + O(n) để
tính lại thống kê, tức O(n²) cho cả run. Sau:

- `recordsRef` — mảng append-only, là lịch sử đầy đủ (chỉ đọc một lần, lúc export).
- `byIterRef: Map<iter, RunRecord[]>` — index theo iteration; view kết quả chỉ chạm đúng vài
  record của iteration đang xem thay vì `records.filter(...)` trên toàn bộ lịch sử.
- `accRef` (`RunStatsAcc`) + `iterStatsRef` — tổng chạy dần, `fold()` O(1)/record
  (`runnerStats.ts`).
- `tick` state + `scheduleFlush()` (120ms) — thứ *duy nhất* kích hoạt re-render. `ranIters`
  cũng đi qua nhịp này; `flushNow()` chạy ngay khi run kết thúc để không còn record treo.

**2. Parse data file trong Web Worker.** `parseDataFileAsync()` (`datafile.ts`) đẩy sang
`src/workers/datafile.worker.ts` khi file > 200.000 ký tự, dưới ngưỡng đó parse đồng bộ như cũ
(round-trip worker đắt hơn chính việc parse). Logic parse vẫn nằm nguyên trong `datafile.ts`
(thuần, không DOM) để test trực tiếp được và worker chỉ là lớp vỏ.

**3. Iteration rail virtualized.** `VirtualIterRail` chỉ render các dòng đang nằm trong khung
nhìn (+ overscan), spacer div giữ đúng chiều cao thật cho thanh cuộn, kèm ô "nhảy tới iteration
#N" khi > 100 iteration. Chiều cao dòng là hằng số theo chế độ (`ITER_ROW_H` 36px cho run
thường, `ITER_ROW_H_DATA` 48px khi có nhãn dữ liệu ở dòng thứ hai).

**4. Assertion HTTP 2xx mặc định (`Require HTTP 2xx`, bật sẵn).** Phần lớn collection chỉ cần
"200 là xong", nhưng trước đây muốn điều đó được *tính* là pass/fail thì phải viết test script
cho từng request. Nay Runner tự chèn một assertion dựng sẵn (`httpOkTest`, tên
`HTTP status is 2xx (built-in)`) vào đầu danh sách test của mỗi lần thực thi — chèn vào cả bản
copy `ExecResult` dùng cho detail view, nên nó hiện trong tab Tests, cộng vào tổng assertion,
làm fail execution và có mặt trong cả hai bản export, đúng như một assertion người dùng tự viết.
Request lỗi transport (không có response) cũng nhận check này (`No response: …`).

Song song đó, `fold()` đếm `http2xx` **độc lập với assertion** (cả mức run lẫn mức request) →
tile **HTTP 2xx** trên dashboard, cột **HTTP 2xx** trong bảng By request, cột `httpOk` trong CSV
và khối `http` trong JSON. Chỉ số này đúng kể cả khi tắt option.

**5. Tracking response code theo từng request.** `fold()` gom thêm:

- `byRequest` — rollup mỗi request qua tất cả iteration (số lần chạy, pass/fail, phân bố status
  code, avg/min/max ms), hiển thị ở tab **By request**.
- `statusSamples` — status code → danh sách iteration đã sinh ra code đó, **có trần**
  (`STATUS_SAMPLE_CAP = 100`), cả ở mức run lẫn mức từng request. Click vào chip status là nhảy
  tới một iteration có code đó (click tiếp thì sang cái kế).

**6. Export theo luồng (streaming), không dựng chuỗi khổng lồ.** `runnerExport.ts` sinh **generator
các chunk** (`csvChunks`, `jsonReportChunks`) thay vì một chuỗi; `saveStreamedTextFile`
(`fileio.ts`) gom tới 4MB rồi mới ghi — lần đầu `writeTextFile` (ghi đè), các lần sau
`writeTextFile(..., { append: true })`, nên bộ nhớ đỉnh phẳng bất kể run to cỡ nào và không cần
capability mới (append là option của chính lệnh đã được cấp). Bản web đẩy thẳng mảng chunk vào
`new Blob(parts)` — trình duyệt tự nối, không qua một chuỗi JS khổng lồ.

Menu Export có 4 mục: CSV/JSON × (tất cả / **chỉ failure**). Với run 100k dòng thì "chỉ failure"
mới là thứ người ta thực sự mở. Danh sách `failures` nhúng trong summary bị cắt ở
`FAILURE_LIST_CAP = 1000` (kèm `failuresTruncated`/`failuresTotal`) vì nó chỉ là chỉ mục trỏ vào
`runs`, không phải dữ liệu mới.

Export: CSV (`runnerExport.ts`, thuần + có test) một dòng / một request đã chạy, kèm cột
của data file; JSON được bổ sung `byRequest` + `statusCodeSamples` + `http`.

## Lý do

- **Vì sao ref + tick chứ không phải `setRecords` throttle.** Throttle lời gọi `setRecords`
  vẫn phải copy cả mảng mỗi lần flush, và số lần flush tỉ lệ với thời gian chạy — mà thời gian
  chạy lại tỉ lệ với n. Tổng chi phí vẫn là O(n²). Chỉ khi state không còn *chứa* lịch sử
  (ref chứa, `tick` chỉ báo "có gì đó mới") thì chi phí re-render mới độc lập với n.
- **Vì sao index theo iteration.** Ngay cả khi records nằm trong ref, `records.filter(r => r.iter
  === viewIter)` mỗi lần render vẫn là O(n). `byIterRef` biến nó thành O(1) tra cứu + O(số
  request/iteration) lọc.
- **Vì sao HTTP 2xx là một assertion chèn vào, không phải sửa `isOk`.** Sửa thẳng `isOk` thành
  "chỉ 2xx mới pass" sẽ đổi ngầm ý nghĩa của mọi run cũ (3xx đang được coi là pass) và không có
  cách nào tắt. Dưới dạng assertion: nó **hiện ra** trong tab Tests với lý do cụ thể
  (`Expected 2xx, got 302 Found`), đi qua đúng một đường tính pass/fail đã có, và tắt option là
  quay lại hành vi cũ nguyên vẹn. Đây cũng là lý do `isOk` vẫn giữ khoảng 200–399.
- **Vì sao vừa có assertion vừa có bộ đếm `http2xx` riêng.** Hai câu hỏi khác nhau: "endpoint có
  sống không" (HTTP 2xx) và "response có đúng không" (Passed/Failed, gồm cả assertion người dùng
  viết). Một run 100% 2xx vẫn có thể fail assertion, và ngược lại người dùng tắt option vẫn cần
  biết bao nhiêu call không phải 2xx — nên bộ đếm không phụ thuộc vào option.
- **Vì sao trần cho `statusSamples`.** Index "iteration nào trả 500" mà không giới hạn thì với
  100k iteration chính nó là một chỗ rò bộ nhớ; 100 ví dụ đã nhiều hơn số người thực sự bấm
  qua. Số đếm trong `byStatus` vẫn chính xác tuyệt đối, chỉ danh sách ví dụ mới bị cắt.
- **Vì sao mặc định tắt "Save responses" khi > 2.000 dòng.** Giữ mọi response của 100k iteration
  trong RAM là cách chắc chắn nhất để app chết trước khi run xong. Thống kê, pass/fail và cả hai
  bản export vẫn phủ đủ 100% số dòng khi tắt — chỉ mất khả năng mở lại body của từng response.
- **Vì sao có "Test with only the first N rows".** Kiểm tra mapping biến ({{var}} ↔ cột CSV)
  bằng 10 dòng trước khi cam kết chạy 100k dòng, mà không phải cắt file thủ công.
- **Vì sao CSV chứ không chỉ JSON.** Với hàng chục nghìn dòng kết quả, thứ người dùng mở là
  spreadsheet để lọc "dòng nào fail, status bao nhiêu"; JSON lồng nhau nặng và chậm cho đúng
  thao tác đó. Cột `status` ghi `error` (không phải `0`) cho request không hề nhận được response,
  để bộ lọc trong spreadsheet phân biệt được "không có response" với một mã thật.

## Rủi ro / follow-up đã biết

- **Bộ nhớ vẫn tuyến tính theo số record.** Mỗi `RunRecord` (kể cả khi đã tắt Save responses)
  vẫn giữ `tests`, `logs`, `dataVars`. Với 100k iteration × nhiều request/iteration, đây là
  giới hạn kế tiếp sẽ chạm tới. Hướng xử lý nếu cần: ghi thẳng ra file theo luồng (streaming
  export) thay vì tích trong RAM, hoặc chỉ giữ chi tiết của các record fail.
- ~~**Export dựng một chuỗi lớn trong RAM.**~~ Đã xử lý: cả hai định dạng nay stream theo chunk
  (mục 6 ở trên). `buildResultsCsv` vẫn còn nhưng chỉ là tiện ích join cho test và run nhỏ —
  đường export thật không gọi nó. Lưu ý còn lại: mỗi lần flush là một IPC round-trip, nên đừng
  hạ `FLUSH_BYTES` xuống nhỏ.
- **`ITER_ROW_H*` phải khớp markup.** Virtualization nhân chiều cao dòng theo hằng số; sửa
  padding/leading của dòng rail mà quên sửa hằng số sẽ làm các dòng chồng lên nhau hoặc hở khe.
- **Chạy song song (parallel) + data file**: mỗi iteration vẫn chạy tuần tự với nhau, chỉ các
  request *trong* một iteration là song song. Chưa có chế độ chạy N iteration cùng lúc — đó mới
  là thứ rút ngắn thời gian thật sự cho 100k dòng, và cần thiết kế riêng về giới hạn đồng thời.
- **CSV không chống formula injection** (`=`, `+`, `@` đầu ô): giữ nguyên dữ liệu server trả về
  để phân tích không bị méo. Nếu sau này export cho người ngoài đội, cần cân nhắc prefix `'`.
