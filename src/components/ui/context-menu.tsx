// Right-click context menu — a cursor-positioned sibling of DropdownMenu, for
// per-row actions in trees and lists (collections, connections, topics...).
// Extracted from API Client's Sidebar so Kafka Explorer / RabbitMQ / any future
// tree-like list gets the same right-click behavior and styling for free
// instead of a second hand-rolled copy.

import { cn } from '@/lib/utils';
import { useCallback, useState } from 'react';

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

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        role="menu"
        className="fixed z-[61] rounded-lg border border-line bg-card p-1 shadow-lg"
        style={{ left, top, width }}
      >
        {entries.map((en, i) => (
          <div key={i}>
            {en.sep && i > 0 && <div className="my-1 border-t border-line" />}
            <button
              type="button"
              role="menuitem"
              disabled={en.disabled}
              onClick={() => { en.onClick(); onClose(); }}
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
