import { describe, expect, it } from 'vitest';
import { NO_DUE_DAY, NO_PROJECT, type Task } from '@/lib/db/types';
import { applyView, describeFilter, matchesFilter, sortByPressure, sortTasks, type ViewFilter } from './filter';

const TODAY = '2026-08-20';

let n = 0;
function task(over: Partial<Task> = {}): Task {
  const dueDate = over.dueDate ?? null;
  return {
    id: `t${n++}`,
    userId: 'local',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    rowVersion: 0,
    projectId: NO_PROJECT,
    parentTaskId: '',
    seriesId: '',
    depth: 0,
    title: 'A task',
    notes: '',
    status: 'active',
    priority: 0,
    dueDate,
    dueTime: null,
    startDate: null,
    plannedFor: null,
    estimateMinutes: null,
    completedAt: null,
    cancelledAt: null,
    courseId: '',
    componentId: '',
    pointsPossible: null,
    pointsEarned: null,
    gradedAt: null,
    feedUid: null,
    feedSnapshot: {},
    cancelReason: null,
    archivedAt: null,
    sortKey: 'a0',
    plannedSortKey: 'a0',
    occurrenceDate: null,
    occurrenceSeq: null,
    _del: 0,
    _done: 0,
    _dueDay: dueDate ?? NO_DUE_DAY,
    _plannedDay: NO_DUE_DAY,
    _tagIds: [],
    _words: ['a', 'task'],
    ...over,
  };
}

const keep = (t: Task, f: ViewFilter) => matchesFilter(t, f, TODAY);

describe('an empty filter', () => {
  it('is the everything-open view, not the nothing view', () => {
    expect(keep(task(), {})).toBe(true);
  });

  it('still hides tombstones', () => {
    expect(keep(task({ _del: 1 }), {})).toBe(false);
  });

  it('still hides finished work, because open is the default scope', () => {
    expect(keep(task({ _done: 1 }), {})).toBe(false);
  });
});

describe('status', () => {
  it('can ask for the finished end', () => {
    expect(keep(task({ _done: 1 }), { status: 'done' })).toBe(true);
    expect(keep(task({ _done: 0 }), { status: 'done' })).toBe(false);
  });

  it('can ask for both', () => {
    expect(keep(task({ _done: 1 }), { status: 'any' })).toBe(true);
    expect(keep(task({ _done: 0 }), { status: 'any' })).toBe(true);
  });
});

describe('project', () => {
  it('treats Inbox as a real answer rather than as unset', () => {
    expect(keep(task({ projectId: NO_PROJECT }), { projectId: NO_PROJECT })).toBe(true);
    expect(keep(task({ projectId: 'p1' }), { projectId: NO_PROJECT })).toBe(false);
  });

  it('lets every project through when the field is absent', () => {
    expect(keep(task({ projectId: 'p1' }), {})).toBe(true);
  });
});

describe('tags', () => {
  it('needs all of them, not any of them', () => {
    const t = task({ _tagIds: ['a', 'b'] });
    expect(keep(t, { tagIds: ['a'] })).toBe(true);
    expect(keep(t, { tagIds: ['a', 'b'] })).toBe(true);
    expect(keep(t, { tagIds: ['a', 'c'] })).toBe(false);
  });

  it('ignores an empty list', () => {
    expect(keep(task(), { tagIds: [] })).toBe(true);
  });
});

describe('priority', () => {
  it('is a floor', () => {
    expect(keep(task({ priority: 3 }), { minPriority: 2 })).toBe(true);
    expect(keep(task({ priority: 2 }), { minPriority: 2 })).toBe(true);
    expect(keep(task({ priority: 1 }), { minPriority: 2 })).toBe(false);
  });
});

describe('the due window', () => {
  const dated = (day: string, over: Partial<Task> = {}) =>
    task({ dueDate: day, _dueDay: day, ...over });

  it('reads overdue relative to the day it is opened', () => {
    expect(keep(dated('2026-08-19'), { due: 'overdue' })).toBe(true);
    expect(keep(dated(TODAY), { due: 'overdue' })).toBe(false);
  });

  it('never calls a finished task overdue', () => {
    expect(keep(dated('2026-08-01', { _done: 1 }), { due: 'overdue', status: 'any' })).toBe(false);
  });

  it('counts today as due by today, and yesterday too', () => {
    expect(keep(dated(TODAY), { due: 'today' })).toBe(true);
    expect(keep(dated('2026-08-19'), { due: 'today' })).toBe(true);
    expect(keep(dated('2026-08-21'), { due: 'today' })).toBe(false);
  });

  it('runs a week and a month forward from the day it is opened', () => {
    expect(keep(dated('2026-08-27'), { due: 'week' })).toBe(true);
    expect(keep(dated('2026-08-28'), { due: 'week' })).toBe(false);
    expect(keep(dated('2026-09-19'), { due: 'month' })).toBe(true);
    expect(keep(dated('2026-09-20'), { due: 'month' })).toBe(false);
  });

  it('crosses a month end without arithmetic trouble', () => {
    // 31 August plus 7 is 7 September, which a naive day add gets wrong.
    expect(matchesFilter(dated('2026-09-07'), { due: 'week' }, '2026-08-31')).toBe(true);
    expect(matchesFilter(dated('2026-09-08'), { due: 'week' }, '2026-08-31')).toBe(false);
  });

  it('separates dated from undated', () => {
    expect(keep(task(), { due: 'none' })).toBe(true);
    expect(keep(dated(TODAY), { due: 'none' })).toBe(false);
    expect(keep(dated(TODAY), { due: 'dated' })).toBe(true);
    expect(keep(task(), { due: 'dated' })).toBe(false);
  });
});

describe('text', () => {
  it('matches on word prefixes, the way search does', () => {
    const t = task({ _words: ['renew', 'the', 'passport'] });
    expect(keep(t, { text: 'pass' })).toBe(true);
    expect(keep(t, { text: 'renew pass' })).toBe(true);
    expect(keep(t, { text: 'renew visa' })).toBe(false);
  });

  it('ignores blank text rather than matching nothing', () => {
    expect(keep(task(), { text: '   ' })).toBe(true);
  });
});

describe('sorting', () => {
  it('puts undated work last when sorting by date', () => {
    const rows = [task({ sortKey: 'a2' }), task({ dueDate: TODAY, _dueDay: TODAY, sortKey: 'a1' })];
    expect(sortTasks(rows, 'due').map((t) => t._dueDay)).toEqual([TODAY, NO_DUE_DAY]);
  });

  it('sorts priority high to low', () => {
    const rows = [task({ priority: 1 }), task({ priority: 3 }), task({ priority: 2 })];
    expect(sortTasks(rows, 'priority').map((t) => t.priority)).toEqual([3, 2, 1]);
  });

  it('breaks every tie with the manual key, so a view never reshuffles', () => {
    const a = task({ priority: 2, sortKey: 'a1' });
    const b = task({ priority: 2, sortKey: 'a0' });
    expect(sortTasks([a, b], 'priority').map((t) => t.sortKey)).toEqual(['a0', 'a1']);
    expect(sortTasks([b, a], 'priority').map((t) => t.sortKey)).toEqual(['a0', 'a1']);
  });

  it('sorts titles without case getting in the way', () => {
    const rows = [task({ title: 'banana' }), task({ title: 'Apple' })];
    expect(sortTasks(rows, 'title').map((t) => t.title)).toEqual(['Apple', 'banana']);
  });

  it('leaves the input array alone', () => {
    const rows = [task({ priority: 1 }), task({ priority: 3 })];
    sortTasks(rows, 'priority');
    expect(rows.map((t) => t.priority)).toEqual([1, 3]);
  });
});

describe('applyView', () => {
  it('filters then sorts', () => {
    const rows = [
      task({ title: 'low', priority: 1 }),
      task({ title: 'high', priority: 3 }),
      task({ title: 'done', priority: 3, _done: 1 }),
    ];
    expect(applyView(rows, { minPriority: 2 }, 'priority', TODAY).map((t) => t.title)).toEqual([
      'high',
    ]);
  });
});

describe('describeFilter', () => {
  const names = {
    projects: new Map([['p1', 'House move']]),
    tags: new Map([['g1', 'errand']]),
  };

  it('says what an empty filter holds', () => {
    expect(describeFilter({}, names)).toBe('Everything open');
  });

  it('names the project, the tags and the window', () => {
    expect(
      describeFilter({ projectId: 'p1', tagIds: ['g1'], due: 'overdue', minPriority: 2 }, names),
    ).toBe('House move · #errand · P2 and up · Overdue');
  });

  it('names Inbox rather than an empty string', () => {
    expect(describeFilter({ projectId: NO_PROJECT }, names)).toBe('Inbox');
  });
});

describe('sorting by pressure', () => {
  const dated = (id: string, day: string) =>
    ({ ...task({ id }), _dueDay: day }) as ReturnType<typeof task>;

  it('puts the tightest deadline first, not the soonest', () => {
    // The whole reason this mode exists. Friday is under more pressure than
    // Wednesday when four days of committed work sit in front of it.
    const wednesday = dated('wed', '2026-09-23');
    const friday = dated('fri', '2026-09-25');
    const slack = new Map([
      ['2026-09-23', { slack: 300 }],
      ['2026-09-25', { slack: -120 }],
    ]);

    expect(sortByPressure([wednesday, friday], slack).map((t) => t.id)).toEqual(['fri', 'wed']);
  });

  it('sorts undated work last rather than first', () => {
    // A missing value read as a number would put it at the front, which is the
    // opposite of true: nothing undated is under deadline pressure.
    const soon = dated('soon', '2026-09-23');
    const parked = task({ id: 'parked' });
    const slack = new Map([['2026-09-23', { slack: -60 }]]);

    expect(sortByPressure([parked, soon], slack).map((t) => t.id)).toEqual(['soon', 'parked']);
  });

  it('falls back to due order for days it knows nothing about', () => {
    const a = dated('a', '2026-09-25');
    const b = dated('b', '2026-09-22');
    expect(sortByPressure([a, b], new Map()).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('breaks a tie the same way every other sort does', () => {
    const a = dated('a', '2026-09-23');
    const b = dated('b', '2026-09-23');
    const slack = new Map([['2026-09-23', { slack: -60 }]]);
    const once = sortByPressure([a, b], slack).map((t) => t.id);
    const again = sortByPressure([b, a], slack).map((t) => t.id);
    expect(once).toEqual(again);
  });

  it('leaves the input alone', () => {
    const rows = [dated('a', '2026-09-25'), dated('b', '2026-09-22')];
    sortByPressure(rows, new Map());
    expect(rows.map((t) => t.id)).toEqual(['a', 'b']);
  });
});
