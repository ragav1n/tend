'use client';

import { useEffect, useRef } from 'react';
import { chordOf, isTypingTarget, MODIFIER_KEYS, resolveChord, type Pending } from '@/lib/keys/map';

/**
 * One global key listener for the whole app.
 *
 * Registered once in the shell rather than per component, because a shortcut
 * that only works while a particular view is mounted is not a shortcut. All the
 * matching is in `lib/keys/map.ts`; this is the part that needs a DOM.
 *
 * The sequence prefix is held in a closure variable, not state. Re-rendering
 * the shell on the way through `g` would be a render per keystroke for nothing
 * anyone can see.
 */
export function useHotkeys(
  /** chord to binding id. */
  index: ReadonlyMap<string, string>,
  /** Binding ids that still fire while a text field has focus. */
  typingSafe: ReadonlySet<string>,
  run: (id: string, event: KeyboardEvent) => void,
) {
  const runRef = useRef(run);
  // Assigned in an effect rather than during render: `react-hooks/purity` is an
  // error here and a ref write is a side effect.
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    let pending: Pending | null = null;

    function onKeyDown(event: KeyboardEvent) {
      // Something closer to the key already answered it, and an IME mid-word is
      // composing rather than pressing.
      if (event.defaultPrevented || event.isComposing) return;

      // A modifier pressed on its own is on the way to a chord, not a chord.
      // Reaching for Shift between the two keys of a sequence used to consume
      // the armed prefix and swallow the key after it.
      if (MODIFIER_KEYS.has(event.key)) return;

      const chord = chordOf(event);
      const typing = isTypingTarget(event.target);

      // No sequences inside a field. Typing "go" would otherwise arm the prefix
      // and eat the o. The prefix is dropped rather than held, or one armed on
      // the page survives a paragraph of typing and fires whenever the next
      // letter lands outside a field.
      //
      // The clock is `event.timeStamp`, not `Date.now()`: it records when the
      // key was pressed rather than when this handler got a turn. Under a busy
      // main thread the two are seconds apart, and measuring the wrong one lets
      // a prefix pressed long ago complete a sequence.
      let resolved: string | null;
      if (typing) {
        pending = null;
        resolved = chord;
      } else {
        const step = resolveChord(chord, pending, event.timeStamp);
        pending = step.pending;
        resolved = step.chord;
      }

      if (!resolved) return;

      const id = index.get(resolved);
      if (!id) return;
      if (typing && !typingSafe.has(id)) return;

      event.preventDefault();
      runRef.current(id, event);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [index, typingSafe]);
}
