// Two-pane resizable split with a draggable divider. `direction` is the axis the
// panes are laid out along: 'horizontal' = side by side, 'vertical' = stacked.
// The first pane's size is a percentage, clamped to a sane range while dragging.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  direction: 'horizontal' | 'vertical';
  first: React.ReactNode;
  second: React.ReactNode;
  initialPercent?: number;
  minPercent?: number;
  maxPercent?: number;
  // Hard minimum size (px) each pane keeps while dragging, so content never gets
  // squeezed out of view.
  minPanePx?: number;
}

export function SplitPane({
  direction, first, second, initialPercent = 50, minPercent = 20, maxPercent = 80, minPanePx = 360,
}: Props) {
  const [percent, setPercent] = useState(initialPercent);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const horizontal = direction === 'horizontal';

  const onPointerMove = useCallback((e: PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    const raw = horizontal
      ? ((e.clientX - rect.left) / rect.width) * 100
      : ((e.clientY - rect.top) / rect.height) * 100;
    // Clamp by both the percent bounds and a hard pixel minimum per pane.
    const pxFloor = size > 0 ? (minPanePx / size) * 100 : minPercent;
    const lo = Math.max(minPercent, pxFloor);
    const hi = Math.min(maxPercent, 100 - pxFloor);
    setPercent(lo > hi ? 50 : Math.min(hi, Math.max(lo, raw)));
  }, [horizontal, minPercent, maxPercent, minPanePx]);

  const stop = useCallback(() => {
    setDragging(false);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stop);
  }, [onPointerMove]);

  // Remove any dangling listeners if the component unmounts while dragging.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stop);
  }, [onPointerMove, stop]);

  const start = useCallback(() => {
    setDragging(true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
  }, [onPointerMove, stop]);

  return (
    <div ref={containerRef} className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col')}>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ flexBasis: `${percent}%`, flexShrink: 0 }}>
        {first}
      </div>
      <div
        onPointerDown={start}
        className={cn(
          'group relative shrink-0 bg-border transition-colors hover:bg-primary/40',
          horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
          dragging && 'bg-primary/60',
        )}
      >
        {/* invisible wider hit area for easier grabbing */}
        <span className={cn('absolute', horizontal ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0')} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {second}
      </div>
    </div>
  );
}
