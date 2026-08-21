'use client';

import { CaretDown, CaretUp } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/utils';

/**
 * Two carets that move a row up or down its list.
 *
 * Buttons rather than a drag, and the reason is the rule the board and the
 * calendar already follow: a drag is a pointer shortcut, never the only path.
 * These work from a touch screen, which has no drag worth having over a
 * scrolling list, and from a keyboard, which has none at all.
 *
 * Stacked in one 18px column so the pair reads as a single control next to the
 * row's other buttons rather than as two more of them. The end of the list
 * disables the caret pointing at it rather than hiding it, or the control would
 * change size as it travelled.
 */
export function ReorderStack({
  label,
  first,
  last,
  onUp,
  onDown,
  className,
}: {
  /** Names the thing being moved, for the two accessible names. */
  label: string;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  className?: string;
}) {
  // One item is a list with no order to change.
  if (first && last) return null;

  return (
    <span className={cn('flex shrink-0 flex-col', className)}>
      <Caret dir="up" label={`Move ${label} up`} disabled={first} onClick={onUp} />
      <Caret dir="down" label={`Move ${label} down`} disabled={last} onClick={onDown} />
    </span>
  );
}

function Caret({
  dir,
  label,
  disabled,
  onClick,
}: {
  dir: 'up' | 'down';
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = dir === 'up' ? CaretUp : CaretDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'grid h-4 w-[18px] place-items-center rounded-sm',
        disabled ? 'text-text-faint' : 'text-text-lo hover:bg-raised hover:text-text-hi',
      )}
    >
      <Icon size={11} weight="bold" aria-hidden />
    </button>
  );
}
