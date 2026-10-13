// Right-click context menu: a cursor-positioned sibling of DropdownMenu for
// per-row actions in trees and lists (collections, connections, topics).

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ContextMenuEntry {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  /** Tints the row for a destructive action. */
  danger?: boolean;
  /** Draws a divider above this item. */
  sep?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
}

/**
 * Manages a single context menu's open/closed state and cursor position.
 * `open` is meant to be passed straight to an element's `onContextMenu`.
 */
export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const open = useCallback((e: React.MouseEvent, entries: ContextMenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, entries });
  }, []);
  const close = useCallback(() => setState(null), []);
  return { state, open, close };
}

/* The parent renders <ContextMenu> only while `state` is set, so the panel
   tracks `closing` itself and delays `onClose` by `--dur-exit` (130ms) to
   play its exit animation (same approach as dropdown-menu.tsx and
   modal-shell.tsx). */

export interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  width?: number;
}

/** The floating panel itself. Render only while `useContextMenu`'s state is non-null. */
export function ContextMenu({ state, onClose, width = 220 }: ContextMenuProps) {
  const { x, y, entries } = state;
  const height = entries.length * 32 + 8;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, Math.max(8, window.innerHeight - height - 8));
  // The panel may be pushed away from an edge; its transform origin stays
  // at the real cursor position so it still grows from the click.
  const originX = x - left;
  const originY = y - top;

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timerRef.current = setTimeout(onClose, 130);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onClick={requestClose}
        onContextMenu={(e) => { e.preventDefault(); requestClose(); }}
      />
      <div
        role="menu"
        style={{ left, top, width, transformOrigin: `${originX}px ${originY}px` }}
        className={cn(
          'fixed z-[61] rounded-lg border border-line bg-card p-1 shadow-lg',
          closing
            ? 'pointer-events-none motion-safe:animate-pop-out'
            : 'motion-safe:animate-pop-in',
        )}
      >
        {entries.map((en, i) => (
          <div key={i}>
            {en.sep && i > 0 && <div className="my-1 border-t border-line" />}
            <button
              type="button"
              role="menuitem"
              disabled={en.disabled}
              onClick={() => { en.onClick(); requestClose(); }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors duration-press ease-out-soft hover:bg-acc',
                'disabled:pointer-events-none disabled:opacity-50',
                en.danger && 'text-bad hover:bg-bad/10',
              )}
            >
              {en.icon}{en.label}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
