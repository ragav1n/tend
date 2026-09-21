import { describe, expect, it } from 'vitest';
import { escapeText, foldLine } from './serialize';
import { parseIcs, parseLine, parseMoment, unescapeText, unfold } from './parse';

/**
 * The parser, against the shapes a real Canvas feed actually contains.
 *
 * The fixture below is trimmed from one: the folded description, the `[CS-6035]`
 * suffix on every summary, the two UID prefixes, an all-day event beside a timed
 * one, and a VTIMEZONE block carrying DTSTART lines that belong to a transition
 * rule rather than to anything on a calendar.
 */

const CANVAS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'DTSTART:20260308T020000',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20260914T235900',
  'DTSTAMP:20260901T120000Z',
  'UID:event-assignment-1284531@canvas.instructure.com',
  'SUMMARY:Project 1: Buffer Overflow [CS-6035-O01]',
  'DESCRIPTION:Implement a stack smash against the provided binary. See the rub',
  ' ric in Canvas for the breakdown\\, and note the late policy.',
  'URL:https://gatech.instructure.com/courses/1/assignments/1284531',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261012',
  'DTEND;VALUE=DATE:20261013',
  'UID:event-calendar-event-99881@canvas.instructure.com',
  'SUMMARY:Midterm Exam [CS-6035-O01]',
  'LOCATION:Klaus 1116',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261020T160000Z',
  'UID:event-assignment-1284999@canvas.instructure.com',
  'SUMMARY:Quiz 4 [MATH-6014]',
  'BEGIN:VALARM',
  'TRIGGER:-PT15M',
  'ACTION:DISPLAY',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('unfolding', () => {
  it('joins a continuation line with nothing between', () => {
    expect(unfold('SUMMARY:Long tit\r\n le')).toEqual(['SUMMARY:Long title']);
  });

  it('takes a tab as a continuation too', () => {
    expect(unfold('SUMMARY:Long tit\r\n\tle')).toEqual(['SUMMARY:Long title']);
  });

  it('accepts a feed whose carriage returns were stripped', () => {
    // A proxy or a copy-paste does this, and the feed is still legible.
    expect(unfold('SUMMARY:Long tit\n le')).toEqual(['SUMMARY:Long title']);
  });

  it('undoes what foldLine does', () => {
    const line = `SUMMARY:${'a'.repeat(200)}`;
    expect(unfold(foldLine(line))).toEqual([line]);
  });

  it('has nothing to continue on the first line, so it keeps it verbatim', () => {
    // Malformed either way. Kept as-is rather than guessed at, and it has no
    // colon so `parseLine` drops it a step later.
    expect(unfold(' orphan')).toEqual([' orphan']);
    expect(parseLine(' orphan')).toBeNull();
  });
});

describe('unescaping', () => {
  it('undoes what escapeText does', () => {
    const value = 'Commas, semis; slashes \\ and\nnewlines';
    expect(unescapeText(escapeText(value))).toBe(value);
  });

  it('reads an uppercase newline escape', () => {
    expect(unescapeText('one\\Ntwo')).toBe('one\ntwo');
  });

  it('leaves a lone backslash alone rather than eating the next character', () => {
    expect(unescapeText('C:\\temp')).toBe('C:\\temp');
  });
});

describe('a content line', () => {
  it('splits a bare property', () => {
    expect(parseLine('SUMMARY:Hello')).toEqual({ name: 'SUMMARY', params: {}, value: 'Hello' });
  });

  it('reads the parameters off a property', () => {
    expect(parseLine('DTSTART;VALUE=DATE:20260914')).toEqual({
      name: 'DTSTART',
      params: { VALUE: 'DATE' },
      value: '20260914',
    });
  });

  it('keeps a colon that sits inside a quoted parameter', () => {
    // Splitting on the first colon anywhere would name this property
    // `DTSTART;TZID="GMT+01` and lose the event.
    const out = parseLine('DTSTART;TZID="GMT+01:00":20260914T120000');
    expect(out!.name).toBe('DTSTART');
    expect(out!.params.TZID).toBe('GMT+01:00');
    expect(out!.value).toBe('20260914T120000');
  });

  it('keeps a colon in the value, which a URL always has', () => {
    expect(parseLine('URL:https://example.com/a')!.value).toBe('https://example.com/a');
  });

  it('answers nothing for a line with no colon', () => {
    expect(parseLine('BEGIN')).toBeNull();
  });
});

describe('a date or time', () => {
  const at = (value: string, params: Record<string, string> = {}) =>
    parseMoment({ name: 'DTSTART', params, value });

  it('reads an all-day value', () => {
    expect(at('20261012', { VALUE: 'DATE' })).toEqual({ date: '2026-10-12', time: null });
  });

  it('reads a floating time as the wall clock it is', () => {
    expect(at('20260914T235900')).toEqual({ date: '2026-09-14', time: '23:59' });
  });

  it('reads a zoned time as the wall clock it is', () => {
    // Canvas writes the course's own zone, and a deadline at 23:59 means 23:59
    // to the person it is set for.
    expect(at('20260914T235900', { TZID: 'America/New_York' })).toEqual({
      date: '2026-09-14',
      time: '23:59',
    });
  });

  it('converts a UTC instant once', () => {
    // The suite pins TZ to UTC, so this lands unchanged and the conversion is
    // still the code path under test.
    expect(at('20261020T160000Z')).toEqual({ date: '2026-10-20', time: '16:00' });
  });

  it('accepts a value with no seconds', () => {
    expect(at('20260914T2359')).toEqual({ date: '2026-09-14', time: '23:59' });
  });

  it('answers nothing rather than guessing a date', () => {
    // A feed item with no usable date is one this app has nothing to say about,
    // and inventing today would put somebody else's mistake on Today.
    expect(at('')).toBeNull();
    expect(at('next tuesday')).toBeNull();
    expect(at('2026-09-14')).toBeNull();
  });
});

describe('a Canvas feed', () => {
  const events = parseIcs(CANVAS);

  it('finds every event and nothing else', () => {
    expect(events).toHaveLength(3);
  });

  it('skips the VTIMEZONE, whose DTSTART belongs to a transition rule', () => {
    // 20260308T020000 is the spring-forward rule, not an assignment. Reading it
    // would put a phantom event on 8 March.
    expect(events.map((event) => event.start?.date)).not.toContain('2026-03-08');
  });

  it('reads the folded description as one string', () => {
    expect(events[0]!.description).toBe(
      'Implement a stack smash against the provided binary. See the rubric in Canvas for the breakdown, and note the late policy.',
    );
  });

  it('keeps the UID, which is the whole basis of importing twice', () => {
    expect(events[0]!.uid).toBe('event-assignment-1284531@canvas.instructure.com');
  });

  it('reads the summary with its course suffix intact', () => {
    // Stripping it is the feed module's job, not the parser's.
    expect(events[0]!.summary).toBe('Project 1: Buffer Overflow [CS-6035-O01]');
  });

  it('reads a zoned deadline', () => {
    expect(events[0]!.start).toEqual({ date: '2026-09-14', time: '23:59' });
  });

  it('reads an all-day event and its exclusive end', () => {
    expect(events[1]!.start).toEqual({ date: '2026-10-12', time: null });
    expect(events[1]!.end).toEqual({ date: '2026-10-13', time: null });
    expect(events[1]!.location).toBe('Klaus 1116');
  });

  it('does not let an END:VALARM close the event around it', () => {
    // The third event has an alarm in it and still has to arrive whole.
    expect(events[2]!.uid).toBe('event-assignment-1284999@canvas.instructure.com');
    expect(events[2]!.summary).toBe('Quiz 4 [MATH-6014]');
  });

  it('carries the URL through, which is the way back to Canvas', () => {
    expect(events[0]!.url).toBe(
      'https://gatech.instructure.com/courses/1/assignments/1284531',
    );
  });

  it('drops an event with no UID rather than importing something anonymous', () => {
    const anonymous = ['BEGIN:VEVENT', 'SUMMARY:Who knows', 'END:VEVENT'].join('\r\n');
    expect(parseIcs(anonymous)).toEqual([]);
  });

  it('answers empty for something that is not a calendar at all', () => {
    expect(parseIcs('<html><body>Not found</body></html>')).toEqual([]);
    expect(parseIcs('')).toEqual([]);
  });
});
