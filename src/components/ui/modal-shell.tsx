import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Centered modal chrome — backdrop, panel, labelled header, close button.
 *
 * The connection forms and info modals in the broker tools each hand-rolled
 * this, and each copy was missing a different part of what makes a dialog a
 * dialog: no `role`/`aria-modal`, no accessible name, an unlabelled `<X>`
 * close button, Escape doing nothing, and focus free to wander into the page
 * behind the overlay. Those are the pieces this centralises, so a tool only
 * has to supply its title and body.
 *
 * Radix `Dialog` (`ui/dialog.tsx`) remains the right choice for a dialog with
 * a trigger element. These modals are rendered conditionally by their parent
 * with no trigger to bind to, which is the case this covers.
 *
 * ── Vì sao có animation vào mà không có animation ra ────────────────────────
 * Đây là 7 form kết nối/info modal của mọi broker trong app (Kafka, RabbitMQ,
 * Redis, Container) — và tất cả đều được cha mount kiểu `{open && <Form/>}`.
 * Khi `onClose` gọi `setOpen(false)`, React gỡ `ModalShell` khỏi cây NGAY LẬP
 * TỨC — chưa kịp phát khung hình animation nào. Kết quả: mở ra thì mượt
 * (`fade-in` + `zoom-in-95`), đóng thì BIẾN MẤT, đúng lỗi từng có ở
 * `DropdownMenu` trước khi sửa (xem ghi chú ở đó).
 *
 * `ModalShell` không sở hữu biến `open` — cha nó sở hữu — nên hướng sửa phải
 * NGƯỢC với DropdownMenu: thay vì tự trì hoãn việc gỡ khỏi DOM, nó phải trì
 * hoãn việc BÁO cho cha biết là đã đóng. Mọi đường đóng (Escape, bấm ra ngoài,
 * nút X) đi qua `requestClose()`: bật `closing` để panel chạy animation ra
 * ngay, rồi mới gọi `onClose` thật sau `--dur-exit` — lúc đó cha mới gỡ nó, và
 * animation đã kịp chạy xong.
 */
export interface ModalShellProps {
  /** Called on Escape, backdrop click, and the header close button. */
  onClose: () => void;
  /** Accessible name for the dialog. Rendered as the header heading. */
  title: ReactNode;
  /** Optional supporting line under the title. */
  description?: ReactNode;
  /** Optional sticky footer row. */
  footer?: ReactNode;
  /** Tailwind max-width for the panel. */
  width?: string;
  className?: string;
  /** Extra classes for the scrollable body region. */
  bodyClassName?: string;
  /** Darker scrim, for modals that need to read as a stronger interrupt. */
  scrim?: 'default' | 'strong';
  /** Vertical placement. `top` sits the panel below the viewport top edge. */
  align?: 'center' | 'top';
  /** Extra classes for the backdrop — a z-index override, an extra blur. */
  overlayClassName?: string;
  children: ReactNode;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ModalShell({
  onClose,
  title,
  description,
  footer,
  width = 'max-w-md',
  className,
  bodyClassName,
  scrim = 'default',
  align = 'center',
  overlayClassName,
  children,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // Keep the latest handler without re-binding the key listener each render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 130ms = `--dur-exit`. Chạy animation trước, rồi mới báo cho cha — cha gỡ
  // component ngay khi `onClose` chạy, nên gọi sớm hơn là cắt animation giữa
  // chừng.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    // Dọn timer nếu chính component bị gỡ vì lý do khác (route đổi, StrictMode
    // double-invoke lúc dev) trước khi kịp tự bắn — nếu không, `onClose` gọi
    // vào một cha đã unmount thì vô hại nhưng vẫn là một timer treo lơ lửng.
    timerRef.current = setTimeout(() => closeRef.current(), 130);
  }, []);

  // Escape closes, and Tab cycles inside the panel instead of walking into the
  // page behind the overlay — the part `aria-modal` describes but cannot make
  // the browser enforce.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Focus the panel itself on open — not its first field, which would start
  // typing somewhere the user never chose — and hand focus back to whatever had
  // it on close, so dismissing doesn't drop the caret at the top of the page.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    // Trả tiêu điểm lại sau khi component THẬT SỰ bị gỡ (cleanup này chạy lúc
    // đó, không phải lúc `closing` bật) — nên trình đọc màn hình không nhảy
    // tiêu điểm ngay giữa lúc panel còn đang mờ dần.
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center p-4',
        align === 'top' ? 'items-start pt-[10vh]' : 'items-center',
        scrim === 'strong' ? 'bg-black/60' : 'bg-black/40',
        closing
          ? 'pointer-events-none motion-safe:animate-out motion-safe:fade-out-0 motion-safe:duration-exit motion-safe:ease-in-soft'
          : 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-fast motion-safe:ease-out-soft',
        overlayClassName,
      )}
      // mousedown rather than click: a selection drag that starts inside an
      // input and releases over the backdrop should not close the modal.
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-lg border bg-bg shadow-xl outline-hidden max-h-[88vh]',
          closing
            ? 'motion-safe:animate-out motion-safe:fade-out-0 motion-safe:zoom-out-95 motion-safe:duration-exit motion-safe:ease-in-soft'
            : 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-base motion-safe:ease-out-soft',
          width,
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
            {description && (
              <p id={descId} className="mt-0.5 text-[11px] text-fg-mute">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-bg-2/10 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
