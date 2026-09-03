import { useCallback, useEffect, useRef, useState } from 'react';

// 130ms = `--dur-exit` trong `design/tokens.css`. Trùng lặp con số ở đây thay
// vì đọc CSS lúc chạy: nó chỉ quyết định khi nào panel được phép rời DOM
// (animation đã chạy xong từ trước), nên lệch vài ms là vô hại.
const EXIT_MS = 130;

/**
 * Trạng thái mở/đóng CÓ ANIMATION RA cho một popover tự quản lý `open` của
 * chính nó — `ColorPicker`, `DatePicker`, `TimePicker` đều là kiểu này (khác
 * `DropdownMenu`/`ModalShell`/`ContextMenu`, nơi CHA sở hữu `open`).
 *
 * Cả ba trước đây render panel kiểu `{open && <div>…</div>}` và KHÔNG CÓ animation
 * nào — không vào, không ra, panel bật/tắt trong một khung hình. Đây là hình
 * thức thứ tư của đúng một lỗi: xem `dropdown-menu.tsx`, `modal-shell.tsx`,
 * `context-menu.tsx` để biết vì sao nó luôn xảy ra ở dạng "mount có điều
 * kiện" — và rút ra hook thay vì chép lại 15 dòng lần thứ tư.
 *
 *   const { visible, closing, open, show, close, toggle } = useAnimatedOpen();
 *   const wrapRef = useDismissable(open, close);
 *   <button onClick={toggle}>…</button>
 *   {visible && (
 *     <div className={closing ? 'motion-safe:animate-pop-out' : 'motion-safe:animate-pop-in'}>
 *   )}
 *
 * `open` là trạng thái LOGIC (còn tương tác được, `useDismissable` còn lắng
 * nghe click-ngoài/Escape); `visible` là trạng thái DOM (còn render, vì đang
 * chạy animation ra). Panel luôn dùng `visible`, không bao giờ dùng `open`.
 */
export function useAnimatedOpen(initial = false) {
  const [open, setOpen] = useState(initial);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const show = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setClosing(false);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen((was) => {
      if (!was) return was;
      if (timerRef.current) clearTimeout(timerRef.current);
      setClosing(true);
      timerRef.current = setTimeout(() => setClosing(false), EXIT_MS);
      return false;
    });
  }, []);

  // Đóng rồi mở lại nhanh (trong đúng cửa sổ 130ms) phải huỷ animation ra dở
  // dang chứ không để nó chạy tiếp bên dưới cái mới — `show()` đã tự làm việc
  // đó (huỷ timer, tắt `closing`) nên không cần thêm gì ở đây.
  const toggle = useCallback(() => { if (open) close(); else show(); }, [open, close, show]);

  return { open, closing, visible: open || closing, show, close, toggle };
}
