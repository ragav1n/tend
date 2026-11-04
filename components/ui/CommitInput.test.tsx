// @vitest-environment jsdom
import { useState } from 'react';
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setDb, TendDb } from '@/lib/db/client';
import { createTask, updateTask } from '@/lib/db/mutations';
import { CommitInput } from './CommitInput';

/**
 * The due date that reverted on the first try.
 *
 * Typing a date into a native field fires `change` once per segment that leaves
 * a valid date, so the year 2026 arrives as 0002, 0020, 0202 and 2026. The field
 * used to write each one and render the stored row, which put the old date back
 * under the cursor before the write returned. These cases replay that sequence.
 */

afterEach(cleanup);

/** What Chrome reports while somebody types 11/05/2026 over 10/30/2026. */
const TYPED = ['2026-11-30', '2026-11-05', '0002-11-05', '0020-11-05', '0202-11-05', '2026-11-05'];

function Controlled({
  initial,
  onCommit,
  allowEmpty,
}: {
  initial: string;
  onCommit: (value: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <CommitInput
      type="date"
      aria-label="Due"
      value={initial}
      onCommit={onCommit}
      allowEmpty={allowEmpty}
    />
  );
}

function field() {
  return screen.getByLabelText('Due') as HTMLInputElement;
}

function type(input: HTMLInputElement, values: string[]) {
  for (const value of values) {
    fireEvent.keyDown(input, { key: '1' });
    fireEvent.change(input, { target: { value } });
  }
}

describe('CommitInput', () => {
  it('writes a typed date once, on blur, with the final value', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-11-05');
  });

  it('keeps each typed segment on screen instead of snapping back to the stored date', () => {
    render(<Controlled initial="2026-10-30" onCommit={() => {}} />);
    const input = field();

    fireEvent.focus(input);
    for (const value of TYPED) {
      fireEvent.keyDown(input, { key: '1' });
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
    }
  });

  it('commits a picker choice at once, since no key was pressed', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2026-12-01' } });
    expect(onCommit).toHaveBeenCalledWith('2026-12-01');

    // The blur that follows a picker is not a second write.
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('treats Tab as moving through the field rather than typing', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.change(input, { target: { value: '2026-12-01' } });
    expect(onCommit).toHaveBeenCalledWith('2026-12-01');
  });

  it('commits on Enter and does not write again on the blur after it', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('2026-11-05');

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the typed date ends where it started', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    type(input, ['2026-10-01', '2026-10-30']);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('2026-10-30');
  });

  it('holds the committed draft while the store catches up, then follows the store', () => {
    const onCommit = vi.fn();
    const { rerender } = render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    fireEvent.blur(input);

    // The write is in flight and the row still says the 30th.
    expect(input.value).toBe('2026-11-05');

    rerender(<Controlled initial="2026-11-05" onCommit={onCommit} />);
    expect(input.value).toBe('2026-11-05');

    // Another device moves it while the field is idle. The row wins.
    rerender(<Controlled initial="2026-11-20" onCommit={onCommit} />);
    expect(input.value).toBe('2026-11-20');
  });

  it('keeps a draft being typed when the stored value moves underneath it', () => {
    const { rerender } = render(<Controlled initial="2026-10-30" onCommit={() => {}} />);
    const input = field();

    fireEvent.focus(input);
    type(input, ['2026-11-30']);
    rerender(<Controlled initial="2026-10-31" onCommit={() => {}} />);
    expect(input.value).toBe('2026-11-30');
  });

  it('commits a typed date when the field unmounts without a blur', () => {
    const onCommit = vi.fn();
    const { unmount } = render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-11-05');
  });

  it('does not write on unmount after the edit was already committed', () => {
    const onCommit = vi.fn();
    const { unmount } = render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    fireEvent.keyDown(input, { key: 'Enter' });
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('clears the date when the field is emptied on purpose', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onCommit).toHaveBeenCalledWith('');
  });

  it('does not clear the stored date over a half typed one', () => {
    const onCommit = vi.fn();
    render(<Controlled initial="2026-10-30" onCommit={onCommit} />);
    const input = field();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.change(input, { target: { value: '' } });
    // jsdom has no partial date state, so the flag a browser sets is stubbed.
    Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('2026-10-30');
  });

  it('refuses an empty value where one is required and puts the stored one back', () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <Controlled initial="2026-10-30" onCommit={onCommit} allowEmpty={false} />,
    );
    const input = field();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe('2026-10-30');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.change(input, { target: { value: '' } });
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('works as a one-shot picker with no stored value', () => {
    const onCommit = vi.fn();
    function Picker() {
      const [picked, setPicked] = useState<string[]>([]);
      return (
        <>
          <CommitInput
            type="date"
            aria-label="Due"
            value=""
            allowEmpty={false}
            onCommit={(value) => {
              onCommit(value);
              setPicked([...picked, value]);
            }}
          />
          <output>{picked.join(',')}</output>
        </>
      );
    }
    render(<Picker />);
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-11-05');
  });

  it('drops a typed draft on unmount where closing means cancel', () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <CommitInput
        type="date"
        aria-label="Due"
        value=""
        allowEmpty={false}
        commitOnUnmount={false}
        onCommit={onCommit}
      />,
    );
    const input = field();

    fireEvent.focus(input);
    type(input, TYPED);
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits times the same way', () => {
    const onCommit = vi.fn();
    render(<CommitInput type="time" aria-label="At" value="09:00" onCommit={onCommit} />);
    const input = screen.getByLabelText('At') as HTMLInputElement;

    fireEvent.focus(input);
    for (const value of ['01:00', '10:00', '10:03', '10:30']) {
      fireEvent.keyDown(input, { key: '1' });
      fireEvent.change(input, { target: { value } });
    }
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('10:30');
  });
});

/**
 * The same sequence against the real write path and a live query, which is
 * how TaskDetail wires it. One edit is one write and one undo step.
 */
describe('CommitInput over a live task row', () => {
  let db: TendDb;
  let dbName: string;
  let counter = 0;

  beforeEach(async () => {
    dbName = `tend_commit_${Date.now()}_${counter++}`;
    db = new TendDb(dbName);
    setDb(db);
    await db.open();
  });

  afterEach(async () => {
    db.close();
    setDb(null);
    await Dexie.delete(dbName);
  });

  function DueField({ id }: { id: string }) {
    const task = useLiveQuery(() => db.tasks.get(id), [id]);
    if (!task) return null;
    return (
      <CommitInput
        type="date"
        aria-label="Due"
        value={task.dueDate ?? ''}
        onCommit={(value) => void updateTask(id, { dueDate: value || null })}
      />
    );
  }

  it('lands a typed due date on the first try, as one write', async () => {
    const id = await createTask({ title: 'Lab report', dueDate: '2026-10-30' }, db);
    const taskWrites = () =>
      db.outbox.filter((r) => r.table === 'tasks' && r.op === 'update').count();
    const logged = await db.activityLog.count();

    render(<DueField id={id} />);
    const input = await screen.findByLabelText('Due');

    fireEvent.focus(input);
    type(input as HTMLInputElement, TYPED);
    await act(async () => {
      fireEvent.blur(input);
    });

    await waitFor(async () => expect((await db.tasks.get(id))?.dueDate).toBe('2026-11-05'));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('2026-11-05'));
    expect(await taskWrites()).toBe(1);
    expect(await db.activityLog.count()).toBe(logged + 1);
  });
});
