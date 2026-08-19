import { chordKeys } from '@/lib/keys/map';
import { cn } from '@/lib/utils';

/**
 * A key cap.
 *
 * Mono, because the whole app draws counts, labels and keys in the instrument
 * voice. Shared by the palette and the shortcuts overlay so the two cannot end
 * up printing the same key at different sizes.
 */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'tnum grid h-5 min-w-5 place-items-center rounded-[5px] border border-line-bright',
        'bg-raised px-1 text-[0.6875rem] text-text-mid',
      )}
    >
      {children}
    </kbd>
  );
}

/** A whole chord: `g t` becomes two caps, `mod+k` becomes ⌘ and K. */
export function Chord({ chord, className }: { chord: string; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)}>
      {chordKeys(chord).map((key, i) => (
        <Kbd key={`${key}-${i}`}>{key}</Kbd>
      ))}
    </span>
  );
}
