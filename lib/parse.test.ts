import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './parse';

// A Tuesday, so weekday arithmetic has somewhere unambiguous to land.
const NOW = new Date(2026, 7, 18, 10, 0, 0); // 2026-08-18, local
const TODAY = '2026-08-18';
const TOMORROW = '2026-08-19';

function p(input: string) {
  return parseQuickAdd(input, NOW);
}

describe('plain text', () => {
  it('leaves an ordinary title alone', () => {
    const r = p('Buy oat milk');
    expect(r.title).toBe('Buy oat milk');
    expect(r.dueDate).toBeNull();
    expect(r.dueTime).toBeNull();
    expect(r.priority).toBe(0);
    expect(r.tagNames).toEqual([]);
    expect(r.projectName).toBeNull();
  });

  it('collapses whitespace', () => {
    expect(p('  Buy   oat    milk  ').title).toBe('Buy oat milk');
  });

  it('handles an empty string', () => {
    expect(p('').title).toBe('');
  });
});

describe('relative dates', () => {
  it('parses today and tomorrow', () => {
    expect(p('Pay rent today').dueDate).toBe(TODAY);
    expect(p('Pay rent tod').dueDate).toBe(TODAY);
    expect(p('Pay rent tomorrow').dueDate).toBe(TOMORROW);
    expect(p('Pay rent tmr').dueDate).toBe(TOMORROW);
    expect(p('Pay rent tmrw').dueDate).toBe(TOMORROW);
  });

  it('strips the date from the title', () => {
    expect(p('Pay rent tomorrow').title).toBe('Pay rent');
    expect(p('tomorrow Pay rent').title).toBe('Pay rent');
    expect(p('Pay tomorrow rent').title).toBe('Pay rent');
  });

  it('parses "in N units"', () => {
    expect(p('Renew insurance in 3 days').dueDate).toBe('2026-08-21');
    expect(p('Renew insurance in 2 weeks').dueDate).toBe('2026-09-01');
    expect(p('Renew insurance in 1 month').dueDate).toBe('2026-09-17');
    expect(p('Renew insurance in 3 days').title).toBe('Renew insurance');
  });

  it('takes a bare weekday as the soonest upcoming one, never today', () => {
    // NOW is a Tuesday.
    expect(p('Standup wednesday').dueDate).toBe('2026-08-19');
    expect(p('Gym friday').dueDate).toBe('2026-08-21');
    // Tuesday from a Tuesday is a week out, because a task typed now was not
    // scheduled for a day already underway.
    expect(p('Review tuesday').dueDate).toBe('2026-08-25');
  });

  it('treats "next <weekday>" as the following week', () => {
    // Bare Wednesday is tomorrow; "next wednesday" skips a week.
    expect(p('Standup next wednesday').dueDate).toBe('2026-08-26');
    expect(p('Standup next wednesday').title).toBe('Standup');
  });

  it('accepts weekday abbreviations', () => {
    expect(p('Gym fri').dueDate).toBe('2026-08-21');
    expect(p('Gym thurs').dueDate).toBe('2026-08-20');
    expect(p('Gym sun').dueDate).toBe('2026-08-23');
  });

  it('reads "next week" as the coming Monday', () => {
    expect(p('Plan the sprint next week').dueDate).toBe('2026-08-24');
    expect(p('Plan the sprint next week').title).toBe('Plan the sprint');
  });
});

describe('absolute dates', () => {
  it('parses an ISO date', () => {
    expect(p('Flight 2026-12-24').dueDate).toBe('2026-12-24');
    expect(p('Flight 2026-12-24').title).toBe('Flight');
  });

  it('parses "month day" in either order', () => {
    expect(p('Dentist aug 20').dueDate).toBe('2026-08-20');
    expect(p('Dentist 20 aug').dueDate).toBe('2026-08-20');
    expect(p('Dentist august 20th').dueDate).toBe('2026-08-20');
    expect(p('Dentist sept 3').dueDate).toBe('2026-09-03');
  });

  it('rolls a past month into next year', () => {
    // NOW is August 2026, so "feb 10" means 2027.
    expect(p('Taxes feb 10').dueDate).toBe('2027-02-10');
  });

  it('does not leave the month name in the title', () => {
    expect(p('Dentist aug 20').title).toBe('Dentist');
    expect(p('Dentist 20 aug').title).toBe('Dentist');
  });
});

describe('times', () => {
  it('parses 12-hour times', () => {
    expect(p('Call mum 5pm').dueTime).toBe('17:00');
    expect(p('Call mum 5 pm').dueTime).toBe('17:00');
    expect(p('Call mum at 9am').dueTime).toBe('09:00');
    expect(p('Call mum 12pm').dueTime).toBe('12:00');
    expect(p('Call mum 12am').dueTime).toBe('00:00');
  });

  it('parses times with minutes', () => {
    expect(p('Call mum 5:30pm').dueTime).toBe('17:30');
    expect(p('Standup 09:15').dueTime).toBe('09:15');
    expect(p('Standup 17:45').dueTime).toBe('17:45');
  });

  it('parses noon and midnight', () => {
    expect(p('Lunch noon').dueTime).toBe('12:00');
    expect(p('Deploy midnight').dueTime).toBe('00:00');
  });

  it('defaults a bare time to today', () => {
    const r = p('Call mum at 6pm');
    expect(r.dueTime).toBe('18:00');
    expect(r.dueDate).toBe(TODAY);
    expect(r.title).toBe('Call mum');
  });

  it('combines a date and a time', () => {
    const r = p('Dentist tomorrow 9am');
    expect(r.dueDate).toBe(TOMORROW);
    expect(r.dueTime).toBe('09:00');
    expect(r.title).toBe('Dentist');
  });

  it('rejects an impossible time and leaves it in the title', () => {
    const r = p('Route 25:99');
    expect(r.dueTime).toBeNull();
    expect(r.title).toBe('Route 25:99');
  });
});

describe('priority', () => {
  it('parses !p1 as highest', () => {
    expect(p('Ship it !p1').priority).toBe(3);
    expect(p('Ship it !p2').priority).toBe(2);
    expect(p('Ship it !p3').priority).toBe(1);
  });

  it('parses bare !1 through !3', () => {
    expect(p('Ship it !1').priority).toBe(3);
    expect(p('Ship it !3').priority).toBe(1);
  });

  it('parses bang runs', () => {
    expect(p('Ship it !').priority).toBe(1);
    expect(p('Ship it !!').priority).toBe(2);
    expect(p('Ship it !!!').priority).toBe(3);
  });

  it('strips the token from the title', () => {
    expect(p('Ship it !p1').title).toBe('Ship it');
    expect(p('!p1 Ship it').title).toBe('Ship it');
  });

  it('leaves mid-word punctuation alone', () => {
    // Trailing punctuation on a real word is not a priority flag.
    expect(p('Ship it now!').title).toBe('Ship it now!');
    expect(p('Ship it now!').priority).toBe(0);
  });
});

describe('tags and projects', () => {
  it('parses tags', () => {
    const r = p('Draft the deck #work #urgent');
    expect(r.tagNames).toEqual(['work', 'urgent']);
    expect(r.title).toBe('Draft the deck');
  });

  it('deduplicates tags case-insensitively', () => {
    expect(p('Task #work #Work').tagNames).toEqual(['work']);
  });

  it('parses a project', () => {
    const r = p('Fix the sink @home');
    expect(r.projectName).toBe('home');
    expect(r.title).toBe('Fix the sink');
  });

  it('takes the first project when several are given', () => {
    expect(p('Task @home @work').projectName).toBe('home');
  });

  it('accepts hyphens, underscores and non-ASCII letters', () => {
    expect(p('Task #deep-work').tagNames).toEqual(['deep-work']);
    expect(p('Task #deep_work').tagNames).toEqual(['deep_work']);
    expect(p('Task #café').tagNames).toEqual(['café']);
  });

  it('ignores a bare # or @ with nothing after it', () => {
    const r = p('Task # @');
    expect(r.tagNames).toEqual([]);
    expect(r.projectName).toBeNull();
    expect(r.title).toBe('Task # @');
  });
});

describe('everything at once', () => {
  it('parses the full example', () => {
    const r = p('Pay the rent tomorrow 9am !p1 #bills @home');
    expect(r).toMatchObject({
      title: 'Pay the rent',
      dueDate: TOMORROW,
      dueTime: '09:00',
      priority: 3,
      tagNames: ['bills'],
      projectName: 'home',
    });
  });

  it('does not care about token order', () => {
    const r = p('#bills @home !p1 9am tomorrow Pay the rent');
    expect(r).toMatchObject({
      title: 'Pay the rent',
      dueDate: TOMORROW,
      dueTime: '09:00',
      priority: 3,
      tagNames: ['bills'],
      projectName: 'home',
    });
  });

  it('keeps the second date in the title when two are given', () => {
    // First match wins, so the leftover text stays visible rather than being
    // silently swallowed.
    const r = p('Trip tomorrow friday');
    expect(r.dueDate).toBe(TOMORROW);
    expect(r.title).toBe('Trip friday');
  });
});

describe('token ranges for live highlighting', () => {
  it('reports the exact span of each token', () => {
    const input = 'Pay rent tomorrow #bills';
    const r = p(input);

    const kinds = r.tokens.map((t) => t.kind);
    expect(kinds).toEqual(['date', 'tag']);

    for (const t of r.tokens) {
      expect(input.slice(t.start, t.end)).toBe(t.text);
    }
    expect(r.tokens[0]!.text).toBe('tomorrow');
    expect(r.tokens[1]!.text).toBe('#bills');
  });

  it('returns tokens in input order', () => {
    const r = p('#bills Pay rent tomorrow');
    expect(r.tokens.map((t) => t.kind)).toEqual(['tag', 'date']);
  });

  it('does not include the leading space in a token span', () => {
    const input = 'Task tomorrow';
    const r = p(input);
    expect(input[r.tokens[0]!.start]).toBe('t');
  });
});

describe('regex state does not leak between calls', () => {
  it('parses the same input the same way twice', () => {
    const first = p('Pay rent tomorrow #bills');
    const second = p('Pay rent tomorrow #bills');
    expect(second).toEqual(first);
  });
});
