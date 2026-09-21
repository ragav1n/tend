// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sheet } from './Sheet';

/**
 * The two rules about who owns focus and who owns Escape.
 *
 * Both were found by driving a real browser and both are invisible in a
 * screenshot: the panel took focus off a field a shortcut had just put it in,
 * and one Escape mid-draft closed the whole panel. A jsdom test holds them,
 * because the next person to touch this file will be reading the focus effect
 * and not the reason it has a guard.
 */

// jsdom ships no matchMedia, and Sheet reads one to decide whether it is a
// bottom sheet or a side panel. False is the phone, which is the layout the
// server snapshot renders too.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(cleanup);

/** A field that grabs focus as it mounts, the way the subtask draft does when a
 *  shortcut asks for it. */
function EagerField({ owner = false }: { owner?: boolean }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <input
      ref={field}
      aria-label="Draft"
      {...(owner ? { 'data-escape-owner': true } : {})}
    />
  );
}

describe('Sheet and focus', () => {
  it('leaves focus where a child put it', () => {
    render(
      <Sheet open onClose={vi.fn()} label="Task detail">
        <EagerField />
      </Sheet>,
    );

    // A child effect runs before the parent's, so an unconditional node.focus()
    // here took the field away and the blur closed it.
    expect(document.activeElement).toBe(screen.getByLabelText('Draft'));
  });

  it('takes focus itself when nothing inside it has any', () => {
    render(
      <Sheet open onClose={vi.fn()} label="Task detail">
        <p>Nothing to focus</p>
      </Sheet>,
    );

    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});

/**
 * A sheet opened from a button, whose `onClose` is a fresh arrow every render.
 * That is how every caller in the app writes it, and it is what made the focus
 * trap re-run on each keystroke.
 */
function Opened() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New course
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="New course">
        <input
          aria-label="Instructor"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Sheet>
    </>
  );
}

describe('Sheet and typing', () => {
  it('keeps focus in a field across a render', () => {
    render(<Opened />);
    const opener = screen.getByRole('button', { name: 'New course' });
    opener.focus();
    fireEvent.click(opener);

    const field = screen.getByLabelText('Instructor') as HTMLInputElement;
    field.focus();
    fireEvent.change(field, { target: { value: 'P' } });

    // The trap used to be keyed to `onClose`, so one character tore it down and
    // rebuilt it: the teardown handed focus to the opener and the setup pulled
    // it to the panel. One character was enough to leave the field.
    expect(field.value).toBe('P');
    expect(document.activeElement).toBe(field);
  });
});

describe('Sheet and Escape', () => {
  it('closes on Escape', () => {
    const close = vi.fn();
    render(
      <Sheet open onClose={close} label="Task detail">
        <EagerField />
      </Sheet>,
    );

    fireEvent.keyDown(screen.getByLabelText('Draft'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a field that owns it', () => {
    const close = vi.fn();
    render(
      <Sheet open onClose={close} label="Task detail">
        <EagerField owner />
      </Sheet>,
    );

    fireEvent.keyDown(screen.getByLabelText('Draft'), { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
  });

  it('still closes on Escape from elsewhere in the panel', () => {
    const close = vi.fn();
    render(
      <Sheet open onClose={close} label="Task detail">
        <EagerField owner />
        <button type="button">Delete</button>
      </Sheet>,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
