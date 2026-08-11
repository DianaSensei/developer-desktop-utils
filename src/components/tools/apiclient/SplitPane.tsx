// Two-pane resizable split with a draggable divider. `direction` is the axis the
// panes are laid out along: 'horizontal' = side by side, 'vertical' = stacked.
// The first pane's size is a percentage, clamped to a sane range while dragging.
//
// The size can either be left to the component (`initialPercent`) or owned by
// the caller (`percent` + `onPercentChange`) so it can be persisted — remounting
// the split (switching to History and back, reopening the tool) otherwise snaps
// the panes back to 50/50 and loses the layout the user set up.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  direction: 'horizontal' | 'vertical';
  first: React.ReactNode;
  second: React.ReactNode;
  // Controlled size. Omit both to let the split manage its own state.
  percent?: number;
  onPercentChange?: (percent: number) => void;
  initialPercent?: number;
  minPercent?: number;
  maxPercent?: number;
  // Hard minimum size (px) each pane keeps while dragging, so content never gets
  // squeezed out of view.
  minPanePx?: number;
}

const DEFAULT_PERCENT = 50;

export function SplitPane({
  direction, first, second, percent: percentProp, onPercentChange,
  initialPercent = DEFAULT_PERCENT, minPercent = 20, maxPercent = 80, minPanePx = 360,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [uncontrolled, setUncontrolled] = useState(initialPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const horizontal = direction === 'horizontal';

  const percent = percentProp ?? uncontrolled;
  const setPercent = useCallback((p: number) => {
    if (onPercentChange) onPercentChange(p);
    else setUncontrolled(p);
  }, [onPercentChange]);

  // Latest setter without re-registering the pointer listeners mid-drag.
  const onPercentChangeRef = useRef(setPercent);
  onPercentChangeRef.current = setPercent;

  const clamp = useCallback((raw: number, size: number) => {
    const pxFloor = size > 0 ? (minPanePx / size) * 100 : minPercent;
    const lo = Math.max(minPercent, pxFloor);
    const hi = Math.min(maxPercent, 100 - pxFloor);
    return lo > hi ? DEFAULT_PERCENT : Math.min(hi, Math.max(lo, raw));
  }, [minPercent, maxPercent, minPanePx]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    const raw = horizontal
      ? ((e.clientX - rect.left) / rect.width) * 100
      : ((e.clientY - rect.top) / rect.height) * 100;
    onPercentChangeRef.current(clamp(raw, size));
  }, [horizontal, clamp]);

  const stop = useCallback(() => {
    setDragging(false);
    // Restore normal selection/cursor behaviour once the drag ends.
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  }, [onPointerMove]);

  // Remove any dangling listeners (and the global styles) if the component
  // unmounts mid-drag.
  useEffect(() => stop, [stop]);

  // Reclamp percent when the container is resized (e.g. window resize) so the
  // second pane is never squeezed to zero by the flexShrink:0 first pane.
  // rAF-throttled so macOS ProMotion (120Hz) continuous resize doesn't cause
  // ~120 state updates/second and layout thrashing.
  const percentRef = useRef(percent);
  percentRef.current = percent;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const size = horizontal ? rect.width : rect.height;
        if (size <= 0) return;
        const next = clamp(percentRef.current, size);
        if (Math.abs(next - percentRef.current) > 0.01) onPercentChangeRef.current(next);
      });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(rafId); };
  }, [horizontal, clamp]);

  const start = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    // Without these the drag selects text across both panes and the cursor
    // flickers between col-resize and the text I-beam as it crosses content.
    document.body.style.setProperty('user-select', 'none');
    document.body.style.setProperty('cursor', horizontal ? 'col-resize' : 'row-resize');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [onPointerMove, stop, horizontal]);

  return (
    <div ref={containerRef} className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col')}>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ flexBasis: `${percent}%`, flexShrink: 0 }}>
        {first}
      </div>
      <div
        onPointerDown={start}
        onDoubleClick={() => setPercent(DEFAULT_PERCENT)}
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        title="Drag to resize · double-click to reset"
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
