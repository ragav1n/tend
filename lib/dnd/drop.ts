import type { PanInfo } from 'motion/react';

/**
 * Where a drag was dropped.
 *
 * Hit-tested against the pointer rather than tracked with hover handlers,
 * because the element under a dragging finger is the dragged item itself and
 * pointer capture means no target ever sees an enter event.
 *
 * `elementsFromPoint` returns the whole stack, top first. The dragged item is on
 * top and still lives inside the target it started in, so any candidate that
 * contains it is the source and gets skipped. The first one left is what the
 * item is hovering over. Dropping something back where it started resolves to
 * nothing, which is the right answer for a move that moves nowhere.
 *
 * Targets are marked with a data attribute holding their id: `data-day` on a
 * calendar cell, `data-column` on a board column.
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

/** The attribute value of the first target under the point that is not the source. */
export function targetFromStack(
  stack: readonly Element[],
  source: Element | null,
  attribute: string,
): string | null {
  for (const element of stack) {
    const target = element.closest(`[${attribute}]`);
    if (!target) continue;
    if (source && target.contains(source)) continue;
    return target.getAttribute(attribute);
  }
  return null;
}

export function targetUnderPointer(
  event: MouseEvent | TouchEvent | PointerEvent,
  info: PanInfo,
  source: Element | null,
  attribute: string,
): string | null {
  const { x, y } = clientPoint(event, info);
  return targetFromStack(document.elementsFromPoint(x, y), source, attribute);
}
