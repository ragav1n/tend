'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDragControls } from 'motion/react';

/**
 * Long press to pick a row up, on a screen that has no better way to say it.
 *
 * The carets stay. They are the keyboard path and the screen-reader path, and a
 * drag is neither. What they are not is a touch target: the pair is 18 by 32
 * pixels, and two stacked buttons cannot both reach 44pt inside 32 pixels of
 * height, so no amount of padding fixes them for a thumb.
 *
 * Three rules, and each one is a bug that happens without it:
 *
 *   1. **A press that moves is a scroll.** The finger that starts a scroll is a
 *      finger resting on a row, so arming on `pointerdown` alone means the list
 *      stops scrolling. The timer is dropped as soon as the pointer travels past
 *      `SLOP_PX`, and on iOS that has to happen before the browser claims the
 *      gesture, which is why the delay is short.
 *   2. **The delay is the whole affordance.** Too short and a tap becomes a
 *      drag; too long and nothing seems to happen. 350ms is the usual landing
 *      spot and matches what a long press means elsewhere on the platform.
 *   3. **The callout has to go.** A long press on text in Safari opens the
 *      selection callout over the row being dragged, and nothing about the drag
 *      cancels it.
 *
 * The move and release listeners go on the window for the press's lifetime
 * rather than on the row. A handler on the row is a bet on implicit pointer
 * capture, which the spec gives touch and does not give a mouse, so a press that
 * travelled off the row never saw its own cancel and armed anyway. They also
 * outlive the arming, because `onDragEnd` only fires for a drag that started and
 * a press that wins and is then lifted in place is not one.
 *
 * `dragListener` is false on the element, so motion starts nothing on its own
 * and this decides. The event handed to `start` is the original `pointerdown`,
 * held across the delay: motion only reads coordinates off it, and the pointer
 * is still down or the timer would have been cleared.
 */

/** How long a finger rests before the row comes up. */
export const LONG_PRESS_MS = 350;

/** Travel that means the finger meant to scroll. */
export const SLOP_PX = 8;

export function useLongPressDrag(enabled: boolean): {
  controls: ReturnType<typeof useDragControls>;
  armed: boolean;
  release: () => void;
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onContextMenu: (event: React.MouseEvent) => void;
  };
} {
  const controls = useDragControls();
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detach = useRef<(() => void) | null>(null);

  /** Drops the timer and the window listeners. Safe to call twice. */
  const forget = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    detach.current?.();
    detach.current = null;
  }, []);

  const release = useCallback(() => {
    forget();
    setArmed(false);
  }, [forget]);

  // A row unmounting mid-press must leave neither a timer nor a listener.
  useEffect(() => forget, [forget]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || !event.isPrimary) return;
      release();

      const from = { x: event.clientX, y: event.clientY };
      // The native event is what motion wants, and it outlives the React
      // wrapper for as long as this closure holds it.
      const native = event.nativeEvent;

      function onMove(moved: PointerEvent) {
        // Only until the press wins. After that the travel is the drag.
        if (timer.current === null) return;
        if (Math.hypot(moved.clientX - from.x, moved.clientY - from.y) > SLOP_PX) release();
      }

      // These stay for the whole press, arming included. `onDragEnd` is not a
      // promise: a press that wins and is then lifted without travelling leaves
      // motion with no drag to end, and a row that armed on nothing else keeps
      // its lift and its z-index for good.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      detach.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      };

      timer.current = setTimeout(() => {
        timer.current = null;
        setArmed(true);
        controls.start(native);
      }, LONG_PRESS_MS);
    },
    [controls, enabled, release],
  );

  return {
    controls,
    armed,
    release,
    handlers: {
      onPointerDown,
      onContextMenu: (event: React.MouseEvent) => {
        // Only while a press is pending or a row is up. Outside that the browser
        // menu is nobody's business but the browser's.
        if (timer.current !== null || armed) event.preventDefault();
      },
    },
  };
}
