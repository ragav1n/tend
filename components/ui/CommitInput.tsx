'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  type: 'date' | 'time';
  /** The stored value, `''` for none. */
  value: string;
  /** Called once per finished edit, with `''` for a cleared field. */
  onCommit: (value: string) => void;
  /** False for a field that must hold a value: a cleared draft reverts on blur. */
  allowEmpty?: boolean;
  /** False where closing the field means cancel, as on a bulk reschedule. */
  commitOnUnmount?: boolean;
};

/**
 * A date or time field that writes once per edit instead of once per keystroke.
 *
 * Typing into a native date field fires `change` every time the segments form a
 * valid date, so typing the year 2026 reports 0002, 0020 and 0202 on the way.
 * Bound straight to the live row, each of those was a write, and React put the
 * field back to the stored date before the write came back. That reset threw
 * away the segment being typed, and the date reverted on the first try.
 *
 * So the field keeps its own draft while it has focus. A change with no key
 * pressed since focus came from the picker and commits at once, which is what a
 * picker on a phone needs. A typed change waits for blur, Enter or unmount. The
 * draft stays on screen after a commit until the stored value moves, so the
 * field never flashes the old date while the write is in flight.
 */
export function CommitInput({
  value,
  onCommit,
  allowEmpty = true,
  commitOnUnmount = true,
  onKeyDown,
  onBlur,
  onFocus,
  ...rest
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const typed = useRef(false);
  const focused = useRef(false);
  /** What was last handed to `onCommit`, so a blur after Enter is not a second write. */
  const sent = useRef<string | null>(null);

  /** The latest render's props, for the unmount commit, which runs after them. */
  const live = useRef({ draft, value, onCommit, allowEmpty, commitOnUnmount });
  useEffect(() => {
    live.current = { draft, value, onCommit, allowEmpty, commitOnUnmount };
  });

  function send(next: string) {
    if (next === '' && !allowEmpty) return;
    if (next === value || next === sent.current) return;
    sent.current = next;
    onCommit(next);
  }

  // The stored value moved. Either the commit landed, or the field is idle and
  // something else changed it, and in both cases the row is the truth again.
  useEffect(() => {
    sent.current = null;
    setDraft((current) => {
      if (current === null) return null;
      return current === value || !focused.current ? null : current;
    });
  }, [value]);

  // A panel closed by Escape or a route change unmounts the field without a
  // blur. A date typed out in full should not vanish because of how it closed.
  useEffect(
    () => () => {
      const { draft: pending, value: stored, onCommit: commit, allowEmpty: empty } = live.current;
      if (!live.current.commitOnUnmount) return;
      if (pending === '' && !empty) return;
      if (typed.current && pending !== null && pending !== stored && pending !== sent.current) {
        commit(pending);
      }
    },
    [],
  );

  return (
    <input
      {...rest}
      value={draft ?? value}
      onFocus={(event) => {
        focused.current = true;
        typed.current = false;
        onFocus?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          if (draft !== null) send(draft);
        } else if (event.key !== 'Tab' && event.key !== 'Escape') {
          typed.current = true;
        }
        onKeyDown?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (!typed.current) send(next);
      }}
      onBlur={(event) => {
        focused.current = false;
        const wasTyped = typed.current;
        typed.current = false;
        if (draft !== null) {
          // A half typed date reads as '' with badInput set. Committing that
          // would clear the stored date over a stray Backspace.
          if (draft === '' && (!allowEmpty || (wasTyped && event.target.validity?.badInput))) {
            setDraft(null);
          } else if (draft === value) {
            setDraft(null);
          } else {
            send(draft);
          }
        }
        onBlur?.(event);
      }}
    />
  );
}
