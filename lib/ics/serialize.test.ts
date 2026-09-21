import { describe, expect, it } from 'vitest';
import { NO_DUE_DAY, type Task } from '@/lib/db/types';
import type { RecurrenceRule } from '@/lib/recurrence';
import {
  escapeText,
  exportable,
  foldLine,
  icsFilename,
  nextDay,
  toIcs,
  toIcsDate,
  toIcsStamp,
  toRrule,
} from './serialize';

const NOW = new Date('2026-08-20T09:15:00.000Z');

let n = 0;
function task(over: Partial<Task> = {}): Task {
  const dueDate = over.dueDate ?? '2026-08-21';
  return {
    id: `00000000-0000-4000-8000-00000000000${n++}`,
    userId: 'local',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    deletedAt: null,
    rowVersion: 0,
    projectId: '',
    parentTaskId: '',
    seriesId: '',
    depth: 0,
    title: 'Renew the passport',
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
    _words: [],
    ...over,
  };
}

const RULE: RecurrenceRule = {
  freq: 'weekly',
  interval: 1,
  anchorMode: 'due_date',
  catchupPolicy: 'skip_to_future',
  endsMode: 'never',
};

const ics = (entries: Parameters<typeof toIcs>[0]) =>
  toIcs(entries, { now: NOW, domain: 'tend.test' });

/** Undo the 75-octet wrapping, so an assertion can read a whole content line. */
const unfold = (out: string) => out.replace(/\r\n /g, '');

describe('escaping', () => {
  it('escapes the four characters the spec reserves', () => {
    expect(escapeText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
  });

  it('escapes the backslash first, or it escapes its own escapes', () => {
    // Naive ordering turns `\` into `\\` after the semicolons are already
    // escaped, producing `a\\\;b` and a parser that reads a literal backslash.
    expect(escapeText('\\;')).toBe('\\\\\\;');
  });

  it('turns newlines into the literal two-character sequence', () => {
    expect(escapeText('one\ntwo')).toBe('one\\ntwo');
    expect(escapeText('one\r\ntwo')).toBe('one\\ntwo');
  });
});

describe('folding', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('wraps at 75 octets with a leading space on the continuation', () => {
    const line = `SUMMARY:${'a'.repeat(100)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.length).toBe(75);
    expect(parts[1]!.startsWith(' ')).toBe(true);
    // Unfolding puts it back exactly.
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('counts octets, not characters, and never splits one', () => {
    // Each of these is 4 bytes and 2 UTF-16 units, so a character count would
    // let a line reach 300 octets, and a byte offset would cut one in half.
    const line = `SUMMARY:${'🌱'.repeat(40)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(folded).not.toContain('�');
    expect(folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
});

describe('dates', () => {
  it('drops the dashes', () => {
    expect(toIcsDate('2026-08-21')).toBe('20260821');
  });

  it('writes an instant as a UTC stamp with no fraction', () => {
    expect(toIcsStamp('2026-08-20T09:15:00.000Z')).toBe('20260820T091500Z');
  });

  it('crosses a month end, which is what DTEND needs', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });
});

describe('what gets exported', () => {
  it('takes dated, live tasks', () => {
    const rows = [
      task({ title: 'dated' }),
      task({ title: 'undated', dueDate: null, _dueDay: NO_DUE_DAY }),
      task({ title: 'deleted', _del: 1 }),
    ];
    expect(exportable(rows).map((t) => t.title)).toEqual(['dated']);
  });
});

describe('the file', () => {
  it('wraps the events in a calendar and ends every line with CRLF', () => {
    const out = ics([{ task: task() }]);
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out.split('\n').every((line, i, all) => i === all.length - 1 || line.endsWith('\r'))).toBe(
      true,
    );
  });

  it('writes an all-day task as a DATE with an exclusive end', () => {
    const out = ics([{ task: task({ dueDate: '2026-08-21' }) }]);
    expect(out).toContain('DTSTART;VALUE=DATE:20260821');
    // The day after, or a calendar renders a zero-length event.
    expect(out).toContain('DTEND;VALUE=DATE:20260822');
  });

  it('writes a timed task as floating local time, with no zone', () => {
    const out = ics([{ task: task({ dueTime: '09:00' }) }]);
    expect(out).toContain('DTSTART:20260821T090000');
    expect(out).not.toContain('TZID');
    // A trailing Z would make it an instant, which is the one thing a task due
    // at 9am is not.
    expect(out).not.toContain('DTSTART:20260821T090000Z');
  });

  it('gives a timed task the estimate as its length, or half an hour', () => {
    expect(ics([{ task: task({ dueTime: '09:00' }) }])).toContain('DURATION:PT30M');
    expect(ics([{ task: task({ dueTime: '09:00', estimateMinutes: 90 }) }])).toContain(
      'DURATION:PT90M',
    );
  });

  it('keeps a UID stable, so re-importing updates rather than duplicates', () => {
    const row = task();
    expect(ics([{ task: row }])).toContain(`UID:${row.id}@tend.test`);
    expect(ics([{ task: row }])).toBe(ics([{ task: row }]));
  });

  it('escapes a title that would otherwise break the line', () => {
    const out = ics([{ task: task({ title: 'Call Sam; then Ana, re: notes\\files' }) }]);
    expect(out).toContain('SUMMARY:Call Sam\\; then Ana\\, re: notes\\\\files');
  });

  it('puts the project, tags, priority and notes in the description', () => {
    const out = ics([
      {
        task: task({ priority: 3, notes: 'Bring the old one' }),
        project: 'Admin',
        tags: ['errand', 'home'],
      },
    ]);
    expect(unfold(out)).toContain(
      'DESCRIPTION:Project: Admin\\nTags: errand\\, home\\nPriority: P1\\n\\nBring the old one',
    );
  });

  it('marks finished work confirmed and open work tentative', () => {
    expect(ics([{ task: task({ _done: 1 }) }])).toContain('STATUS:CONFIRMED');
    expect(ics([{ task: task() }])).toContain('STATUS:TENTATIVE');
  });

  it('writes one event per task', () => {
    const out = ics([{ task: task() }, { task: task() }]);
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});

describe('recurrence', () => {
  it('writes a weekly rule', () => {
    expect(toRrule({ ...RULE, byday: [1, 3] })).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('only writes INTERVAL when it is not 1', () => {
    expect(toRrule({ ...RULE, interval: 1 })).toBe('FREQ=WEEKLY');
    expect(toRrule({ ...RULE, interval: 3 })).toBe('FREQ=WEEKLY;INTERVAL=3');
  });

  it('writes the nth weekday of a month as a prefixed BYDAY', () => {
    expect(toRrule({ ...RULE, freq: 'monthly', byday: [2], monthWeek: 3 })).toBe(
      'FREQ=MONTHLY;BYDAY=3TU',
    );
  });

  it('writes the last day of a month as -1', () => {
    expect(toRrule({ ...RULE, freq: 'monthly', bymonthday: [-1] })).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=-1',
    );
  });

  it('carries both ways a series can end', () => {
    expect(toRrule({ ...RULE, endsMode: 'on_date', endsOn: '2026-12-31' })).toContain(
      'UNTIL=20261231',
    );
    expect(toRrule({ ...RULE, endsMode: 'after_count', endsAfterCount: 10 })).toContain('COUNT=10');
  });

  it('matches UNTIL to the value type of DTSTART', () => {
    // RFC 5545 3.3.10. A DATE UNTIL against a DATE-TIME start makes strict
    // parsers drop the rule, and Google Calendar imports it as never-ending.
    const ends = { ...RULE, endsMode: 'on_date' as const, endsOn: '2026-12-31' };
    expect(toRrule(ends, false)).toContain('UNTIL=20261231');
    expect(toRrule(ends, true)).toContain('UNTIL=20261231T235959');
  });

  it('carries that through to a timed recurring event', () => {
    const out = ics([
      {
        task: task({ dueTime: '09:00' }),
        rule: { ...RULE, endsMode: 'on_date', endsOn: '2026-12-31' },
      },
    ]);
    expect(out).toContain('DTSTART:20260821T090000');
    expect(out).toContain('UNTIL=20261231T235959');
  });

  it('and leaves an all-day one as a DATE', () => {
    const out = ics([
      { task: task(), rule: { ...RULE, endsMode: 'on_date', endsOn: '2026-12-31' } },
    ]);
    expect(out).toContain('DTSTART;VALUE=DATE:20260821');
    expect(out).toContain('UNTIL=20261231');
    expect(out).not.toContain('UNTIL=20261231T');
  });

  it('refuses to write a rule for completion-anchored recurrence', () => {
    // RFC 5545 describes a fixed calendar series. "Every 3 days after I finish
    // it" is not one, and emitting FREQ=DAILY;INTERVAL=3 would export a
    // different promise than the app made.
    expect(toRrule({ ...RULE, anchorMode: 'completion_date' })).toBeNull();
  });

  it('exports such a task as its one open occurrence instead', () => {
    const out = ics([
      { task: task(), rule: { ...RULE, anchorMode: 'completion_date' } },
    ]);
    expect(out).not.toContain('RRULE');
    expect(out).toContain('BEGIN:VEVENT');
  });
});

describe('the filename', () => {
  it('carries the day it was made', () => {
    expect(icsFilename(NOW)).toBe('tend-2026-08-20.ics');
  });
});
