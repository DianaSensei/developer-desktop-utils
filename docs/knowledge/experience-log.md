# Experience log

## [2026-08-20] container tool — bollard 0.21's `SystemDataUsageResponse` silently drops the per-item lists the raw Docker API returns
- Nguyên nhân: cần hiển thị dung lượng (Size) từng volume ở VolumesView. Kế hoạch ban đầu là
  tái dùng `container_system_df` (đã có sẵn, gọi `bollard::Docker::df()`) — Docker Engine API
  thật `/system/df` trả về cả `LayersSize`, `Images[]`, `Containers[]`, `Volumes[]` (mỗi phần
  tử volume có `UsageData.Size`), và `Docker`'s `SystemDataUsageResponse` FE type trong
  `types.ts` (viết từ trước, không do session này tạo) đã giả định đúng shape đó
  (`LayersSize?`, `Images?: ImageSummary[]`, ...). Nhưng `bollard-stubs 1.53.1-rc.29.3.1` (bản
  bollard 0.21 dùng) định nghĩa `SystemDataUsageResponse` KHÁC hẳn: chỉ có 4 field tổng hợp
  (`ImageUsage`/`ContainerUsage`/`VolumeUsage`/`BuildCacheUsage`, mỗi field là
  `{ActiveCount, TotalCount, Reclaimable, TotalSize}`) — không có field `Volumes`/`Images`
  nào chứa danh sách từng phần tử. serde bỏ qua field lạ trong JSON khi deserialize (không
  báo lỗi), nên nếu daemon Docker thật vẫn trả `Volumes: [...]` trong JSON, nó bị ÂM THẦM
  vứt bỏ ngay tại bước deserialize — không có exception, không cảnh báo, kết quả Rust chỉ là
  `None`/rỗng ở field không tồn tại đó. Vì `containerApi.systemDf` chưa được gọi ở bất kỳ đâu
  trong FE trước session này (`OverviewView.tsx` dùng `systemInfo`, không dùng `systemDf`),
  bug shape-mismatch này chưa từng bị phát hiện dù đã tồn tại từ trước.
- Số lần thử: 1/1 — phát hiện chủ động bằng cách đọc thẳng source `bollard-stubs` trong
  `~/.cargo/registry` (`grep -n "pub struct SystemDataUsageResponse"`) trước khi viết code
  dựa theo field name đoán từ tài liệu Docker API hoặc từ TS type có sẵn, đúng lúc nhận ra TS
  type cũ không khớp gì với Rust struct thật.
- Kết quả: Đã fix — bỏ hẳn hướng lấy Size volume qua `container_system_df`. Thêm command mới
  `volume_sizes` (chỉ `#[cfg(unix)]`) gọi thẳng `/system/df?type=volume` qua HTTP thô trên
  cùng Unix socket mà `bollard::Docker` đang dùng — tái sử dụng `hyperlocal`/`hyper-util`/
  `http-body-util` (đã có sẵn dạng transitive dep qua feature "pipe" của bollard, chỉ cần khai
  báo lại làm dependency trực tiếp trong `Cargo.toml`, không kéo thêm version mới nào — xem
  diff `Cargo.lock` chỉ +5 dòng) — rồi tự đọc `Volumes[].Name`/`Volumes[].UsageData.Size` từ
  `serde_json::Value` thô thay vì ép vào struct bollard đã biết là thiếu field. Đồng thời sửa
  luôn TS type `SystemDataUsageResponse` cho khớp shape THẬT (4 field tổng hợp) — dù vẫn chưa
  nơi nào dùng — để không để lại type sai làm bẫy cho lần sau.
- Bài học chung: một dependency dùng chung một cái tên "giống hệt" tài liệu API public
  (`SystemDataUsageResponse`, `docker system df`) không có nghĩa là field bên trong khớp với
  tài liệu đó — client library có thể chỉ map một tập con field mà tác giả binding thấy cần,
  và serde IM LẶNG bỏ field JSON không khớp thay vì báo lỗi. Trước khi viết code Rust dựa theo
  field name của một struct từ crate ngoài (đặc biệt struct ứng với JSON của API bên thứ ba),
  luôn `grep` thẳng source đã tải về trong `~/.cargo/registry` để xác nhận field thật, đừng
  suy đoán từ tên struct hay từ một TS type có sẵn — TS type đó có thể ĐÃ SAI từ trước và
  chưa ai phát hiện chỉ vì chưa có chỗ nào thực sự gọi tới nó.

## [2026-08-20] container tool — a `<p>` wrapping block-level content silently corrupts the DOM instead of erroring
- Nguyên nhân: `DetailField` (component dùng chung cho ContainerDetailsDialog/
  ImageDetailsDialog, hiển thị một cặp nhãn/giá trị) ban đầu bọc `value` trong `<p
  className="text-xs break-words">{value}</p>`. Với các trường text thuần (Created, Status…)
  không sao, nhưng "All tags"/"Exposed ports" truyền vào một `<div className="flex flex-wrap
  gap-1">` chứa nhiều `<Badge>` — tức nội dung block-level lồng trong `<p>`. HTML spec không
  cho phép `<p>` chứa flow content như `<div>`; trình duyệt tự động ĐÓNG `<p>` sớm ngay trước
  `<div>` con và đẩy phần còn lại ra ngoài — không phải lỗi JS, không cảnh báo React runtime
  rõ ràng nào bắt buộc phải thấy ngay (React 18 chỉ log hydration warning khi SSR, ứng dụng
  Tauri này thuần CSR nên có thể không log gì cả) — chỉ lộ ra khi NHÌN THẬT layout render (căn
  lề vỡ, badge tràn ra ngoài vị trí đáng lẽ).
- Số lần thử: 1/1 — phát hiện bằng cách tự đọc lại JSX vừa viết theo đúng nghĩa đen của cấu
  trúc thẻ (đặt câu hỏi "component con nào có thể render ra div/block-level rồi lồng vào đây
  không") thay vì chỉ tin tưởng `npm run build` xanh — TypeScript/Vite hoàn toàn không bắt
  được lớp lỗi này vì nó hợp lệ về mặt cú pháp JSX, chỉ sai về ngữ nghĩa HTML.
- Kết quả: Đã fix — đổi `<p>` bọc ngoài `value` thành `<div>` trong `DetailRows.tsx`.
- Bài học chung: bất kỳ component dùng chung nào nhận `value: ReactNode` (không phải
  `string`) và tự bọc nó trong `<p>` đều là một quả bom hẹn giờ — sớm muộn sẽ có caller
  truyền vào JSX (Badge, div, list) mà `<p>` không được chứa hợp lệ. Ưu tiên bọc bằng `<div>`
  trừ khi bản thân component đã ép kiểu `value` về `string`/`ReactNode` thuần văn bản; và khi
  review code hiển thị dữ liệu tuỳ ý, luôn tự hỏi phần tử bọc ngoài có hợp lệ với MỌI loại nội
  dung caller có thể truyền vào hay không, chứ không chỉ với case đầu tiên mình test bằng mắt.

## [2026-08-20] container tool — `cargo check` on Linux CAN be unblocked by installing GTK/WebKit dev libs as root
- Nguyên nhân: một entry log trước đó (redis-tool, cùng ngày) khẳng định "sandbox này không
  dựng được toàn bộ Tauri app trên Linux vì thiếu GTK/WebKit system libs" và né tránh bằng
  cách viết crate scratch riêng ngoài `src-tauri`. Khi thêm tính năng mới cho container tool
  (multi-select bulk actions, compose "Down", sort cột, mở rộng `~` cho socket path trong
  `container_tool.rs`), `cargo check` thất bại ngay ở bước build `gdk-sys` với lỗi pkg-config
  không tìm thấy `gdk-3.0`.
- Số lần thử: 1/1 — trước khi chấp nhận lại giới hạn "không compile được", đã thử
  `apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
  librsvg2-dev libsoup-3.0-dev` (session chạy với uid=0/root, có `apt-get`/`sudo`) trước khi
  bỏ cuộc.
- Kết quả: Đã fix — `cargo check` compile sạch toàn bộ crate (kể cả `container_tool.rs`,
  `redis_tool.rs`, `rabbit.rs`, `kafka.rs`, ...) không còn lỗi/cảnh báo.
- Cách fix: cài các Tauri Linux build deps chuẩn (GTK3, WebKit2GTK 4.1, libayatana-appindicator3,
  librsvg2, libsoup-3.0) bằng `apt-get` trước khi chạy `cargo check`/`cargo build`. `npm run
  build` (frontend) không cần bước này — nó luôn chạy được độc lập.
- Bài học chung: đừng coi một giới hạn môi trường ghi trong log trước là vĩnh viễn đúng cho
  mọi session — nếu session hiện tại chạy quyền root và có `apt-get`, hãy thử cài system
  dependency còn thiếu (chi phí một lần cài, ~1-2 phút) trước khi né tránh bằng cách không
  compile-test code Rust thật. Xác minh bằng compile thật luôn đáng tin hơn đọc code tĩnh,
  đặc biệt với thay đổi Rust có thể có lỗi type/borrow không lộ ra khi chỉ đọc diff.

## [2026-08-14] api-client — placeholder/hint rendering broken across CodeSurface editors
- Nguyên nhân: `CodeSurface` (`code-editor-base.tsx`, dùng cho JsonEditor/JavaScriptEditor/
  TextEditor — tức Body JSON, Script pre/post-request, Tests, GraphQL query/variables) tự vẽ
  placeholder bằng một `<div>` absolutely-positioned (`left-9 top-2`) đè lên editor, thay vì
  dùng extension `placeholder()` có sẵn của CodeMirror. Hệ quả: (1) placeholder nhiều dòng
  (vd body JSON `'{\n  "key": "value"\n}'`, script snippet có `\n`) bị whitespace-normal của
  div gộp hết `\n` thành khoảng trắng, hiện thành một dòng dính chữ; (2) vị trí `left-9`
  đoán mò không khớp với vị trí caret thật của CodeMirror (đặc biệt khi có lint gutter chiếm
  thêm chỗ), nên khi field trống và đang focus, placeholder giả và caret thật chồng lên nhau
  lệch nhau, nhìn như chữ bị vỡ/đè lên nhau. Cùng lúc đó, `jsonParseLinter()` (dùng cho
  JsonEditor) coi document rỗng ("") là JSON không hợp lệ, nên field JSON trống — chưa gõ gì
  — đã hiện marker lỗi đỏ ở gutter ngay từ đầu, cộng dồn vào cảm giác "vỡ layout". Trong khi
  đó `InlineCodeField` (URL bar) đã làm đúng bằng `placeholder()` thật của
  `@codemirror/view` — hai cơ chế implement khác nhau cho cùng một khái niệm "placeholder"
  trong cùng codebase, một cái đúng một cái tự chế, không ai đối chiếu.
- Số lần thử: 1/5
- Kết quả: Đã fix
- Cách fix: bỏ hẳn `<div>` placeholder tự chế trong `CodeSurface`, dùng
  `placeholder as cmPlaceholder` từ `@codemirror/view` (giống hệt `InlineCodeField`), thêm
  style `.cm-placeholder` dùng chung vào `codeTheme()` (`code-theme.ts`) để mọi editor nhất
  quán. Bọc `jsonParseLinter()` trong `code-editor.tsx` để trả về `[]` khi
  `view.state.doc.length === 0`, tránh báo lỗi trên field JSON còn trống.
- Bài học chung: khi một component "tự chế" lại một cơ chế mà thư viện cốt lõi (ở đây là
  CodeMirror) đã cung cấp sẵn (placeholder, gutter, v.v.), luôn có nguy cơ nó bỏ sót các case
  thư viện đã xử lý đúng (multi-line, alignment với caret thật, resize theo nội dung...).
  Nếu trong cùng codebase đã có một chỗ khác dùng đúng cơ chế gốc của thư viện cho cùng một
  nhu cầu (ở đây là `InlineCodeField`), đó là tín hiệu mạnh nên đối chiếu và thống nhất theo
  cách làm đúng thay vì giữ bản tự chế.

## [2026-08-14] api-client — sandbox worker "degraded" state was permanent for the whole session
- Nguyên nhân: `scriptHost.ts`'s `getWorker()` cached `workerUsable = false` forever after a
  single `Worker` construction/load failure (a transient bundling hiccup, a CSP block, a
  browser quirk — anything, one-shot). Every script after that point — including a genuine
  infinite loop — ran unsandboxed on the main thread with no timeout/interrupt for the rest
  of the session, since a synchronous loop can only be stopped by `Worker.terminate()`.
- Số lần thử: 1/5
- Kết quả: Đã fix
- Cách fix: added a 30s reprobe window (`REPROBE_INTERVAL_MS`) — `workerUsable === false` is
  now re-checked periodically instead of being final; `getWorker()` retries construction once
  the window elapses. Also exposed `isScriptSandboxDegraded()`/`subscribeSandboxStatus()` so
  the UI (`StatusBar.tsx`) can show a visible warning while running unsandboxed, instead of the
  degradation being silent.
- Bài học chung: any "if X fails once, disable the safety mechanism for the rest of the
  session" pattern is a latent single-point-of-failure — a one-time construction/load failure
  is not evidence the resource will never work again. Prefer a bounded retry/reprobe window,
  and if the safety mechanism can't be restored, at least surface that fact in the UI rather
  than letting the degradation be invisible.

## [2026-08-14] api-client — activeEnvId not scoped to the active collection could silently apply the wrong (or no) variables
- Nguyên nhân: `store.ts` kept a single global `activeEnvId`; nothing cleared or re-validated
  it when the user switched to a request in a different collection, so a collection-A-scoped
  environment could stay "active" while sending requests in collection B — `executeRequest`
  would happily substitute {{}} tokens from an environment that had nothing to do with the
  request being sent, with no indication in the UI that anything was off.
- Số lần thử: 1/5
- Kết quả: Đã fix
- Cách fix: `store.ts`'s `activeEnv` memo now resolves to `null` (not the mismatched
  environment) whenever the selected environment is scoped to a collection different from
  `activeCollectionId`; the raw selection (`activeEnvId`/`selectedEnv`) is preserved so the UI
  can still show it. `RequestTabs.tsx` surfaces this as a warning icon + an "Inactive here"
  group in the environment picker instead of leaving the mismatch invisible.
- Bài học chung: when a single piece of global state (like "the active X") interacts with a
  second piece of state that can independently change scope (like "the active collection"),
  always ask what happens when they drift apart — silently keeping the stale selection "active"
  and never re-validating it against the new scope is an easy, easy-to-miss trap.

## [2026-07-11] onboarding-flow — 2 dialog tự mở chồng nhau ở lần cài mới
- Nguyên nhân: `OnboardingFlow` (global, tự hiện cho user mới) và `ToolGuideModal` per-tool
  "what's new" (tự hiện khi mở 1 tool lần đầu) đều lắng nghe điều kiện độc lập nhau. Với
  user cài mới, cả 2 điều kiện đúng cùng lúc ngay ở lần render đầu tiên → 2 Radix Dialog
  chồng lên nhau (2 lớp overlay, focus-trap rối).
- Số lần thử: 1/5
- Kết quả: Đã fix
- Cách fix: thêm điều kiện chặn ở `useEffect` auto-show per-tool guide trong `AppContent`
  (`src/App.tsx`) — không tự mở guide per-tool khi `useOnboarding().show === true`; effect
  phụ thuộc thêm vào `onboardingShowing` nên tự chạy lại ngay khi onboarding đóng.
- Bài học chung: khi có ≥2 cơ chế "tự mở dialog theo điều kiện riêng" trong cùng 1 app,
  luôn phải rà lại kịch bản chúng đúng đồng thời (đặc biệt ở trạng thái "mới nhất" — cài
  mới, lần đầu — vì đó là lúc nhiều điều kiện "lần đầu" cùng true nhất).

## [2026-07-11] onboarding-flow — pre-check tool bị stale khi reopen từ Settings
- Nguyên nhân: `OnboardingFlow` là component mount 1 lần duy nhất cho vòng đời app (không
  unmount/remount theo `show`), nhưng state `selected`/`step` lại được khởi tạo bằng
  `useState(() => ...)` — chỉ chạy ở lần mount đầu tiên. Mở lại từ Settings sau khi user đã
  đổi feature toggle không làm state này refresh, và step luôn kẹt ở giá trị cũ (vd 'done'
  nếu vừa hoàn tất lần trước).
- Số lần thử: 1/5
- Kết quả: Đã fix
- Cách fix: thêm `useEffect` phụ thuộc `[show]` để re-sync `step` (nhảy thẳng 'tools' nếu
  `completed === true`, tức đây là lần reopen chứ không phải lần đầu) và `selected` (tính
  lại từ `isFeatureEnabled`/`isFavorite` hiện tại) mỗi khi dialog chuyển sang `show === true`.
- Bài học chung: với component "singleton" mount suốt vòng đời app nhưng có UI dạng
  dialog ẩn/hiện nhiều lần (không unmount), KHÔNG dùng lazy initializer của `useState` cho
  state cần tươi mỗi lần mở lại — phải dùng `useEffect` theo dõi tín hiệu "vừa mở" để re-sync.

## [2026-08-14] diff-tool — phím tắt nhảy chunk (Alt+↑/↓) không bao giờ chạy
- Nguyên nhân: `DiffMergeView.tsx` tự bind `keymap.of([{key:'Alt-ArrowDown', run: goToNextChunk}, ...])`
  để nhảy giữa các đoạn thay đổi, nhưng `codemirror`'s `basicSetup` (được include TRƯỚC
  keymap này trong mảng extensions) đã sẵn bind `Alt-ArrowUp/Down` cho `moveLineUp`/
  `moveLineDown` qua `@codemirror/commands`'s `defaultKeymap`. CodeMirror duyệt các
  `keymap.of(...)` theo đúng thứ tự xuất hiện trong extensions array (cùng precedence) —
  binding liệt kê trước thắng, nên `moveLineUp/Down` luôn chạy trước và "nuốt" mất phím,
  `goToNextChunk`/`goToPreviousChunk` không bao giờ được gọi tới dù code hoàn toàn hợp lệ
  và build/tsc pass sạch (bug loại này build không bắt được, chỉ lộ ra khi bấm thử tay).
- Số lần thử: 1/5 (phát hiện qua rà soát chủ động `basicSetup`'s source, không phải qua bug
  report — session trước đó ship code này mà không biết đã có xung đột).
- Kết quả: Đã fix
- Cách fix: đổi phím sang `F7`/`Shift-F7` (không đụng bất kỳ binding nào khác trong
  `basicSetup`/`@codemirror/commands`/`@codemirror/search`), đồng thời ghi lại bảng đầy đủ
  các phím `basicSetup` đã chiếm sẵn vào `docs/ai/CLAUDE.md` để tránh lặp lại.
- Bài học chung: trước khi tự bind một phím tắt mới vào bất kỳ editor nào dùng
  `codemirror`'s `basicSetup` (hầu hết editor trong app này), PHẢI kiểm tra
  `defaultKeymap`/`searchKeymap`/`closeBracketsKeymap`/`foldKeymap`/`completionKeymap`/
  `lintKeymap` xem phím đó đã bị chiếm chưa — basicSetup bao gồm nhiều hơn vẻ ngoài của nó
  (toggle comment, move/duplicate line, select-next-occurrence, delete line, jump-matching-
  bracket, search panel đều đã có sẵn). Loại conflict này im lặng hoàn toàn: không lỗi
  runtime, không lỗi build, editor vẫn "hoạt động" — chỉ là chạy nhầm lệnh khác, nên
  reviewer/AI code review dựa trên đọc code tĩnh rất dễ bỏ sót, phải test tay bằng phím
  thật hoặc đọc kỹ thứ tự extensions + tài liệu upstream.

## [2026-08-20] redis-tool — serde internally-tagged enum panics at runtime (not compile time) on a tuple/newtype variant of a primitive
- Nguyên nhân: `redis_tool.rs`'s `RedisReply` enum (mirrors `redis::Value` for the CLI Console
  và key-editor mutations, gửi qua Tauri IPC dưới dạng JSON) ban đầu dùng
  `#[serde(tag = "kind")]` (internally tagged) với các variant kiểu tuple chứa giá trị nguyên
  thủy — `Int(i64)`, `Bulk(String)`, `Array(Vec<RedisReply>)`, `Error(String)`. `cargo check`
  compile sạch không báo lỗi gì. Chỉ khi thực sự serialize (`serde_json::to_string`) mới panic
  runtime: `"cannot serialize tagged newtype variant RedisReply::Int containing an integer"`.
  Lý do: serde's internally-tagged representation yêu cầu nội dung mỗi variant phải tự
  serialize thành JSON object (map) để gắn thêm field tag vào — một variant tuple chứa
  primitive/String/Vec thì không serialize ra object được, nên serde từ chối ở runtime thay vì
  báo lỗi ở compile time (derive macro không biết trước output shape của field type).
- Số lần thử: 1/5 (phát hiện chủ động bằng cách viết crate scratch riêng ngoài `src-tauri` để
  compile-test logic Redis thật — sandbox này không dựng được toàn bộ Tauri app trên Linux vì
  thiếu GTK/WebKit system libs — và viết `#[test]` gọi `serde_json::to_string` thật cho từng
  variant trước khi tin tưởng shape JSON khớp với type TypeScript phía frontend).
- Kết quả: Đã fix
- Cách fix: đổi sang adjacently-tagged: `#[serde(tag = "kind", content = "data")]` — hoạt động
  với MỌI variant shape (tuple, newtype primitive, struct), ra `{"kind":"Int","data":5}` thay
  vì lỗi. Đồng thời phát hiện thêm: `#[serde(rename_all = "camelCase")]` đặt ở CẤP ENUM chỉ đổi
  tên variant tag (`String` → `"string"`), KHÔNG tự động áp dụng xuống field bên trong struct
  variant (`ttl_ms` vẫn ra `"ttl_ms"`, không phải `"ttlMs"`) — phải thêm `rename_all` riêng cho
  từng struct variant (`KeyValue::String { .. }`, `::Hash { .. }`, v.v.) mới đổi được tên field.
  Verify cả hai bằng test thật (`serde_json::to_string`) trước khi khớp type TS, không suy đoán
  từ đọc doc.
- Bài học chung: derive `Serialize` compile được KHÔNG có nghĩa là serialize được — với enum
  gắn tag (internally/adjacently tagged) và với `rename_all`, chỉ có chạy thật
  `serde_json::to_string` trên từng variant mới lộ ra shape JSON thật. Khi Rust struct/enum có
  tag phải khớp 1-1 với type ở phía TypeScript/frontend (Tauri IPC, hay bất kỳ ranh giới JSON
  nào), luôn viết một test nhỏ in ra JSON thật của từng variant trước khi viết type phía kia,
  thay vì đoán theo tên field/derive attribute.
