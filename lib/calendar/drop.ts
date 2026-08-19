import type { PanInfo } from 'motion/react';
import type { PlainDate } from '@/lib/db/types';

/**
 * Which day a drag was dropped on.
 *
 * Hit-tested against the pointer rather than tracked with hover handlers,
 * because the element under a dragging finger is the dragged chip itself and
 * pointer capture means no cell ever sees an enter event.
 *
 * `elementsFromPoint` returns the whole stack, top first. The chip is on top and
 * still lives inside the cell it started in, so any candidate that contains the
 * chip is the source cell and gets skipped. The first one left is the cell the
 * chip is hovering over. Dropping a chip back where it started resolves to
 * nothing, which is the right answer for a move that moves nowhere.
 */

/** Viewport coordinates of the pointer that ended the drag. */
export function clientPoint(
  event: MouseEvent | TouchEvent | PointerEvent,
  info: PanInfo,
): { x: number; y: number } {
  if ('clientX' in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  // A synthetic end with no coordinates. info.point is page-relative, so the
  // scroll offset has to come back off it to make it a viewport point.
  return { x: info.point.x - window.scrollX, y: info.point.y - window.scrollY };
}

/** The `data-day` of the first cell under the point that is not the source. */
export function dayFromStack(stack: readonly Element[], source: Element | null): PlainDate | null {
  for (const element of stack) {
    const cell = element.closest('[data-day]');
    if (!cell) continue;
    if (source && cell.contains(source)) continue;
    return cell.getAttribute('data-day');
  }
  return null;
}

export function dayUnderPointer(
  event: MouseEvent | TouchEvent | PointerEvent,
  info: PanInfo,
  source: Element | null,
): PlainDate | null {
  const { x, y } = clientPoint(event, info);
  return dayFromStack(document.elementsFromPoint(x, y), source);
}
