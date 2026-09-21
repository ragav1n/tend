'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
  type PanInfo,
} from 'motion/react';
import { X } from '@phosphor-icons/react/dist/ssr';
import { MD_QUERY, useMediaQuery } from '@/hooks/use-media-query';
import { useScrollLock } from '@/hooks/use-scroll-lock';
import { QUICK_FADE, SHEET } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Bottom sheet on phones, side panel on anything wider.
 *
 * Built rather than sourced. Every off-the-shelf sheet this project looked at
 * got one of three things wrong: it dragged when the content should have
 * scrolled, it left the page scrolling behind the overlay, or it dropped focus
 * on the floor when it closed. All three are handled here.
 *
 * Drag runs through `useDragControls` with `dragListener={false}`, so a drag can
 * only start on the grip. Without that, a swipe anywhere inside a scrollable
 * sheet is ambiguous, and the resolution people notice is the wrong one: the
 * sheet moves when they meant to scroll.
 */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Announced as the dialog's name. */
  label: string;
  children: React.ReactNode;
}

/** Past either of these, the sheet leaves. Distance covers a slow deliberate
 *  drag, velocity covers a fast flick that never travels far. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 500;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function SheetPanel({ onClose, label, children }: Omit<SheetProps, 'open'>) {
  const wide = useMediaQuery(MD_QUERY);
  const reduced = useReducedMotion();
  const dragControls = useDragControls();
  const panelRef = useRef<HTMLDivElement>(null);

  useScrollLock();

  /**
   * `onClose` read through a ref so the effect below can depend on nothing.
   *
   * Every caller passes a fresh arrow, so keying the effect to `onClose` re-ran
   * the whole focus trap on every render. Typing one character into a field
   * re-rendered the panel, the teardown handed focus back to the button that
   * opened it, and the setup then pulled it to the panel: the field emptied of
   * focus after a single keypress. The trap belongs to the mount, not to the
   * identity of a callback.
   */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Focus moves in on open and goes back where it came from on close, which is
  // what makes the sheet usable from a keyboard and survivable with a screen
  // reader. Tab cycles inside the panel rather than wandering into the list
  // behind it.
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    // Only when nothing inside it holds focus. A child effect runs before this
    // one, so a panel that opens with a field ready had that field focused and
    // then taken off it, and the blur closed the field the shortcut asked for.
    if (!node.contains(document.activeElement)) node.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Escape belongs to the innermost thing that is open. A field that says
        // so closes itself, and a subtask being typed is not worth the whole
        // panel: closing it would take the draft with it.
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('[data-escape-owner]')) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;

      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Capture phase, so an open dialog owns Escape ahead of every app-level
    // shortcut. Both listeners are on document, so without this the order is
    // whichever mounted first: pressing Escape in the selection bar's schedule
    // sheet closed the sheet AND dropped the selection, because the bar had been
    // listening since before the sheet existed. preventDefault here is what the
    // hotkey dispatcher checks.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // The row that opened the sheet can be gone by now, deleted or filtered
      // out of the list, so focusing it blind would throw focus to the body.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const travelled = wide ? info.offset.x : info.offset.y;
    const speed = wide ? info.velocity.x : info.velocity.y;
    if (travelled > DISMISS_DISTANCE || speed > DISMISS_VELOCITY) onClose();
  }

  const hidden = wide ? { x: '100%' } : { y: '100%' };

  return (
    <>
      <motion.div
        aria-hidden
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={QUICK_FADE}
        className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={reduced ? { opacity: 0 } : hidden}
        animate={reduced ? { opacity: 1 } : { x: 0, y: 0 }}
        exit={reduced ? { opacity: 0 } : hidden}
        transition={reduced ? QUICK_FADE : SHEET}
        drag={reduced ? false : wide ? 'x' : 'y'}
        dragControls={dragControls}
        dragListener={false}
        // Only the closing direction is free. The other way the sheet is pinned,
        // so a drag up cannot lift it off the top of the screen.
        dragConstraints={{ top: 0, left: 0 }}
        dragElastic={0.08}
        dragSnapToOrigin
        onDragEnd={handleDragEnd}
        className={cn(
          'fixed z-50 flex flex-col border-line bg-surface outline-none',
          'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
          // Phone: rises from the bottom edge, capped so the list stays visible.
          'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl border-t',
          // Desktop: a panel against the right edge, full height.
          'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[27rem] md:rounded-none md:rounded-l-xl md:border-l md:border-t-0',
        )}
        style={{ boxShadow: 'var(--shadow-lifted)' }}
      >
        <div
          onPointerDown={(event) => dragControls.start(event)}
          className={cn(
            'flex shrink-0 items-center gap-2 px-3 pb-1 pt-2.5',
            // The inset is folded into the padding rather than applied with
            // .safe-top, because that class lives in @layer base and any
            // Tailwind padding utility on the same element wins the cascade.
            // Only the desktop panel needs it: the phone sheet's top edge sits
            // mid-screen, nowhere near the notch.
            'md:pt-[calc(0.625rem+env(safe-area-inset-top))]',
            // touch-action none, or the browser claims the gesture for scrolling
            // before motion ever sees a pointer move.
            'touch-none select-none md:cursor-grab md:active:cursor-grabbing',
          )}
        >
          {/* A shoulder the same size as the close button, so the grip below sits
              in the middle of the sheet rather than in the middle of what is
              left over. With `mx-auto` on the grip and `ml-auto` on the button
              there were three auto margins in this row splitting the free space
              three ways, which put the grip 69pt left of centre on a 393pt
              screen. Two equal flankers and one centred item is the only
              arrangement where the maths comes out even. */}
          <span aria-hidden className="size-8 shrink-0 md:hidden" />
          <span
            aria-hidden
            className="mx-auto h-1 w-9 rounded-pill bg-line-strong md:hidden"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              // Auto margin only where the flankers are gone: on a phone it
              // would be a third auto margin and the grip would drift again.
              'grid size-8 shrink-0 place-items-center rounded-md md:ml-auto',
              'text-text-lo hover:bg-raised hover:text-text-hi',
            )}
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        {/* overscroll-contain keeps a flick at the end of this list from
            rubber-banding the page behind the sheet on iOS. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4',
            'pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          {children}
        </div>
      </motion.div>
    </>
  );
}

export function Sheet({ open, onClose, label, children }: SheetProps) {
  // The portal target only exists in the browser. No mount flag is needed to
  // avoid a hydration mismatch, because a portal contributes no host nodes at
  // this position in the tree: the server renders nothing here and so does the
  // first client pass, since the sheet is never open on the first render.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <SheetPanel onClose={onClose} label={label}>
          {children}
        </SheetPanel>
      )}
    </AnimatePresence>,
    document.body,
  );
}
