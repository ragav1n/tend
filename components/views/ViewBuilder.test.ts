import { describe, expect, it } from 'vitest';
import { tidy } from './ViewBuilder';

/**
 * What a save writes back.
 *
 * `SavedView.filter` is typed loosely on purpose, so a row written by a newer
 * client survives a round trip through an older one. `tidy` is where that
 * promise is either kept or quietly broken, and breaking it is invisible: the
 * view still opens, it just filters on one axis fewer, on every device.
 */
describe('tidy', () => {
  it('drops an axis left at its default', () => {
    expect(tidy({ status: 'open', due: 'any', minPriority: 0, text: '   ' })).toEqual({});
  });

  it('keeps an axis that was set', () => {
    expect(tidy({ status: 'done', due: 'overdue', minPriority: 2 })).toEqual({
      status: 'done',
      due: 'overdue',
      minPriority: 2,
    });
  });

  it('treats Inbox as a real answer rather than as unset', () => {
    expect(tidy({ projectId: '' })).toEqual({ projectId: '' });
  });

  it('trims the text and drops an empty tag list', () => {
    expect(tidy({ text: '  passport  ', tagIds: [] })).toEqual({ text: 'passport' });
  });

  it('carries a key it has never heard of straight through', () => {
    // The whole point. Rebuilding the object from a closed list of known axes
    // deleted this on the first save, on every device, with no way to notice.
    expect(tidy({ due: 'week', assignee: 'sam', 'x-future': [1, 2] })).toEqual({
      due: 'week',
      assignee: 'sam',
      'x-future': [1, 2],
    });
  });

  it('does not let an unknown key survive under a known name', () => {
    // A known axis at its default still drops, even with strangers alongside.
    expect(tidy({ status: 'open', assignee: 'sam' })).toEqual({ assignee: 'sam' });
  });
});
