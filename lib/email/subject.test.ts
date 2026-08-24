import { describe, expect, it } from 'vitest';
import { digestSubject, nudgeSubject, reviewSubject, summaryLead } from './render';
import type { DigestItem, SummaryPayload } from './types';

/**
 * The subject lines, on their own.
 *
 * These strings are the notification. A phone shows the subject and drops the
 * body, so anything that matters has to survive being cut off at roughly forty
 * characters, and the front of the line is the only part guaranteed to be read.
 */

let n = 0;
function item(title: string): DigestItem {
  n += 1;
  return {
    id: `i${n}`,
    title,
    dueDate: '2026-09-01',
    dueTime: null,
    priority: 0,
    project: null,
    planned: false,
  };
}

function payload(over: Partial<SummaryPayload> = {}): SummaryPayload {
  return {
    kind: 'daily_digest',
    localDate: '2026-09-01',
    today: [],
    overdue: [],
    dueSoon: [],
    completedThisWeek: 0,
    openTotal: 0,
    ...over,
  };
}

describe('which task gets named', () => {
  it('prefers a late task over one due today', () => {
    const lead = summaryLead(
      payload({ today: [item('Water the plants')], overdue: [item('Repot the ficus')] }),
    );
    expect(lead?.item.title).toBe('Repot the ficus');
    expect(lead?.late).toBe(true);
  });

  it('falls to today, then to what is coming up', () => {
    expect(summaryLead(payload({ today: [item('Today thing')] }))?.item.title).toBe('Today thing');
    expect(summaryLead(payload({ dueSoon: [item('Soon thing')] }))?.item.title).toBe('Soon thing');
    expect(summaryLead(payload())).toBeNull();
  });
});

describe('digestSubject', () => {
  it('names the late task and counts what else there is to do', () => {
    expect(
      digestSubject(
        payload({
          overdue: [item('Renew the passport')],
          today: [item('Water the plants'), item('Call the bank')],
        }),
      ),
    ).toBe('Renew the passport is late, and 2 more to do');
  });

  it('drops the count when the late task is the only thing', () => {
    expect(digestSubject(payload({ overdue: [item('Renew the passport')] }))).toBe(
      'Renew the passport is late',
    );
  });

  it('counts only what is actionable, not what is merely coming up', () => {
    const subject = digestSubject(
      payload({ today: [item('Water the plants')], dueSoon: [item('Quiz on Friday')] }),
    );
    // One task today plus one on Friday is not "2 more tasks today".
    expect(subject).toBe('Water the plants, and nothing else today');
  });

  it('says what a clear day is without naming a task', () => {
    expect(digestSubject(payload())).toBe('Nothing due today');
  });

  it('names something coming up when today and late are both empty', () => {
    expect(digestSubject(payload({ dueSoon: [item('Quiz on Friday')] }))).toBe(
      'Quiz on Friday is coming up',
    );
  });

  /**
   * The cut matters more than it looks. Past roughly forty characters a phone is
   * truncating anyway, and it truncates the count off the end rather than the
   * title, so a long title with no cut here loses the "and 4 more" entirely.
   */
  it('cuts a long title on a word and keeps the count', () => {
    const subject = digestSubject(
      payload({
        today: [
          item('Finish the operating systems assignment on paging and virtual memory'),
          item('Call the bank'),
        ],
      }),
    );

    expect(subject).toContain('...');
    expect(subject).toContain('1 more task today');
    // Cut on a space, so no word is left half written.
    expect(subject.split('...')[0]).toBe('Finish the operating systems assignment on');
  });

  it('cuts mid-word only when there is no space to cut on', () => {
    const subject = digestSubject(payload({ today: [item('a'.repeat(80))] }));
    expect(subject.startsWith('a'.repeat(48) + '...')).toBe(true);
  });

  it('leaves a title that fits exactly alone', () => {
    const exact = 'x'.repeat(48);
    expect(digestSubject(payload({ today: [item(exact)] }))).toBe(
      `${exact}, and nothing else today`,
    );
  });
});

describe('nudgeSubject', () => {
  it('names the oldest late task and counts the rest', () => {
    expect(
      nudgeSubject(payload({ overdue: [item('Water the plants'), item('Call the bank')] })),
    ).toBe('Water the plants, and 1 more past due');
  });

  it('does not say "and 0 more" for a single late task', () => {
    expect(nudgeSubject(payload({ overdue: [item('Water the plants')] }))).toBe(
      'Water the plants is past due',
    );
  });

  it('has an answer for a nudge with nothing in it, which SQL should never send', () => {
    expect(nudgeSubject(payload())).toBe('Nothing is past due');
  });
});

describe('reviewSubject', () => {
  it('gives the week two numbers rather than a task', () => {
    expect(reviewSubject(payload({ completedThisWeek: 12, openTotal: 5 }))).toBe(
      '12 done last week, 5 still open',
    );
  });

  it('does not open with a zero', () => {
    expect(reviewSubject(payload({ completedThisWeek: 0, openTotal: 5 }))).toBe(
      'Nothing closed last week, 5 still open',
    );
  });

  it('has a word for a week with nothing on either side of it', () => {
    expect(reviewSubject(payload())).toBe('A clear week');
  });
});
