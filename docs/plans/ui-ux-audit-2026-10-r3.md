# Audit chức năng — vòng 3: kết quả tính toán, dữ liệu, bảo mật (2026-10-13)

Tiếp nối [ui-ux-audit-2026-10-r2.md](ui-ux-audit-2026-10-r2.md). Vòng 2 kiểm phần nhìn và thao
tác (render, a11y, bàn phím, lần đầu mở, cửa sổ hẹp). Vòng này kiểm **tool cho ra kết quả có
đúng không**, dữ liệu người dùng có bị mất hay bị đổi không, và có lỗ hổng bảo mật nào không.

## Cách làm

| Mảng | Cách kiểm |
|---|---|
| Mã hoá / hash / crypto, JWT, 2FA | So với Node `crypto`, test vector RFC 4648 / 4226 / 6238 / 3492, OpenSSL |
| JSON, Data Converter, SQL, Diff, Regex, Text, Markdown | Chạy hàm thật trong vitest (jsdom), render component, thử XSS |
| Cron, Date/Time, Generator, Color, QR, Task Tracker | So với `croner` / `cron-parser`, chạy với `TZ=America/New_York` và các múi giờ khác quanh mốc DST |
| API Client, Mock Server, Network | Hook thật qua `renderHook`; logic Rust chép ra crate riêng để chạy |
| Nền tảng: lưu trữ, workspace, cài plugin, deep link, i18n | vitest + chép logic `artifact_installer.rs` ra crate riêng, chạy trên thư mục tạm |
| Luồng dùng trên bản build | Playwright + mock Tauri có store **giữ qua lần tải lại**: gõ vào từng tool → chuyển tool / tải lại → còn không; phím tắt; undo/redo |

Mỗi lỗi dưới đây đều **đã chạy lại được** (lệnh + kết quả nằm trong ghi chú làm việc). Những gì
chỉ đọc code mà chưa chạy được thì để riêng ở cuối. Không sửa file nào trong repo.

## Tóm tắt

Phần vỏ app đã ổn sau vòng 2. Vấn đề nằm ở **ruột của từng tool**, chỗ mà kiểm UI không thấy:

1. **Ba lỗ bảo mật ở luồng cài plugin.** `version` trong manifest không được kiểm, nên một
   manifest độc có thể ghi file (kể cả file thực thi) ra ngoài thư mục app và **xoá thư mục bất
   kỳ** khi update. Update thêm quyền mà không hỏi lại. Deep link thay bản đã cài mà không cho
   thấy nguồn.
2. **Tool "làm đẹp" mà đổi nội dung.** SQL formatter cắt đôi tên cột và cho comment nuốt dòng
   code kế tiếp. JSON làm tròn số > 2^53, mất key `__proto__`, sửa dấu nháy trong chuỗi. Data
   Converter biến `01234` thành `1234`. Diff ở chế độ JSON **ghi đè chính văn bản đang so** rồi
   báo "không khác". Người dùng tin kết quả nên sẽ không phát hiện.
3. **Thời gian.** Date/Time bỏ qua offset `Z`/`+07:00` và lệch 1 giờ quanh DST; timestamp không
   đúng 10/13 chữ số thì đọc sai; ô nhập bị đồng hồ "Live" ghi đè sau 1 giây. Cron biến biểu
   thức Quartz thành Spring nên lịch chạy sai ngày.
4. **API Client gửi request khác với cái người dùng thấy.** Query đã mã hoá bị mã hoá lần hai,
   body của GET bị bỏ, import curl đổi method, Runner không truyền biến giữa các request.
5. **Một vài con số sai hẳn:** "SHA-3" thật ra là Keccak; sinh số ngẫu nhiên khoảng > 2^32 làm
   **treo app**.

| Mức | Số lỗi |
|---|---|
| P1 — bảo mật | 5 |
| P1 — kết quả sai, mất dữ liệu | 22 |
| P2 — lỗi chức năng đáng kể | 37 |
| P3 — lặt vặt | ~40 |

---

## P1

### Bảo mật

| # | Vấn đề | Chỗ | Cách sửa |
|---|---|---|---|
| S1 | **Path traversal qua `version` của manifest.** Validator plugin không kiểm `version`, validator service chỉ kiểm khác rỗng; sau đó `.join(&manifest.version)` (đường dẫn tuyệt đối thay cả đường dẫn, `../..` leo ra ngoài). Đã chạy: `version: "/home/u/Documents"` ghi `bundle.mjs` vào đó; update lên `2.0.0` chạy `remove_dir_all` **xoá luôn thư mục đó**. Service `bin: "git"` + `version: "../../../home/u/.local/bin"` thả file `git` có quyền thực thi vào PATH. Tới được từ deep link, market tuỳ chỉnh, URL dán tay. | `src-tauri/src/artifact_installer.rs:354,368,408,447,503,549` | Bắt `version` khớp `^[0-9A-Za-z.+-]{1,64}$`, cấm `/` `\` `..`; canonicalize đích và assert nằm trong `plugins_dir`/`services_dir` trước khi ghi **và** trước khi xoá. Kiểm `market_id` tương tự. |
| S2 | **Update plugin thêm quyền mà không hỏi.** Một cú bấm Update cài bản mới với `secrets`, `service`, `http`, `hosts: ['*']` — không xem trước, không so quyền. Ngoài ra Rust tải lại manifest lúc cài, nên thứ được cài có thể khác thứ người dùng đã xem (TOCTOU) ở mọi đường cài. | `SettingsInstalledExtensions.tsx:106,138`; `artifact_installer.rs:721` | Update đi qua `ExtensionInstallDialog`, hiện quyền/host **được thêm**. Gửi integrity + quyền của bản đã xem xuống Rust; khác thì từ chối. |
| S3 | **Deep link thay hoặc hạ cấp plugin đã cài mà không cho thấy nguồn.** Dialog không hiện host của manifest, không hiện `hosts`, không báo "thay bản 2.5.0 từ good.example". Comment trong `deepLink.ts` nói người dùng "xem nguồn" nhưng dialog không có. | `ExtensionInstallDialog.tsx:82,162`; `lib/deepLink.ts` | Hiện host nguồn và `hosts`; nếu id đã cài thì hiện "Thay vX từ <host>", hạ cấp hoặc đổi nguồn thì cần xác nhận thêm. |
| S4 | **Prototype pollution từ file `.properties`.** Dán `__proto__.polluted=yes` vào Data Converter → `({}).polluted === 'yes'` **trong toàn app** (cũng qua `constructor.prototype`). | `src/lib/properties.ts:93-94` | Bỏ qua/báo lỗi các đoạn `__proto__`, `constructor`, `prototype`; dựng object bằng `Object.create(null)`. |
| S5 | **Khoá HMAC trong Pipeline lưu dạng rõ.** Khoá chính đã vào vault ở vòng 2, nhưng `key` của từng bước Pipeline vẫn nằm trong `pipeline:steps-v2` → `app-settings.json` (`"key":"sk_live_…"`). | `PipelineTab.tsx:922,936` | Khoá từng bước vào `useSecretState` theo id bước, bỏ `key` khỏi dữ liệu lưu, thêm migration. |

### Kết quả sai / mất dữ liệu

| # | Tool | Vấn đề | Chỗ | Cách sửa |
|---|---|---|---|---|
| 1 | Hash | **"SHA-3/256", "SHA-3/512" ra Keccak**, không phải SHA-3 FIPS-202. `''` → `c5d24601…` (đúng: `a7ffc6f8…`). Nút Verify báo sai với hash đúng; MCP `hash_compute` cũng sai. | `EncodeHashEncrypt.tsx:407-408,428-429` | Dùng `sha3` của hash-wasm (đã có trong deps); nếu muốn giữ Keccak thì đặt đúng tên "Keccak-256". |
| 2 | Random | **Khoảng > 2^32 làm treo app.** Min 0, Max 5 000 000 000 → `limit = 0`, vòng lặp không bao giờ nhận giá trị nào. | `src/lib/secureRandom.ts:27` | Bound > 2^32 thì ghép hai lần rút 32-bit (53-bit + rejection), hoặc chặn ở UI. |
| 3 | Pipeline | **Sắp xếp key bằng `localeCompare`**, không theo ASCII. Cổng thanh toán (OnePay `vpc_*`, Alipay, WeChat) ký theo thứ tự ASCII → chữ ký sai khi có chữ hoa hoặc `_`. | `PipelineTab.tsx:244-245` | So theo code unit (`a < b ? -1 : …`), để làm mặc định. |
| 4 | Unix Time | **Timestamp vừa nhập bị đồng hồ ghi đè** ~1 giây sau khi chuyển tool rồi quay lại, hoặc mở lại app (`isLive` luôn khởi đầu `true`). | `DateTimeTool.tsx:416-435` | Suy `isLive` từ dữ liệu đã lưu (`rawInput` rỗng mới là live), hoặc lưu luôn cờ live. |
| 5 | Date/Time | **Bỏ qua `Z` / `±hh:mm` khi múi giờ input khác múi giờ máy.** `2026-01-01T00:00:00Z` @Tokyo → `2025-12-31T15:00Z`. | `DateTimeTool.tsx:110-123` | Chuỗi có offset thì `parseISO` nguyên; chỉ diễn giải lại chuỗi không có offset. |
| 6 | Date/Time | **Lệch 1 giờ quanh DST** (offset chỉ tính một lần): New York `2026-03-08T03:30` → `04:30`; Auckland "Đầu ngày" ra ngày hôm trước. | `DateTimeTool.tsx:121-123`, `applyBoundaryInTz` ~533 | Tính offset lần hai tại `utcGuess - offset`, hoặc dùng `fromZonedTime` của date-fns-tz. |
| 7 | Date/Time | **Timestamp chỉ nhận đúng 10 hoặc 13 chữ số.** `0` → 2000-01-01; `-86400` → năm +086400; giây 9 chữ số (trước 9/2001) và ms 12 chữ số báo lỗi; µs/ns không đọc được; gợi ý "timestamp" lại hiện cho 11–12 chữ số. | `DateTimeTool.tsx:93-94,486` | Nhận `^-?\d+$`, chọn đơn vị theo độ lớn (s/ms/µs/ns). |
| 8 | Cron | **Preset Quartz hoặc mọi biểu thức 6 trường tự đổi sang Spring.** Quartz `0 0 9 ? * 2` (thứ Hai) → lịch chạy hiện **thứ Ba**. | `CronGenerator.tsx:351-361`, preset `:288` | Giữ chế độ hiện tại nếu số trường hợp lệ với nó; chỉ đoán khi không hợp lệ. |
| 9 | SQL | **Từ khoá khớp giữa tên cột:** `color` → `col\n or`, `region` → `regi\n on`, `date_from` bị cắt. Nội dung editor bị thay bằng SQL hỏng (đã tái hiện trên bản build). | `SqlFormatter.tsx:86-98` | Chỉ nhận từ khoá khi ký tự trước không thuộc `[A-Za-z0-9_$.]`; tốt hơn là tách token. |
| 10 | SQL | **Comment `--` nuốt dòng kế tiếp** vì khoảng trắng bị gộp làm mất xuống dòng: `a, -- x\n b` → cột `b` thành comment. Mongo `//` cũng vậy. | `SqlFormatter.tsx:73,137` | Luôn xuống dòng sau placeholder comment. |
| 11 | JSON | **Sửa dấu nháy cong trong chuỗi**: `"don’t"` → `"don't"`, `«Bonjour»` → `"\"Bonjour\""`; JSON hợp lệ có `“stop”` trong chuỗi bị báo lỗi. Cả khi dán nhanh và MCP `json_format`. | `JsonFormatter.tsx:43,469` | `JSON.parse` trước; chỉ chuẩn hoá nháy cong ở vị trí làm dấu phân cách, không đụng trong chuỗi. |
| 12 | JSON | **Key `__proto__` biến mất**, vẫn báo "Valid JSON"; MCP `json_minify` ra `{}`. | `JsonFormatter.tsx:173` | `Object.create(null)` / `defineProperty`, hoặc dùng `JSON.parse` cho input chuẩn. |
| 13 | JSON | **Số nguyên > 2^53 bị làm tròn không báo**: `12345678901234567890` → `…567000`. | `JsonFormatter.tsx:142` | Giữ nguyên văn bản số (lexeme) khi in lại; ít nhất cảnh báo khi không phải safe integer. |
| 14 | Data Converter | **XML đổi giá trị:** `<zip>01234</zip>` → `1234`, số điện thoại mất số 0, `1.10` → `1.1`, `0x1F` → `31`, `id="007"` → `7`; XML→XML ra `<?xml version="1"?>`. | `DataConverter.tsx:64` | `parseTagValue:false`, `parseAttributeValue:false` (hoặc `numberParseOptions` tắt leadingZeros/hex), bỏ qua node `?xml`. |
| 15 | Data Converter | **Properties: `1.10` → `1.1`**, và cấu hình logging kiểu Spring (`logging.level.com.example=DEBUG` + `…example.service=TRACE`) làm hỏng cả lần chuyển. | `lib/properties.ts:89-96,128` | Chỉ ép kiểu khi `String(Number(s)) === s`; khi va chạm scalar/object thì giữ key phẳng hoặc báo đúng dòng. |
| 16 | Diff | **Chế độ JSON ghi đè cả hai bên** qua `JSON.parse/stringify` → `9007199254740993` vs `…992`, `1.10` vs `1.1` thành giống nhau, báo "Không khác"; văn bản gốc của người dùng mất. | `diff/TextDiff.tsx:106-129,86` | Không ghi đè văn bản; chỉ format khi round-trip không mất gì; so số lớn theo text. |
| 17 | API Client | **Hai lần ghi môi trường trong cùng một tick mất lần đầu.** Script gọi `setEnvVar` cho env collection rồi env global → giá trị collection biến mất. | `apiclient/useEnvSecrets.ts:24-31`, `useApiRunner.ts:51,54` | Gộp trong chuỗi updater (`prev => …`), không đọc từ ref. |
| 18 | API Client | **Runner không truyền biến giữa các request**: Login đặt `token`, request sau gửi không có; sau khi chạy chỉ lưu biến của request cuối. | `useApiRunner.ts:100-112`, `RunnerDialog.tsx:302,374` | `runRequest` đọc store qua ref cập nhật mỗi render; giữ map biến riêng cho cả lượt chạy. |
| 19 | API Client | **Query đã mã hoá bị mã hoá lần hai**: `redirect=https%3A%2F%2F…` gửi thành `https%253A…`; `q=a+b` thành `a%2Bb`. Ảnh hưởng cả dán URL, import curl, Postman. | `request.ts:81`, `paramsFromUrl` `:513` | Giải mã giá trị (form-decode) khi tách từ URL, hoặc giữ nguyên các `%XX` hợp lệ. |
| 20 | API Client | **Body của GET/HEAD bị bỏ** trong khi ô Body vẫn cho nhập và "Generate code" vẫn in `--data`. Elasticsearch `GET /_search` gửi không có body. | `request.ts:151`, `resolveBody` ~450 | Gửi body cho GET trên Tauri (reqwest hỗ trợ) hoặc cảnh báo; codegen khớp với thứ thật sự gửi. |
| 21 | API Client | **Import curl sai method/body**: `-XPUT … -d` → POST; `--json '{…}'` → GET không body; `-d a=1 --data-urlencode b=…` mất `a`; `-I` → GET; `-d @file` thành chữ `@file`. | `curl.ts:120-152` | Đọc giá trị dính liền (`-XPOST`, `-H'…'`), hỗ trợ `--json`, `-I`, gộp `-d`, cảnh báo `@file`. |
| 22 | Encrypt | **Nội dung đang mã hoá lưu dạng rõ** (`hash:encryptInput`) trong khi passphrase đã vào vault. | `EncodeHashEncrypt.tsx:562` | `useSecretState` hoặc không lưu, giống ô token của JWT. |

---

## P2

**Mã hoá / JWT / 2FA**
- JWT Sign **ghi đè `exp`/`iat` đã gõ** trong payload (Expires-in mặc định `1h`). `jwt/jwtCrypto.ts:442-443`
- Punycode sai với tên miền đầy đủ: `bücher.de` → `bcher.de-65a` (đúng: `xn--bcher-kva.de`); decode `xn--…` sai. `EncodeHashEncrypt.tsx:312-390`
- Pipeline hex/binary decode biến input sai thành byte sai mà không báo (`zz41` → `\0A`, độ dài lẻ), rồi đem ký. `PipelineTab.tsx:173-178`
- Pipeline "JSON Input" đổi số trước khi ký: `100.50` → `100.5`, `1.0` → `1`, số lớn bị làm tròn. `PipelineTab.tsx` `flattenJson`

**Dữ liệu / văn bản**
- JSON: key dạng số bị đổi thứ tự (`{"b","2","a","1"}` → `1,2,b,a`). `JsonFormatter.tsx:328`
- YAML không áp merge key `<<: *anchor`; nhiều document báo lỗi. `DataConverter.tsx:56`
- SQL: chuỗi có `\`, thân `$$…$$`, comment `#` không được bảo vệ → nội dung bị viết lại. `SqlFormatter.tsx:120`
- Regex: match độ dài 0 + cờ `u` trên emoji → 500 match giả cùng vị trí. `workers/regex.worker.ts:60`
- Regex: số match bị cắt ở 500 mà không nói (Replace vẫn thay hết). `regex.worker.ts:29`
- Text Transformer: chuyển số điện thoại VN bỏ qua các số cách nhau bằng dấu cách/tab (TSV). `TextTransformer.tsx:73`
- Text Counter: "Ký tự" đếm UTF-16 (👍🏽 = 4, 🇻🇳 = 4, "Việt" dạng NFD dài hơn). `lib/textStats.ts:106`
- **Deduplicate mất input khi chuyển sang tool khác rồi quay lại** (và khi mở lại app); mọi tool văn bản khác đều giữ. `ArrayDeduplicator.tsx:124-131`

**Thời gian / số / sinh dữ liệu**
- Unix Time: chế độ Live **ghi store mỗi giây** khi chỉ mở tool (5 lần ghi / 5 giây). `DateTimeTool.tsx:420-426`
- Unix Time: khi Live, ô đang focus bị ghi lại mỗi giây → vùng chọn nhảy về cuối, gõ thì nối vào sau giờ hiện tại (`…:451700000000`).
- Date/Time: "Tuần trong năm" không phải ISO như tooltip nói (`w`/`yyyy` thay vì `I`/`RRRR`). `DateTimeTool.tsx:264`
- Date/Time: đổi múi giờ input làm đổi thời điểm thay vì quy đổi (ref bị gán trước khi parse). `DateTimeTool.tsx:456-459`
- Cron: DST tiến giờ → "Lần chạy tới" có 03:30 hai lần. `lib/cronNext.ts:167-176`
- Cron: diễn giải bỏ điều kiện ngày (`0 */5 * ? * MON` → "Mỗi 5 phút"). `CronGenerator.tsx:531`
- Test Data: tên trường có khoảng trắng đầu/cuối → cột CSV/TSV/SQL rỗng. `lib/faker.ts:298` vs `:235`
- QR: không đọc được QR nền trong suốt do chính tool tạo (canvas không tô trắng). `QRCodeTool.tsx:517`
- QR: tải logo/ảnh > ~125 KB lỗi trên app desktop (`btoa(String.fromCharCode(...bytes))` tràn stack). `QRCodeTool.tsx:279`
- Task Tracker: Calendar lệch 1 giờ vào ngày DST, kéo-tạo ra giờ sai. `clockify/CalendarView.tsx:197,216`

**API Client / Mock Server / Network**
- curl: `-d 'discount=50%'` ném `URI malformed` → cả lệnh curl thành URL. `curl.ts:196`
- Biến lồng nhau không được thay (`{{url}}` = `{{host}}/api`). `vars.ts:19`
- Basic auth với mật khẩu ngoài Latin-1 làm Send lỗi; `pässword` mã hoá Latin-1 thay vì UTF-8. `request.ts:113`
- Import Postman: giá trị số làm Send lỗi (`text.replace is not a function`); biến và script cấp collection bị bỏ không báo. `postman.ts:85,244`
- Export Postman: "No Auth" thành "inherit" → import lại sẽ gửi token của collection. `postman.ts:270-314`
- Path param có gạch nối (`:file-id`, từ OpenAPI `{file-id}`) không bao giờ được thay. `request.ts:57`, `openapi.ts:468`
- Generate code: multipart có `Content-Type` mà thiếu boundary (fetch/axios/Python); wget bỏ body form; httpie thiếu `--form`; key trùng bị gộp. `request.ts:445`, `codegen.ts:48-76`
- Multipart: trường text có Content-Type bị gửi như file; dòng file chưa chọn file gửi chuỗi rỗng không báo. `request.ts:170-181`
- Mock Server: header không hợp lệ (tên có dấu cách, giá trị có xuống dòng từ template) → trả **200 rỗng** trong khi log ghi status/body đã cấu hình. `src-tauri/src/mockserver.rs:833-850`
- Network DNS "ALL" báo NOERROR cho tên không tồn tại; PTR cho IP không đổi sang `in-addr.arpa`; URL dán vào không được bóc scheme/path. `lib/network.ts:179,~78`
- Import Bruno cắt body có `}` trong chuỗi, giữ thụt lề 2 dấu cách. `bruno.ts:41`

**Nền tảng**
- Plugin cài thêm: bấm tắt phải 2 lần; "Tắt tất cả" bỏ sót. `FeatureContext.tsx:70`, `platform/registry.ts:112`
- Marketplace mời "Update" plugin cài từ URL, rồi luôn lỗi (thông báo tiếng Việt trong UI tiếng Anh). `SettingsMarketplace.tsx:218`
- Vault đọc lỗi → tool chứa bí mật vẫn trông bình thường nhưng **âm thầm bỏ mọi thay đổi** (tài khoản 2FA mới biến mất khi mở lại). `platform/useSecretState.ts:53`
- **Tìm kiếm tiếng Việt không ra gì**, có dấu hay không dấu (`chuyển đổi`, `mã hoá`, `thời gian`, `mật khẩu` → rỗng). `lib/toolSearch.ts:16`

---

## P3 — lặt vặt

- **Mã hoá:** decode JWT lỗi cả khi `exp` quá lớn (µs, `1e300`); HTML entity: `&#X41;`, `&#x110000;`, `&copy;`; quoted-printable hỏng ký tự không ASCII, khoảng trắng cuối dòng, `\r` lẻ; Hex/Binary/Decimal nhận tiền tố (`"4g"` → `0x04`); ký tự surrogate lẻ làm tab Hash rơi vào ErrorBoundary; 2FA: nhãn có hai dấu `:` mất phần sau, secret không hợp lệ (`hello1`, `A`) vẫn được nhận; URL decode `100%` vẫn hiện lỗi thô; Pipeline base64 decode chưa được nới như tab chính; decode base64 nhị phân mất dữ liệu không báo.
- **Dữ liệu:** `1e999` → `Infinity`; `\uZZZZ` → `\u0000`; key trùng bị bỏ không báo; TOML bỏ `null`; Properties bỏ mảng/object rỗng; key có dấu cách ra XML không hợp lệ; BOM làm JSON lỗi; Diff CRLF vs LF báo không khác; Regex không phân biệt nhóm không khớp với nhóm rỗng; đổi kiểu chữ sai với viết tắt (`parseHTTPResponse`), dấu câu, camelCase tiếng Việt; Text Counter: "Khoảng trắng" tính cả xuống dòng, "3.14" thành nhiều câu, từ CJK; Deduplicate sắp xếp `10 < 9`, `Đ` sau `Z`, không gộp NFC/NFD, luôn bỏ thụt lề; Markdown không hiện ảnh `data:`/`blob:`.
- **Thời gian / số:** `randomInt(0.5, 0.7)` → 1 (ngoài khoảng); ký tự tuỳ chỉnh trùng bộ đã chọn bị tăng trọng số; Test Data ngày tháng đổi theo ngày hiện tại dù "cố định theo seed"; Cron nhận `30-10`; màu hex 4/8 chữ số làm picker hiện đen, RGB/HSL mất alpha; Timesheet hạ/xoá ô có giờ đã track thì lặng lẽ quay lại.
- **API / Mock:** cookie với host là IP khớp domain sai; `Path` không có `/` đầu; `deleteEnvVar` trong script không được lưu; Mock Server body > 10 MB thành chuỗi rỗng thay vì 413.
- **Nền tảng:** tool đã gỡ/tắt vẫn nằm trong workspace như "tab ma" (tính vào giới hạn 12, đếm sai); không có số ít/số nhiều ("1 tabs", ~48 chuỗi); đóng tab cuối thì tool vẫn hiện mà không có tab; xoá workspace một cú bấm không xác nhận; plugin cài thêm có id trùng namespace cũ (`hash`, `apiclient`) có thể cài giá trị vào vault của tool có sẵn qua migration; beta "mồ côi" không có nút về Stable; nút Check/Update/Uninstall của extension không có nhãn; vault ghi lỗi lúc migration khởi động làm app không render; `devtool-favorites = "{}"` làm vỡ shell.

### i18n

- Từ điển đầy đủ: 25 file, 1.996 mục, không thiếu, không lệch `{{param}}`.
- Còn chữ tiếng Anh cứng: hộp thoại cài MCP (~15 chuỗi), Settings → Cấu hình (25 nhãn/mô tả), trường Meeting (13), `aria-label="Dismiss"`.
- Ngược lại: ~37 thông báo lỗi **chỉ có tiếng Việt** (installer.ts, registry.ts, `artifact_installer.rs`, `service_host.rs`, `secrets_vault.rs`) hiện cả trong UI tiếng Anh.

---

## Đã kiểm, ổn

- **Markdown an toàn XSS:** HTML thô, `<script>`, `<img onerror>`, SVG bị escape; `javascript:` (mọi kiểu viết) bị vô hiệu; chỉ http(s)/mailto mở ra ngoài.
- **Sandbox script của API Client:** chạy trong worker, `while(true)` bị kill khi hết giờ, không có DOM/storage, CSP chặn fetch, worker không gọi được IPC Tauri.
- **TOTP/HOTP** khớp RFC 6238/4226 (SHA-1/256/512); base32 khớp RFC 4648; migration URI của Google Authenticator đọc đúng.
- **AES-GCM, crypto-js, HMAC, bcrypt/argon2, JWT HS256/ES256** khớp Node/OpenSSL; chống alg-confusion đúng.
- **Cron** (Linux OR ngày, `L`, `#`, 29/2, `5-20/5`, CN = 0/7) khớp croner và cron-parser.
- **Lucky Wheel** dừng đúng ô, chọn bằng crypto; **UUID v4**; `randomBelow` không lệch với bound ≤ 2^32.
- **Mock Server** mặc định bind 127.0.0.1 + ::1; Rhai có giới hạn số phép tính; delay tối đa 60 s.
- **Cài plugin:** bắt buộc https, kiểm sha256 khi cài và mỗi lần nạp, giới hạn 512 MB, ghi atomic, id/bin kebab-case, chạy service cần đồng ý gắn với hash binary.
- Tool bị tắt không vào được bằng URL; deep link không bao giờ cài mà không qua dialog.
- Undo/redo (⌘Z / ⌘⇧Z) đúng ở JSON, Base64, Text Counter; phím mũi tên/số trong Network không nhảy sub-tool khi đang gõ.

## Chưa kiểm chứng (chỉ đọc code)

- Checksum "Browse" trên desktop có thể luôn lỗi: đường dẫn từ `pickOpen` không được thêm vào `DroppedPaths`, Rust trả DENIED, UI chỉ báo lỗi chung (`checksum.rs:19`, `ChecksumTool.tsx:99-104`).
- `mock_start` khi đang chạy (gọi được từ MCP) có thể vướng EADDRINUSE và dừng hẳn.
- Mock Server không xử lý CORS/OPTIONS.
- Cookie từ các response redirect trung gian không vào jar.
- Xuất CSV của Runner không chặn công thức (`=`, `+`, `@`).
- Kết quả Verify JWT vẫn xanh sau khi đổi key; tone "hết hạn sau N phút" không tự cập nhật.
- "Lần chạy tới" của Cron không tự làm mới khi để tool mở lâu.
- `store.save()` bất đồng bộ lúc đóng cửa sổ có thể mất lần ghi cuối.
- Steam token (`encoder=steam`) bị đọc như TOTP 6 số.
- Mỗi phím gõ ở AES-GCM chạy một PBKDF2 600k vòng không huỷ được.

## Đề xuất thứ tự sửa

1. **S1–S3 (cài plugin)** — trước khi phát hành bản có Marketplace/beta channel.
2. **Formatter đổi nội dung** (SQL #9–10, JSON #11–13, Data Converter #14–15, Diff #16) — người
   dùng tin kết quả nên mất mát âm thầm; mỗi lỗi sửa gọn trong một file.
3. **Thời gian** (#4–8) và **API Client** (#17–21).
4. **Một dòng là xong:** SHA-3 (#1), treo khi random (#2), sort ASCII (#3), prototype pollution
   (S4), `Array.isArray` cho favorites, tìm kiếm bỏ dấu tiếng Việt.
5. P2/P3 còn lại theo tool, kèm test cho từng lỗi (phần lớn đã có sẵn repro).

---

## MCP (devtool-mcp-server + bridge + API Client tools)

Kiểm thêm theo yêu cầu: chạy `devtool-mcp-server` thật qua stdio (JSON-RPC), không có app và
với một bridge giả đúng định dạng `/tools`·`/call` của `mcp_bridge.rs`; phía webview chạy các
handler với `useApiStore` + `useApiRunner` thật (chỉ mock IPC Tauri).

| # | Mức | Vấn đề | Chỗ |
|---|---|---|---|
| M1 | P1 | Server không khai `tools.listChanged`, không bao giờ gửi `notifications/tools/list_changed`: Claude Code mở trước app (hoặc trước khi tool/plugin đăng ký) chỉ thấy `get_scripting_reference` cả phiên. | `bin/devtool-mcp-server.rs` |
| M2 | P1 | Công tắc MCP (Background bridge, Per-tool access) là `usePersistentState` riêng từng component: `devtool_mcp_set_background`/`set_tool_enabled` báo ok mà không có tác dụng tới khi khởi động lại; Settings ghi đè thay đổi của client; bật nền lúc đang chạy làm API Client/Mock Server không trả lời ở đâu cả. | `useMcpBackgroundBridge.ts`, `useMcpToolEnabled.ts` |
| M3 | P1 | `add_environment` có `name`/`variables` trả id của environment không tồn tại (cùng gốc với #17). | `useEnvSecrets.ts` |
| M4 | P1 | `run_request` trả nguyên giá trị vault/biến secret mà server echo lại (URL cuối có API key, body, header, log, test). | `apiclient/mcpBridge.ts` |
| M5 | P2 | `update_request` trả bản trước khi patch; đổi URL không cập nhật bảng params nên không có tác dụng. | `apiclient/mcpBridge.ts` |
| M6 | P2 | `run_request`: `environmentId` sai id chạy im lặng không env; ép env collection làm mất env global; kết quả không vào History dù mô tả nói có. | `useApiRunner.ts` |
| M7 | P2 | `create_request`/`add_folder`/`set_node_headers`/`move_item`/`copy_item`/`set_active_environment` báo thành công với id không tồn tại; gọi song song ghi đè nhau. | `apiclient/mcpBridge.ts` |
| M8 | P2 | Tool chưa ai đăng ký chờ đủ 30 s rồi báo sai lý do; tham số > 2 MB lỗi "non-JSON response (HTTP 413)". | `mcp_bridge.rs` |
| M9 | P2 | `hash_compute`/`hash_hmac`/`codec_*` từ chối chuỗi rỗng. | `codecMcpBridge.ts` |
| M10 | P2 | `.mcp.json` chạy `cargo run --release` cho cả crate Tauri: lần đầu biên dịch nhiều phút (Linux cần WebKitGTK), lâu hơn thời gian client chờ → "Connection closed". Tài liệu ghi "vài giây". | `.mcp.json`, `docs/human/mcp-server.md` |
| M11 | P2 (bảo mật) | `sdk.native.listen` không có allowlist sự kiện: plugin có quyền `native` đọc được mọi `mcp:call` (kể cả `key` của `encrypt_text`), trả lời giả trước, và đăng ký/xoá tool dưới `pluginId` khác; trùng tên tool không bị phát hiện. | `platform/sdk.ts`, `mcp_bridge.rs` |
| M12 | P3 | `get_scripting_reference` lệch sandbox vài chỗ (`req.*` có ở mọi phase; `pm.environment.get` rơi xuống env global). | `bin/devtool-mcp-server.rs` |

Đã kiểm, đúng: mỗi tool quảng bá đều có handler và ngược lại; enum khớp; token so sánh hằng
thời gian; envelope `{result}`/`{error}` → `isError`; timeout bridge 30 s < server 35 s; khi
không có app, server trả lỗi rõ ràng và `get_scripting_reference` vẫn trả lời.

---

## Đã sửa trên nhánh này

Mỗi mục có test (vitest; Rust cho installer/bridge — crate biên dịch được trong container sau
khi cài WebKitGTK). Cuối cùng: `tsc` sạch, vitest 146 file / 1 621 test, `cargo test`
`artifact_installer` 39/39, `mcp_bridge` 2/2. Kiểm lại trên bản build: Unix Time (0 lần ghi
store khi đứng yên, giữ vùng chọn, giữ timestamp qua chuyển tool/tải lại), SQL formatter.

| Commit | Sửa |
|---|---|
| `76532e4` | S1 `version`/`market_id` chỉ là một đoạn đường dẫn; không xoá qua version không an toàn trong index cũ. S2 Rust từ chối manifest khác bản đã xem trước; Update đi qua dialog. S3 dialog/ô dán URL hiện nguồn, `hosts`, bản bị thay, quyền/host mới, bắt tick xác nhận khi hạ cấp hoặc đổi nguồn. |
| `5072e96` | S4, #9–#16: properties (`__proto__`, `1.10`, key vừa là giá trị vừa là tiền tố), XML không đổi giá trị, YAML merge key, JSON (nháy cong, `__proto__`, số > 2^53), SQL (từ khoá đầu từ, comment giữ xuống dòng, `$$`), Diff JSON không ghi đè văn bản. |
| `937b22a` | #1 SHA-3 FIPS 202 (+ Keccak-256 đúng tên), #2 random > 2^32 không treo, khoảng không có số nguyên báo lỗi, #3 sort ASCII. |
| `538bddd` | #4–#7 + P2 Date/Time: giữ giá trị đã nhập, không ghi store mỗi giây, offset tường minh, DST hai lượt, timestamp mọi độ dài, tuần ISO, đổi múi giờ input. |
| `eb4d0f5` | #8 Cron giữ Quartz/Spring; diễn giải không bỏ điều kiện ngày. |
| `18057c6` | S5 khoá bước Pipeline vào vault (có migration), #22 nội dung Encrypt vào vault. |
| `294f9e5` | M1 `listChanged` + poll bridge 3 s; M10 sửa tài liệu (đề xuất tách crate ở dưới). |
| `8700991` | #17/M3 ghi env cùng tick, #18 Runner truyền biến giữa request, M2 công tắc MCP dùng chung (`useSharedSetting`), M4 che kết quả `run_request` + ghi History, M5–M7. |
| `4de4673` | #19 không mã hoá hai lần, path param có gạch nối, #20 GET/HEAD: cảnh báo + code sinh ra khớp, #21 + P2 import curl. |
| `6e43ef3` | M8 tool chưa đăng ký trả lỗi ngay, giới hạn body 64 MB + lỗi JSON; M9 chuỗi rỗng. |

**Còn lại / cần quyết định**

- **M10 — tách `devtool-mcp-server` ra crate riêng** (chỉ `rmcp`/`tokio`/`serde`): build vài
  chục giây, không cần WebKitGTK, `.mcp.json` dùng được ngay lần đầu. Đụng `scripts/sidecar.mjs`,
  release và CI nên chưa làm.
- **M11** — routing `mcp:call` theo plugin sở hữu và ràng `pluginId` vào plugin gọi: thay đổi
  ở tầng SDK/bridge, cần thiết kế.
- GET có body (#20) chỉ gửi được nếu có lệnh Rust riêng (fetch của plugin-http từ chối).
- P2/P3 của các tool còn lại (Regex `u` + emoji, Text Counter grapheme, QR > 125 KB, Calendar
  DST, Postman import/export, Mock Server header lỗi trả 200 rỗng, tìm kiếm tiếng Việt, …)
  chưa sửa.
