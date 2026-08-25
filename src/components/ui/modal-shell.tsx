import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
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
  children,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // Keep the latest handler without re-binding the key listener each render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape closes, and Tab cycles inside the panel instead of walking into the
  // page behind the overlay — the part `aria-modal` describes but cannot make
  // the browser enforce.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
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
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        scrim === 'strong' ? 'bg-black/60' : 'bg-black/40',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-fast motion-safe:ease-out-soft',
      )}
      // mousedown rather than click: a selection drag that starts inside an
      // input and releases over the backdrop should not close the modal.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
          'flex w-full flex-col overflow-hidden rounded-lg border bg-bg shadow-xl outline-none max-h-[88vh]',
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-base motion-safe:ease-out-soft',
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
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc/40"
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
