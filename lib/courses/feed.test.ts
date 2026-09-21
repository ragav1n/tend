import { describe, expect, it } from 'vitest';
import type { Course } from '@/lib/db/types';
import { parseIcs } from '@/lib/ics/parse';
import { classify, eventKindOf, matchCourse, readFeed, splitSummary } from './feed';

let n = 0;
function course(code: string, feedLabel = ''): Course {
  n += 1;
  return { id: `course-${n}`, code, feedLabel } as unknown as Course;
}

const vevent = (lines: string[]) =>
  parseIcs(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'))[0]!;

describe('splitting a Canvas summary', () => {
  it('takes the course code off the end', () => {
    expect(splitSummary('Project 1 [CS-6035-O01]')).toEqual({
      title: 'Project 1',
      hint: 'CS-6035-O01',
    });
  });

  it('leaves a title with no suffix alone', () => {
    expect(splitSummary('Office hours')).toEqual({ title: 'Office hours', hint: null });
  });

  it('only takes a trailing bracket', () => {
    // "Problem set [2] revisited" keeps its brackets and its whole title.
    expect(splitSummary('Problem set [2] revisited')).toEqual({
      title: 'Problem set [2] revisited',
      hint: null,
    });
  });

  it('keeps a summary that is nothing but a bracket', () => {
    // Otherwise the item imports with no name at all.
    expect(splitSummary('[CS-6035]')).toEqual({ title: '[CS-6035]', hint: null });
  });
});

describe('guessing what a course event is', () => {
  it('spots an exam', () => {
    expect(eventKindOf('Midterm Exam')).toBe('exam');
    expect(eventKindOf('Final')).toBe('exam');
    expect(eventKindOf('Quiz 4')).toBe('exam');
  });

  it('spots a class', () => {
    expect(eventKindOf('Lecture 12')).toBe('class');
    expect(eventKindOf('Office Hours')).toBe('class');
    expect(eventKindOf('Lab 3')).toBe('class');
  });

  it('respects word boundaries', () => {
    // "finalise the report" is not a final, and "classify" is not a class.
    expect(eventKindOf('Finalise the report')).toBe('event');
    expect(eventKindOf('Classify the samples')).toBe('event');
  });

  it('falls back to a plain event', () => {
    expect(eventKindOf('Guest speaker')).toBe('event');
  });
});

describe('classifying a feed item', () => {
  it('reads an assignment as work', () => {
    const item = classify(
      vevent([
        'UID:event-assignment-1@canvas.instructure.com',
        'SUMMARY:Project 1 [CS-6035-O01]',
        'DTSTART;TZID=America/New_York:20260914T235900',
      ]),
    );
    expect(item).toMatchObject({
      kind: 'assignment',
      title: 'Project 1',
      courseHint: 'CS-6035-O01',
      date: '2026-09-14',
      time: '23:59',
    });
  });

  it('reads a calendar event as something you do not tick off', () => {
    const item = classify(
      vevent([
        'UID:event-calendar-event-9@canvas.instructure.com',
        'SUMMARY:Midterm Exam [CS-6035-O01]',
        'DTSTART;VALUE=DATE:20261012',
      ]),
    );
    expect(item!.kind).toBe('event');
    expect(item!.eventKind).toBe('exam');
    expect(item!.time).toBeNull();
  });

  it('tells them apart by the uid, not by the title', () => {
    // Canvas mints them from different tables, and the prefix is the only part
    // of the feed that says so. A title heuristic would file "Read chapter 4"
    // and "Lecture 4" the same way.
    const lecture = classify(
      vevent([
        'UID:event-assignment-2@canvas',
        'SUMMARY:Lecture notes writeup [CS-6035]',
        'DTSTART;VALUE=DATE:20261012',
      ]),
    );
    expect(lecture!.kind).toBe('assignment');
  });

  it('skips a uid shape Canvas did not mint', () => {
    const other = classify(
      vevent([
        'UID:event-appointment-group-5@canvas',
        'SUMMARY:Advising slot [CS-6035]',
        'DTSTART;VALUE=DATE:20261012',
      ]),
    );
    expect(other).toBeNull();
  });

  it('skips an item with no readable date', () => {
    // Inventing today would put somebody else's blank field on your Today list.
    const undated = classify(
      vevent(['UID:event-assignment-3@canvas', 'SUMMARY:Someday [CS-6035]']),
    );
    expect(undated).toBeNull();
  });

  it('reads the whole feed in order, keeping what it can file', () => {
    const feed = parseIcs(
      [
        'BEGIN:VEVENT',
        'UID:event-assignment-1@canvas',
        'SUMMARY:One [CS-6035]',
        'DTSTART;VALUE=DATE:20260914',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:event-appointment-group-2@canvas',
        'SUMMARY:Skip me [CS-6035]',
        'DTSTART;VALUE=DATE:20260915',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:event-calendar-event-3@canvas',
        'SUMMARY:Lecture [CS-6035]',
        'DTSTART;VALUE=DATE:20260916',
        'END:VEVENT',
      ].join('\r\n'),
    );
    expect(readFeed(feed).map((item) => item.title)).toEqual(['One', 'Lecture']);
  });
});

describe('matching a course', () => {
  const courses = [course('CS 6035'), course('MATH 6014')];

  it('matches through the decorations Canvas adds', () => {
    // `CS-6035-O01` for a course you call CS 6035.
    expect(matchCourse('CS-6035-O01', courses)).toBe(courses[0]!.id);
  });

  it('matches a term prefix too', () => {
    expect(matchCourse('2026Fall-CS-6035-A', courses)).toBe(courses[0]!.id);
  });

  it('prefers an explicit feed label over any guessing', () => {
    const labelled = [course('CS 6035', 'CS-6035-O01'), course('CS 6035 Recitation')];
    expect(matchCourse('CS-6035-O01', labelled)).toBe(labelled[0]!.id);
  });

  it('matches a feed that abbreviates a longer course code', () => {
    // The third pass, for a course whose own code carries more than the feed
    // does: a hint of CS6035 against a course coded "CS 6035 Intro to Infosec".
    const verbose = [course('CS 6035 Intro to Infosec')];
    expect(matchCourse('CS6035', verbose)).toBe(verbose[0]!.id);
    expect(matchCourse('CS6035', courses)).toBe(courses[0]!.id);
  });

  it('refuses to guess between two candidates', () => {
    // Filing a deadline under the wrong course is worse than leaving it in the
    // Inbox where it is visible.
    const twins = [course('CS 60'), course('CS 6035')];
    expect(matchCourse('CS-6035-O01', twins)).toBeNull();
  });

  it('answers nothing for an item with no hint', () => {
    expect(matchCourse(null, courses)).toBeNull();
    expect(matchCourse('', courses)).toBeNull();
  });

  it('answers nothing when no course is close', () => {
    expect(matchCourse('HIST-2100', courses)).toBeNull();
  });

  it('ignores a course with no code', () => {
    expect(matchCourse('CS-6035', [course('')])).toBeNull();
  });
});
