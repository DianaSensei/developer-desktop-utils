# Experience log

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
